/**
 * AssemblyAI Webhook Handler
 * 
 * POST /api/webhook/assemblyai
 * 
 * NEW FLOW (Human-in-the-loop Speaker Mapping):
 * 1. User uploads → orchestrator submits to AssemblyAI
 * 2. AssemblyAI processes audio (1-5 minutes)
 * 3. AssemblyAI calls THIS webhook when done
 * 4. We save transcript with speakers ["A", "B", "C"]
 * 5. Set status to "needs_mapping" ← USER MUST MAP SPEAKERS
 * 6. User maps Speaker A → "john@email.com", etc. in UI
 * 7. /api/save-speaker-mapping saves mapping AND extracts tasks
 * 8. Status → "completed"
 * 
 * This is how professional tools (Otter.ai, Fireflies) work!
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ============================================
// FIREBASE ADMIN SETUP
// ============================================
function initAdmin() {
  if (getApps().length > 0) return getApps()[0];

  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    }),
  });
}

function getAdminDb() {
  initAdmin();
  return getFirestore();
}

// ============================================
// TYPES
// ============================================
interface SpeakerUtterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence: number;
}

// ============================================
// FORMATTED TRANSCRIPT (with Speaker A, B, C labels)
// ============================================
function generateFormattedTranscript(utterances: SpeakerUtterance[]): string {
  let currentSpeaker = '';
  const lines: string[] = [];
  
  for (const u of utterances) {
    const speakerLabel = `Speaker ${u.speaker}`;
    
    if (speakerLabel !== currentSpeaker) {
      const minutes = Math.floor(u.start / 60000);
      const seconds = Math.floor((u.start % 60000) / 1000);
      lines.push('');
      lines.push(`${speakerLabel} [${minutes}:${seconds.toString().padStart(2, '0')}]:`);
      currentSpeaker = speakerLabel;
    }
    
    lines.push(u.text);
  }
  
  return lines.join('\n').trim();
}

// ============================================
// MAIN WEBHOOK HANDLER
// ============================================
export default async function handler(request: VercelRequest, response: VercelResponse) {
  // CORS
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') return response.status(200).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });

  console.log('\n========================================');
  console.log('🔔 [Webhook] AssemblyAI callback received');
  console.log('========================================\n');

  try {
    const { transcript_id, status, error } = request.body;
    
    console.log('📋 Transcript ID:', transcript_id);
    console.log('📊 Status:', status);

    if (!transcript_id) {
      return response.status(400).json({ error: 'Missing transcript_id' });
    }

    const db = getAdminDb();

    // Find meeting by transcriptId
    const meetingsQuery = await db.collection('meetings')
      .where('transcriptId', '==', transcript_id)
      .limit(1)
      .get();

    if (meetingsQuery.empty) {
      console.log('⚠️ No meeting found for transcript:', transcript_id);
      return response.status(404).json({ error: 'Meeting not found' });
    }

    const meetingDoc = meetingsQuery.docs[0];
    const meetingId = meetingDoc.id;
    const meeting = meetingDoc.data();
    const meetingRef = db.collection('meetings').doc(meetingId);

    console.log('📁 Meeting ID:', meetingId);
    console.log('📁 Meeting title:', meeting.title);

    // Handle error status
    if (status === 'error') {
      await meetingRef.update({
        status: 'error',
        errorMessage: error || 'Transcription failed',
        updatedAt: FieldValue.serverTimestamp(),
      });
      return response.status(200).json({ success: true, status: 'error' });
    }

    // Handle completed status
    if (status === 'completed') {
      console.log('🔄 Processing completed transcript...');

      // Fetch full transcript from AssemblyAI
      const apiKey = process.env.ASSEMBLYAI_API_KEY;
      const transcriptRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcript_id}`, {
        headers: { 'Authorization': apiKey! },
      });

      if (!transcriptRes.ok) {
        throw new Error('Failed to fetch transcript');
      }

      const transcriptData = await transcriptRes.json();
      
      // Extract utterances
      const utterances: SpeakerUtterance[] = (transcriptData.utterances || []).map((u: any) => ({
        speaker: u.speaker || 'A',
        text: u.text || '',
        start: u.start || 0,
        end: u.end || 0,
        confidence: u.confidence || 0,
      }));

      // Get unique speaker IDs: ["A", "B", "C"]
      const speakers = [...new Set(utterances.map(u => u.speaker))].sort();

      console.log('👥 Utterances:', utterances.length);
      console.log('👥 Speakers found:', speakers);

      // Generate formatted transcript with Speaker A/B/C labels
      const formattedTranscript = generateFormattedTranscript(utterances);

      // Save transcript to Firestore (NO tasks yet - wait for mapping)
      await db.collection('transcripts').doc(meetingId).set({
        meetingId,
        userId: meeting.userId,
        text: transcriptData.text || '',
        formattedTranscript,
        confidence: transcriptData.confidence || 0,
        duration: transcriptData.audio_duration || 0,
        wordCount: (transcriptData.text || '').split(/\s+/).length,
        utterances,
        speakers,
        speakerCount: speakers.length,
        // NO speakerMapping yet - user must map manually
        speakerMappingComplete: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      console.log('💾 Transcript saved (waiting for speaker mapping)');

      // Update meeting to "needs_mapping" - USER ACTION REQUIRED
      await meetingRef.update({
        status: 'needs_mapping',
        speakers,
        speakerCount: speakers.length,
        speakerMappingComplete: false,
        duration: transcriptData.audio_duration || 0,
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log('\n✅ [Webhook] Transcript saved!');
      console.log('   - Speakers:', speakers.join(', '));
      console.log('   - Status: needs_mapping');
      console.log('   - User must map speakers before tasks can be extracted');

      return response.status(200).json({
        success: true,
        meetingId,
        speakers,
        status: 'needs_mapping',
        message: 'Transcript saved. Please map speakers to extract tasks.',
      });
    }

    // Other statuses (queued, processing) - just acknowledge
    console.log('ℹ️ Status update acknowledged:', status);
    return response.status(200).json({ success: true, status });

  } catch (error: any) {
    console.error('❌ [Webhook] Error:', error.message);
    return response.status(500).json({ error: error.message });
  }
}
