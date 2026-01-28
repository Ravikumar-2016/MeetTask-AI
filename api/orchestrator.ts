/**
 * Orchestrator API - Self-contained for Vercel
 * 
 * POST /api/orchestrator
 * 
 * This is the ENTRY POINT for AI processing.
 * All dependencies are inlined to avoid Vercel bundling issues.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ============================================
// INLINE: Firebase Admin Setup
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
// INLINE: Token Verification
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
  
  if (!token) {
    throw new Error('Empty token');
  }

  const auth = getAdminAuth();
  const decodedToken = await auth.verifyIdToken(token);
  
  return {
    uid: decodedToken.uid,
    email: decodedToken.email,
  };
}

// ============================================
// INLINE: AI Pipeline Types
// ============================================
interface ExtractedTask {
  title: string;
  description: string;
  assignedTo: string;
  dueDate: string;
  priority: 'high' | 'medium' | 'low';
}

interface PipelineResult {
  transcript: string;
  summary: string;
  tasks: ExtractedTask[];
}

type FileType = 'audio' | 'video' | 'image';

// ============================================
// INLINE: Helper to download file as Buffer
// ============================================

async function downloadFile(url: string): Promise<Buffer> {
  console.log('📥 [Pipeline] Downloading file...');
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  console.log('✅ [Pipeline] Downloaded, size:', Math.round(buffer.length / 1024), 'KB');
  return buffer;
}

// ============================================
// INLINE: AI Pipeline Functions using OpenAI
// ============================================

function getFileExtension(url: string): string {
  return url.split('.').pop()?.toLowerCase().split('?')[0] || 'mp4';
}

// Transcribe using OpenAI Whisper API
async function transcribeMedia(mediaUrl: string, fileType: FileType): Promise<{ text: string; wordCount: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  console.log('🎤 [Pipeline] Transcribing with OpenAI Whisper...');

  // Download the file
  const fileBuffer = await downloadFile(mediaUrl);
  const extension = getFileExtension(mediaUrl);
  
  // Create form data for Whisper API
  const formData = new FormData();
  const blob = new Blob([fileBuffer], { type: `${fileType}/${extension}` });
  formData.append('file', blob, `audio.${extension}`);
  formData.append('model', 'whisper-1');
  formData.append('response_format', 'text');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Whisper error: ${res.status} - ${errText}`);
  }

  const text = await res.text();
  
  if (!text || text.trim().length === 0) {
    throw new Error('Whisper returned empty transcript');
  }
  
  console.log('✅ [Pipeline] Transcription done:', text.length, 'chars');
  return { text: text.trim(), wordCount: text.trim().split(/\s+/).length };
}

// Extract text from image using OpenAI GPT-4 Vision
async function extractTextFromImage(imageUrl: string): Promise<{ text: string; wordCount: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  console.log('🖼️ [Pipeline] Extracting text from image with GPT-4 Vision...');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Extract all text from this image. Also describe any diagrams, action items, or tasks visible.' },
          { type: 'image_url', image_url: { url: imageUrl } }
        ]
      }],
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GPT-4 Vision error: ${res.status} - ${errText}`);
  }

  const result = await res.json();
  const text = result.choices?.[0]?.message?.content || '';
  
  console.log('✅ [Pipeline] Image extraction done:', text.length, 'chars');
  return { text, wordCount: text.split(/\s+/).length };
}

async function extractSummaryAndTasks(transcript: string, meetingTitle: string): Promise<{ summary: string; tasks: ExtractedTask[] }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  console.log('🤖 [Pipeline] Extracting summary & tasks...');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Extract summary and tasks from meeting content. Return JSON: {"summary":"string","tasks":[{"title":"string","description":"string","assignedTo":"string","dueDate":"string","priority":"high|medium|low"}]}`
        },
        { role: 'user', content: `Meeting: ${meetingTitle}\n\nContent:\n${transcript.substring(0, 10000)}` }
      ],
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);

  const result = await res.json();
  const content = result.choices?.[0]?.message?.content;
  
  const parsed = JSON.parse(content || '{"summary":"","tasks":[]}');
  console.log('✅ [Pipeline] Extraction done. Tasks:', parsed.tasks?.length || 0);
  
  return parsed;
}

async function runPipeline(fileUrl: string, fileType: FileType, meetingTitle: string): Promise<PipelineResult> {
  console.log('🚀 [Pipeline] Starting for:', meetingTitle);

  // Step 1: Get text
  let transcription;
  if (fileType === 'image') {
    transcription = await extractTextFromImage(fileUrl);
  } else {
    transcription = await transcribeMedia(fileUrl, fileType);
  }

  // Step 2: Extract summary and tasks
  const extraction = await extractSummaryAndTasks(transcription.text, meetingTitle);

  return {
    transcript: transcription.text,
    summary: extraction.summary,
    tasks: extraction.tasks || [],
  };
}

// ============================================
// MAIN HANDLER
// ============================================

interface MeetingDoc {
  userId: string;
  title: string;
  fileUrl?: string;
  audioUrl?: string;
  fileType?: FileType;
  status: string;
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  // CORS
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (request.method === 'OPTIONS') return response.status(200).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });

  console.log('\n🎯 [Orchestrator] Request received');

  try {
    // Check env vars
    if (!process.env.GEMINI_API_KEY || !process.env.OPENAI_API_KEY) {
      return response.status(500).json({
        success: false,
        error: 'Missing GEMINI_API_KEY or OPENAI_API_KEY in environment variables',
      });
    }

    // Auth
    console.log('🔐 Verifying auth...');
    const user = await verifyToken(request);
    console.log('✅ User:', user.uid);

    // Get meetingId
    const { meetingId } = request.body;
    if (!meetingId) {
      return response.status(400).json({ success: false, error: 'meetingId required' });
    }

    const db = getAdminDb();
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

    // Check status
    if (meeting.status === 'completed') {
      return response.status(200).json({ success: true, message: 'Already processed' });
    }

    // Update to processing
    await meetingRef.update({ status: 'processing', updatedAt: FieldValue.serverTimestamp() });
    console.log('📊 Status → processing');

    // Get file URL
    const fileUrl = meeting.fileUrl || meeting.audioUrl;
    if (!fileUrl) {
      await meetingRef.update({ status: 'error', errorMessage: 'No file URL' });
      return response.status(400).json({ success: false, error: 'No file URL found' });
    }

    const fileType = (meeting.fileType || 'video') as FileType;
    console.log('📁 File:', fileUrl.substring(0, 50) + '...');
    console.log('📁 Type:', fileType);

    // Run AI pipeline
    const result = await runPipeline(fileUrl, fileType, meeting.title || 'Untitled');

    // Save transcript
    await db.collection('transcripts').doc(meetingId).set({
      meetingId,
      userId: user.uid,
      text: result.transcript,
      summary: result.summary,
      wordCount: result.transcript.split(/\s+/).length,
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log('💾 Transcript saved');

    // Save tasks
    if (result.tasks.length > 0) {
      const batch = db.batch();
      for (const task of result.tasks) {
        const taskDoc = db.collection('tasks').doc();
        batch.set(taskDoc, {
          meetingId,
          userId: user.uid,
          title: task.title,
          text: task.title,
          description: task.description || '',
          assignedTo: task.assignedTo || 'Unassigned',
          dueDate: task.dueDate || 'No deadline',
          priority: task.priority || 'medium',
          completed: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      console.log('💾 Tasks saved:', result.tasks.length);
    }

    // Update meeting to completed
    await meetingRef.update({
      status: 'completed',
      taskCount: result.tasks.length,
      summary: result.summary.substring(0, 500),
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log('✅ [Orchestrator] Complete!');

    return response.status(200).json({
      success: true,
      message: 'Processing completed',
      meetingId,
      taskCount: result.tasks.length,
    });

  } catch (error: any) {
    console.error('❌ [Orchestrator] Error:', error.message);

    // Try to update meeting status to error
    try {
      const { meetingId } = request.body;
      if (meetingId) {
        const db = getAdminDb();
        await db.collection('meetings').doc(meetingId).update({
          status: 'error',
          errorMessage: error.message,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    } catch {}

    return response.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}
