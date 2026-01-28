/**
 * Orchestrator API - Meeting Processing with AssemblyAI
 * 
 * POST /api/orchestrator
 * 
 * Flow:
 * 1. Verify auth & meeting ownership
 * 2. Update status → "processing"
 * 3. Transcribe with AssemblyAI (audio/video) or GPT-4 Vision (images)
 * 4. Extract summary & tasks with GPT-4o-mini
 * 5. Save transcript & tasks to Firestore
 * 6. Update status → "completed" (or "error")
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
interface ExtractedTask {
  title: string;
  description: string;
  assignedTo: string;
  dueDate: string;
  priority: 'high' | 'medium' | 'low';
}

interface MeetingDoc {
  userId: string;
  title: string;
  fileUrl?: string;
  audioUrl?: string;
  fileType?: 'audio' | 'video' | 'image';
  status: string;
}

type FileType = 'audio' | 'video' | 'image';

// ============================================
// ASSEMBLYAI TRANSCRIPTION
// ============================================

async function transcribeWithAssemblyAI(mediaUrl: string): Promise<{ text: string; confidence: number; duration: number }> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY not set');

  console.log('🎤 [AssemblyAI] Starting transcription...');
  console.log('📁 [AssemblyAI] Media URL:', mediaUrl.substring(0, 50) + '...');

  // Step 1: Submit transcription request
  const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: mediaUrl,
      language_detection: true,
    }),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`AssemblyAI submit error: ${submitRes.status} - ${errText}`);
  }

  const submitData = await submitRes.json();
  const transcriptId = submitData.id;
  console.log('📝 [AssemblyAI] Transcript ID:', transcriptId);

  // Step 2: Poll for completion (max 5 minutes)
  const maxAttempts = 60; // 60 * 5s = 5 minutes
  let attempts = 0;

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
    
    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: { 'Authorization': apiKey },
    });

    if (!pollRes.ok) {
      throw new Error(`AssemblyAI poll error: ${pollRes.status}`);
    }

    const pollData = await pollRes.json();
    console.log('⏳ [AssemblyAI] Status:', pollData.status, `(attempt ${attempts + 1})`);

    if (pollData.status === 'completed') {
      console.log('✅ [AssemblyAI] Transcription complete!');
      return {
        text: pollData.text || '',
        confidence: pollData.confidence || 0,
        duration: pollData.audio_duration || 0,
      };
    }

    if (pollData.status === 'error') {
      throw new Error(`AssemblyAI error: ${pollData.error || 'Unknown error'}`);
    }

    attempts++;
  }

  throw new Error('AssemblyAI transcription timed out after 5 minutes');
}

// ============================================
// IMAGE TEXT EXTRACTION (GPT-4 Vision)
// ============================================

async function extractTextFromImage(imageUrl: string): Promise<{ text: string; wordCount: number }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  console.log('🖼️ [GPT-4] Extracting text from image...');

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
  
  console.log('✅ [GPT-4] Image extraction done:', text.length, 'chars');
  return { text, wordCount: text.split(/\s+/).length };
}

// ============================================
// SUMMARY & TASK EXTRACTION (GPT-4o-mini)
// ============================================

async function extractSummaryAndTasks(transcript: string, meetingTitle: string): Promise<{ summary: string; tasks: ExtractedTask[] }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  console.log('🤖 [GPT-4] Extracting summary & tasks...');

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
          content: `Extract summary and tasks from meeting content. Return JSON only:
{
  "summary": "2-4 sentence summary",
  "tasks": [
    {
      "title": "task title",
      "description": "brief description",
      "assignedTo": "person name or Unassigned",
      "dueDate": "YYYY-MM-DD or No deadline",
      "priority": "high|medium|low"
    }
  ]
}
If no tasks found, return empty tasks array.`
        },
        { role: 'user', content: `Meeting: ${meetingTitle}\n\nTranscript:\n${transcript.substring(0, 12000)}` }
      ],
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GPT-4 extraction error: ${res.status} - ${errText}`);
  }

  const result = await res.json();
  const content = result.choices?.[0]?.message?.content;
  
  try {
    const parsed = JSON.parse(content || '{"summary":"","tasks":[]}');
    console.log('✅ [GPT-4] Extraction done. Tasks:', parsed.tasks?.length || 0);
    return {
      summary: parsed.summary || 'No summary available.',
      tasks: parsed.tasks || [],
    };
  } catch {
    console.error('Failed to parse GPT response');
    return { summary: 'Processing complete.', tasks: [] };
  }
}

// ============================================
// MAIN PIPELINE
// ============================================

async function runPipeline(fileUrl: string, fileType: FileType, meetingTitle: string) {
  console.log('🚀 [Pipeline] Starting for:', meetingTitle);
  console.log('📁 [Pipeline] File type:', fileType);

  let transcript = '';
  let confidence = 0;
  let duration = 0;

  // Step 1: Get transcript based on file type
  if (fileType === 'image') {
    const result = await extractTextFromImage(fileUrl);
    transcript = result.text;
  } else {
    // Audio or Video - use AssemblyAI
    const result = await transcribeWithAssemblyAI(fileUrl);
    transcript = result.text;
    confidence = result.confidence;
    duration = result.duration;
  }

  if (!transcript || transcript.trim().length === 0) {
    throw new Error('No transcript could be generated');
  }

  // Step 2: Extract summary and tasks
  const extraction = await extractSummaryAndTasks(transcript, meetingTitle);

  return {
    transcript,
    confidence,
    duration,
    summary: extraction.summary,
    tasks: extraction.tasks,
  };
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
  console.log('🎯 [Orchestrator] Request received');
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
    if (!process.env.OPENAI_API_KEY) {
      return response.status(500).json({
        success: false,
        error: 'OPENAI_API_KEY not configured',
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

    // Check if already completed
    if (meeting.status === 'completed') {
      return response.status(200).json({ success: true, message: 'Already processed' });
    }

    // Update to processing
    await meetingRef.update({ 
      status: 'processing', 
      updatedAt: FieldValue.serverTimestamp() 
    });
    console.log('📊 Status → processing');

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

    const fileType = (meeting.fileType || 'video') as FileType;
    console.log('📁 File URL:', fileUrl.substring(0, 60) + '...');
    console.log('📁 File type:', fileType);

    // Run AI pipeline
    const result = await runPipeline(fileUrl, fileType, meeting.title || 'Untitled');

    // Save transcript
    await db.collection('transcripts').doc(meetingId).set({
      meetingId,
      userId: user.uid,
      text: result.transcript,
      summary: result.summary,
      confidence: result.confidence,
      duration: result.duration,
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
      duration: result.duration,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log('\n========================================');
    console.log('✅ [Orchestrator] Processing complete!');
    console.log('========================================\n');

    return response.status(200).json({
      success: true,
      message: 'Processing completed',
      meetingId,
      taskCount: result.tasks.length,
    });

  } catch (error: any) {
    console.error('❌ [Orchestrator] Error:', error.message);

    // Update meeting status to error
    if (meetingId) {
      try {
        await db.collection('meetings').doc(meetingId).update({
          status: 'error',
          errorMessage: error.message || 'Processing failed',
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
