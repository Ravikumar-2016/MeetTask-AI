/**
 * Orchestrator API - ASYNC Job Submitter
 * 
 * POST /api/orchestrator
 * 
 * This endpoint DOES NOT process the meeting. It only:
 * 1. Validates auth & meeting ownership
 * 2. Submits transcription job to AssemblyAI with webhook URL
 * 3. Updates status to "transcribing"
 * 4. Returns immediately (~2-3 seconds)
 * 
 * The actual processing happens when AssemblyAI calls /api/webhook/assemblyai
 * 
 * Status Flow:
 * uploaded → transcribing → analyzing → completed
 *                       ↘ error (if failed)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ============================================
// FIREBASE ADMIN SETUP
// ============================================
let adminApp: App;

function initAdmin() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase Admin credentials');
  }

  adminApp = initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    }),
  });

  return adminApp;
}

function getAdminDb() {
  initAdmin();
  return getFirestore();
}

function getAdminAuth() {
  initAdmin();
  return getAuth();
}

// ============================================
// AUTH VERIFICATION
// ============================================
interface AuthenticatedUser {
  uid: string;
  email: string | undefined;
}

async function verifyToken(request: VercelRequest): Promise<AuthenticatedUser> {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }

  const token = authHeader.substring(7);
  if (!token) throw new Error('Empty token');

  const auth = getAdminAuth();
  const decodedToken = await auth.verifyIdToken(token);
  
  return { uid: decodedToken.uid, email: decodedToken.email };
}

// ============================================
// TYPES
// ============================================
interface MeetingDoc {
  userId: string;
  title: string;
  fileUrl?: string;
  audioUrl?: string;
  fileType?: 'audio' | 'video' | 'image';
  status: string;
}

// ============================================
// ASSEMBLYAI JOB SUBMISSION
// ============================================
async function submitToAssemblyAI(mediaUrl: string, webhookUrl: string): Promise<string> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY not set');

  console.log('🎤 [AssemblyAI] Submitting transcription job...');
  console.log('📁 Media URL:', mediaUrl.substring(0, 60) + '...');
  console.log('🔔 Webhook URL:', webhookUrl);

  const response = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: mediaUrl,
      language_detection: true,
      speaker_labels: true,
      webhook_url: webhookUrl,
      webhook_auth_header_name: 'X-Webhook-Secret',
      webhook_auth_header_value: process.env.WEBHOOK_SECRET || 'meettask-webhook-secret',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AssemblyAI submit error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  console.log('✅ [AssemblyAI] Job submitted! Transcript ID:', data.id);
  
  return data.id;
}

// ============================================
// MAIN HANDLER
// ============================================
export default async function handler(request: VercelRequest, response: VercelResponse) {
  // CORS
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (request.method === 'OPTIONS') return response.status(200).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });

  console.log('\n========================================');
  console.log('🎯 [Orchestrator] Job submission request');
  console.log('========================================\n');

  const db = getAdminDb();
  let meetingId: string | undefined;

  try {
    // Check env vars
    if (!process.env.ASSEMBLYAI_API_KEY) {
      return response.status(500).json({
        success: false,
        error: 'ASSEMBLYAI_API_KEY not configured',
      });
    }

    // Auth
    console.log('🔐 Verifying auth...');
    const user = await verifyToken(request);
    console.log('✅ User:', user.uid);

    // Get meetingId
    meetingId = request.body?.meetingId;
    if (!meetingId) {
      return response.status(400).json({ success: false, error: 'meetingId required' });
    }
    console.log('📋 Meeting ID:', meetingId);

    const meetingRef = db.collection('meetings').doc(meetingId);
    const meetingSnap = await meetingRef.get();

    if (!meetingSnap.exists) {
      return response.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const meeting = meetingSnap.data() as MeetingDoc;

    // Check ownership
    if (meeting.userId !== user.uid) {
      return response.status(403).json({ success: false, error: 'Not authorized' });
    }

    // Check if already processing or completed
    if (meeting.status === 'completed') {
      return response.status(200).json({ success: true, message: 'Already processed' });
    }

    if (meeting.status === 'transcribing' || meeting.status === 'analyzing' || meeting.status === 'needs_mapping') {
      return response.status(200).json({ success: true, message: 'Already processing' });
    }

    // Get file URL
    const fileUrl = meeting.fileUrl || meeting.audioUrl;
    if (!fileUrl) {
      await meetingRef.update({ 
        status: 'error', 
        errorMessage: 'No file URL found',
        updatedAt: FieldValue.serverTimestamp() 
      });
      return response.status(400).json({ success: false, error: 'No file URL found' });
    }

    console.log('📁 File URL:', fileUrl.substring(0, 60) + '...');
    console.log('📁 File type:', meeting.fileType || 'unknown');

    // ============================================
    // HANDLE IMAGES: OCR + fake speakers for mapping
    // ============================================
    if (meeting.fileType === 'image') {
      console.log('🖼️ [Orchestrator] Image file detected');
      console.log('📝 Will extract text via OCR and require speaker mapping');
      
      // For now, images need manual processing
      // In a production app, you'd integrate Google Cloud Vision or Tesseract here
      // For the MVP, we'll create a placeholder and require mapping
      
      // Create fake speakers A, B, C for manual mapping
      const fakeSpeakers = ['A', 'B', 'C'];
      
      await meetingRef.update({
        status: 'needs_mapping',
        speakers: fakeSpeakers,
        speakerCount: fakeSpeakers.length,
        summary: 'Image uploaded. Please map participants to extract tasks.',
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Create a transcript entry for the image
      await db.collection('transcripts').doc(meetingId).set({
        meetingId,
        userId: user.uid,
        text: 'Image file uploaded. Text extraction pending.',
        formattedTranscript: `This is an image file.

To extract tasks, please:
1. Map Speaker A, B, C to the participants shown in the image
2. Describe what tasks are visible in the image
3. Click "Confirm & Extract Tasks"

Note: For better task extraction, consider uploading meeting audio or video recordings.`,
        summary: 'Image uploaded - awaiting speaker mapping.',
        speakers: fakeSpeakers,
        speakerCount: fakeSpeakers.length,
        utterances: [
          { speaker: 'A', text: 'Participant from image', start: 0, end: 0, confidence: 0 },
          { speaker: 'B', text: 'Participant from image', start: 0, end: 0, confidence: 0 },
          { speaker: 'C', text: 'Participant from image', start: 0, end: 0, confidence: 0 },
        ],
        createdAt: FieldValue.serverTimestamp(),
      });

      return response.status(200).json({
        success: true,
        message: 'Image processed - please map speakers',
        meetingId,
        status: 'needs_mapping',
        speakers: fakeSpeakers,
      });
    }

    // ============================================
    // AUDIO/VIDEO: Submit to AssemblyAI
    // ============================================

    // Construct webhook URL
    const host = request.headers.host || 'meet-task-ai.vercel.app';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const webhookUrl = `${protocol}://${host}/api/webhook/assemblyai`;

    // Submit to AssemblyAI
    const transcriptId = await submitToAssemblyAI(fileUrl, webhookUrl);

    // Update meeting status
    await meetingRef.update({
      status: 'transcribing',
      transcriptId: transcriptId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log('\n========================================');
    console.log('✅ [Orchestrator] Job submitted successfully!');
    console.log('   - Transcript ID:', transcriptId);
    console.log('   - Status: transcribing');
    console.log('   - Webhook will be called when done');
    console.log('========================================\n');

    return response.status(200).json({
      success: true,
      message: 'Transcription job submitted',
      meetingId,
      transcriptId,
      status: 'transcribing',
    });

  } catch (error: any) {
    console.error('❌ [Orchestrator] Error:', error.message);

    // Update meeting status to error
    if (meetingId) {
      try {
        await db.collection('meetings').doc(meetingId).update({
          status: 'error',
          errorMessage: error.message || 'Job submission failed',
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (updateError) {
        console.error('Failed to update error status:', updateError);
      }
    }

    return response.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}
