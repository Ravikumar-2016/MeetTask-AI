/**
 * AssemblyAI Webhook Handler
 * 
 * POST /api/webhook/assemblyai
 * 
 * This endpoint receives callbacks from AssemblyAI when transcription is complete.
 * The actual processing happens here AFTER AssemblyAI finishes.
 * 
 * Flow:
 * 1. User uploads → orchestrator submits to AssemblyAI with webhook URL
 * 2. Orchestrator returns immediately (status: "transcribing")
 * 3. AssemblyAI processes audio (takes 1-5 minutes)
 * 4. AssemblyAI calls THIS webhook when done
 * 5. We save transcript, extract tasks with LeMUR, update status to "completed"
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ============================================
// FIREBASE ADMIN SETUP
// ============================================
function initAdmin() {
  if (getApps().length > 0) return getApps()[0];

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase Admin credentials');
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
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

interface SpeakerMapping {
  [speakerId: string]: string;
}

interface ExtractedTask {
  title: string;
  description: string;
  assignedTo: string;
  dueDate: string;
  priority: 'high' | 'medium' | 'low';
}

// ============================================
// SPEAKER MAPPING (Fallback - no video OCR)
// ============================================
function mapSpeakersToNames(utterances: SpeakerUtterance[]): SpeakerMapping {
  const speakerIds = [...new Set(utterances.map(u => u.speaker))];
  const mapping: SpeakerMapping = {};
  
  // Simple fallback: Speaker A, Speaker B, etc.
  for (const id of speakerIds) {
    mapping[id] = `Speaker ${id}`;
  }
  
  return mapping;
}

// ============================================
// FORMATTED TRANSCRIPT
// ============================================
function generateFormattedTranscript(utterances: SpeakerUtterance[], mapping: SpeakerMapping): string {
  let currentSpeaker = '';
  const lines: string[] = [];
  
  for (const u of utterances) {
    const speakerName = mapping[u.speaker] || `Speaker ${u.speaker}`;
    
    if (speakerName !== currentSpeaker) {
      const minutes = Math.floor(u.start / 60000);
      const seconds = Math.floor((u.start % 60000) / 1000);
      lines.push('');
      lines.push(`${speakerName} [${minutes}:${seconds.toString().padStart(2, '0')}]:`);
      currentSpeaker = speakerName;
    }
    
    lines.push(u.text);
  }
  
  return lines.join('\n').trim();
}

// ============================================
// LEMUR TASK EXTRACTION
// ============================================
async function extractTasksWithLemur(
  transcriptId: string,
  meetingTitle: string,
  speakerMapping: SpeakerMapping
): Promise<{ summary: string; tasks: ExtractedTask[] }> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY not set');

  const speakerNames = Object.values(speakerMapping).join(', ');
  
  console.log('📝 [LeMUR] Extracting summary and tasks...');

  // Get summary
  let summary = '';
  try {
    const summaryRes = await fetch('https://api.assemblyai.com/lemur/v3/generate/summary', {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transcript_ids: [transcriptId],
        context: `Meeting title: "${meetingTitle}". Participants: ${speakerNames}`,
        answer_format: 'A concise 2-3 sentence summary of the key discussion points and decisions.',
      }),
    });

    if (summaryRes.ok) {
      const summaryData = await summaryRes.json();
      summary = summaryData.response || '';
      console.log('✅ [LeMUR] Summary generated');
    }
  } catch (e: any) {
    console.log('⚠️ [LeMUR] Summary failed:', e.message);
  }

  // Get tasks
  let tasks: ExtractedTask[] = [];
  try {
    const tasksRes = await fetch('https://api.assemblyai.com/lemur/v3/generate/task', {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transcript_ids: [transcriptId],
        prompt: `Extract action items from this meeting. For each task, identify:
1. What needs to be done (title)
2. Who should do it (use speaker names: ${speakerNames})
3. Priority (high/medium/low)
4. Due date if mentioned

Return as JSON array: [{"title": "...", "assignedTo": "...", "priority": "medium", "dueDate": "...", "description": "..."}]
Only return the JSON array, no other text.`,
      }),
    });

    if (tasksRes.ok) {
      const tasksData = await tasksRes.json();
      const responseText = tasksData.response || '';
      
      // Parse JSON from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        tasks = parsed.map((t: any) => ({
          title: t.title || 'Untitled task',
          description: t.description || '',
          assignedTo: t.assignedTo || 'Unassigned',
          dueDate: t.dueDate || 'No deadline',
          priority: t.priority || 'medium',
        }));
        console.log('✅ [LeMUR] Tasks extracted:', tasks.length);
      }
    }
  } catch (e: any) {
    console.log('⚠️ [LeMUR] Tasks failed:', e.message);
  }

  return { summary, tasks };
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
      
      // Update status to analyzing
      await meetingRef.update({
        status: 'analyzing',
        updatedAt: FieldValue.serverTimestamp(),
      });

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

      console.log('👥 Utterances:', utterances.length);
      console.log('👥 Speakers:', [...new Set(utterances.map(u => u.speaker))]);

      // Map speakers (fallback to Speaker A, B, C)
      const speakerMapping = mapSpeakersToNames(utterances);
      const formattedTranscript = generateFormattedTranscript(utterances, speakerMapping);
      const speakers = Object.values(speakerMapping);

      // Extract summary and tasks with LeMUR
      const { summary, tasks } = await extractTasksWithLemur(
        transcript_id,
        meeting.title || 'Untitled',
        speakerMapping
      );

      // Save transcript to Firestore
      await db.collection('transcripts').doc(meetingId).set({
        meetingId,
        userId: meeting.userId,
        text: transcriptData.text || '',
        formattedTranscript,
        summary,
        confidence: transcriptData.confidence || 0,
        duration: transcriptData.audio_duration || 0,
        wordCount: (transcriptData.text || '').split(/\s+/).length,
        utterances,
        speakerMapping,
        speakerCount: speakers.length,
        speakers,
        videoAnalysisUsed: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      console.log('💾 Transcript saved');

      // Save tasks
      if (tasks.length > 0) {
        const batch = db.batch();
        for (const task of tasks) {
          const taskDoc = db.collection('tasks').doc();
          batch.set(taskDoc, {
            meetingId,
            userId: meeting.userId,
            title: task.title,
            text: task.title,
            description: task.description,
            assignedTo: task.assignedTo,
            dueDate: task.dueDate,
            priority: task.priority,
            completed: false,
            createdAt: FieldValue.serverTimestamp(),
          });
        }
        await batch.commit();
        console.log('💾 Tasks saved:', tasks.length);
      }

      // Update meeting to completed
      await meetingRef.update({
        status: 'completed',
        taskCount: tasks.length,
        summary: summary.substring(0, 500),
        duration: transcriptData.audio_duration || 0,
        speakerCount: speakers.length,
        speakers,
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log('\n✅ [Webhook] Processing complete!');
      console.log('   - Speakers:', speakers.length);
      console.log('   - Tasks:', tasks.length);

      return response.status(200).json({
        success: true,
        meetingId,
        taskCount: tasks.length,
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
