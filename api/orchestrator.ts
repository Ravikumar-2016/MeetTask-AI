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
  confidence?: number;        // 0.0 - 1.0 confidence in assignment
  sourceSentence?: string;    // Original quote from transcript
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
// SPEAKER TYPES
// ============================================

interface SpeakerUtterance {
  speaker: string;       // "A", "B", "C", etc.
  text: string;
  start: number;         // milliseconds
  end: number;
  confidence: number;
}

interface SpeakerMapping {
  [speakerId: string]: string;  // "A" -> "John" or "Speaker A"
}

interface TranscriptionResult {
  text: string;
  confidence: number;
  duration: number;
  transcriptId: string;
  utterances: SpeakerUtterance[];
  speakerMapping: SpeakerMapping;
}

// ============================================
// ASSEMBLYAI TRANSCRIPTION WITH SPEAKER DIARIZATION
// ============================================

async function transcribeWithAssemblyAI(mediaUrl: string): Promise<TranscriptionResult> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY not set');

  console.log('🎤 [AssemblyAI] Starting transcription with speaker diarization...');
  console.log('📁 [AssemblyAI] Media URL:', mediaUrl.substring(0, 50) + '...');

  // Step 1: Submit transcription request WITH speaker labels
  const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: mediaUrl,
      language_detection: true,
      speaker_labels: true,  // Enable speaker diarization
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
  const maxAttempts = 60;
  let attempts = 0;
  let pollData: any = null;

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: { 'Authorization': apiKey },
    });

    if (!pollRes.ok) {
      throw new Error(`AssemblyAI poll error: ${pollRes.status}`);
    }

    pollData = await pollRes.json();
    console.log('⏳ [AssemblyAI] Status:', pollData.status, `(attempt ${attempts + 1})`);

    if (pollData.status === 'completed') {
      break;
    }

    if (pollData.status === 'error') {
      throw new Error(`AssemblyAI error: ${pollData.error || 'Unknown error'}`);
    }

    attempts++;
  }

  if (!pollData || pollData.status !== 'completed') {
    throw new Error('AssemblyAI transcription timed out');
  }

  console.log('✅ [AssemblyAI] Transcription complete!');

  // Step 3: Extract speaker utterances
  const utterances: SpeakerUtterance[] = (pollData.utterances || []).map((u: any) => ({
    speaker: u.speaker || 'A',
    text: u.text || '',
    start: u.start || 0,
    end: u.end || 0,
    confidence: u.confidence || 0,
  }));

  console.log('👥 [AssemblyAI] Found', utterances.length, 'utterances');

  // Step 4: Map speaker IDs to names (if mentioned)
  const speakerMapping = mapSpeakersToNames(pollData.text || '', utterances);
  console.log('🏷️ [AssemblyAI] Speaker mapping:', speakerMapping);

  return {
    text: pollData.text || '',
    confidence: pollData.confidence || 0,
    duration: pollData.audio_duration || 0,
    transcriptId,
    utterances,
    speakerMapping,
  };
}

// ============================================
// SPEAKER NAME MAPPING
// Attempts to find real names mentioned in transcript
// ============================================

function mapSpeakersToNames(fullText: string, utterances: SpeakerUtterance[]): SpeakerMapping {
  const mapping: SpeakerMapping = {};
  const uniqueSpeakers = [...new Set(utterances.map(u => u.speaker))];
  
  // Common patterns for name introductions
  const namePatterns = [
    /(?:I'm|I am|my name is|this is|hey,? it's|hi,? I'm)\s+([A-Z][a-z]+)/gi,
    /([A-Z][a-z]+)\s+(?:here|speaking)/gi,
  ];

  // Try to find names in the first few utterances of each speaker
  for (const speakerId of uniqueSpeakers) {
    const speakerUtterances = utterances.filter(u => u.speaker === speakerId);
    const firstFewTexts = speakerUtterances.slice(0, 3).map(u => u.text).join(' ');
    
    let foundName: string | null = null;
    
    for (const pattern of namePatterns) {
      const match = pattern.exec(firstFewTexts);
      if (match && match[1]) {
        // Validate it looks like a name (not a common word)
        const possibleName = match[1];
        const commonWords = ['the', 'this', 'that', 'here', 'there', 'just', 'well'];
        if (!commonWords.includes(possibleName.toLowerCase()) && possibleName.length >= 2) {
          foundName = possibleName;
          break;
        }
      }
      pattern.lastIndex = 0; // Reset regex
    }
    
    // Use found name or default to "Speaker X"
    mapping[speakerId] = foundName || `Speaker ${speakerId}`;
  }
  
  return mapping;
}

// ============================================
// ASSEMBLYAI LEMUR - Summary & Task Extraction with Speakers
// ============================================

async function extractSummaryWithLemur(
  transcriptId: string, 
  meetingTitle: string,
  speakerMapping: SpeakerMapping
): Promise<{ summary: string; tasks: ExtractedTask[] }> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY not set');

  console.log('🤖 [AssemblyAI LeMUR] Extracting summary & tasks...');

  // Build speaker context for the AI
  const speakerList = Object.entries(speakerMapping)
    .map(([id, name]) => `Speaker ${id} = ${name}`)
    .join(', ');

  // Use LeMUR for summary
  const summaryRes = await fetch('https://api.assemblyai.com/lemur/v3/generate/summary', {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transcript_ids: [transcriptId],
      context: `Meeting title: ${meetingTitle}. Speakers identified: ${speakerList || 'Unknown'}`,
      answer_format: 'A concise 2-4 sentence summary of the main discussion points, mentioning who said what when relevant.',
    }),
  });

  let summary = 'Meeting transcript processed.';
  if (summaryRes.ok) {
    const summaryData = await summaryRes.json();
    summary = summaryData.response || summary;
    console.log('✅ [LeMUR] Summary generated');
  } else {
    console.log('⚠️ [LeMUR] Summary failed, using default');
  }

  // Use LeMUR for task extraction WITH speaker assignment
  const tasksRes = await fetch('https://api.assemblyai.com/lemur/v3/generate/task', {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transcript_ids: [transcriptId],
      prompt: `You are analyzing a meeting transcript with multiple speakers.
Speakers identified: ${speakerList || 'Unknown speakers'}

Extract all action items and tasks. Pay close attention to WHO is assigned each task.
Look for patterns like:
- "I'll handle...", "I will...", "I'm going to..." (self-assignment by the speaker)
- "Can you...", "[Name], could you...", "You should..." (assignment to another person)
- "[Name] will...", "[Name] is responsible for..." (explicit assignment)

For each task, provide:
- title: A clear, actionable task title (max 10 words)
- description: Brief context about what needs to be done
- assignedTo: The person's name who should do this task. Use actual names if mentioned, otherwise use "Speaker A", "Speaker B", etc. Use "Unassigned" only if truly unclear.
- dueDate: Deadline if mentioned (format: YYYY-MM-DD) or "No deadline"
- priority: high, medium, or low based on urgency language
- confidence: A number 0.0-1.0 indicating how confident you are about this task and its assignment
- sourceSentence: The exact quote from the transcript where this task was mentioned

Return ONLY a valid JSON array. If no tasks found, return [].
Example:
[{"title":"Review proposal","description":"Review the Q1 budget proposal document","assignedTo":"John","dueDate":"2026-02-01","priority":"high","confidence":0.9,"sourceSentence":"John, can you review the Q1 budget proposal by next Monday?"}]`,
    }),
  });

  let tasks: ExtractedTask[] = [];
  if (tasksRes.ok) {
    const tasksData = await tasksRes.json();
    const responseText = tasksData.response || '[]';
    console.log('📋 [LeMUR] Tasks response:', responseText.substring(0, 300));
    
    try {
      // Try to extract JSON array from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const rawTasks = JSON.parse(jsonMatch[0]);
        // Normalize task structure
        tasks = rawTasks.map((t: any) => ({
          title: t.title || 'Untitled Task',
          description: t.description || '',
          assignedTo: t.assignedTo || 'Unassigned',
          dueDate: t.dueDate || 'No deadline',
          priority: t.priority || 'medium',
          confidence: typeof t.confidence === 'number' ? t.confidence : 0.7,
          sourceSentence: t.sourceSentence || '',
        }));
        console.log('✅ [LeMUR] Tasks extracted:', tasks.length);
      }
    } catch (e) {
      console.log('⚠️ [LeMUR] Could not parse tasks, continuing without tasks');
    }
  } else {
    const errText = await tasksRes.text();
    console.log('⚠️ [LeMUR] Tasks extraction failed:', errText);
  }

  return { summary, tasks };
}

// ============================================
// IMAGE TEXT EXTRACTION (Simple - no OpenAI needed)
// For images, we'll create a simple text description
// ============================================

async function extractTextFromImage(imageUrl: string): Promise<{ text: string; wordCount: number }> {
  console.log('🖼️ [Image] Processing image...');
  // For images without OpenAI, return a placeholder
  // The user can view the image directly in the meeting details
  const text = `Image uploaded: ${imageUrl.split('/').pop() || 'meeting-image'}. Please view the image in the meeting details for visual content.`;
  return { text, wordCount: text.split(/\s+/).length };
}

// ============================================
// SIMPLE SUMMARY EXTRACTION (No external API)
// Used as fallback or for images
// ============================================

function extractSimpleSummaryAndTasks(transcript: string, meetingTitle: string): { summary: string; tasks: ExtractedTask[] } {
  console.log('📝 [Simple] Generating basic summary...');
  
  const wordCount = transcript.split(/\s+/).length;
  const preview = transcript.substring(0, 200).trim();
  
  const summary = `Meeting "${meetingTitle}" - ${wordCount} words transcribed. ${preview}...`;
  
  return { summary, tasks: [] };
}

// ============================================
// MAIN PIPELINE
// ============================================

interface PipelineResult {
  transcript: string;
  confidence: number;
  duration: number;
  summary: string;
  tasks: ExtractedTask[];
  utterances: SpeakerUtterance[];
  speakerMapping: SpeakerMapping;
}

async function runPipeline(fileUrl: string, fileType: FileType, meetingTitle: string): Promise<PipelineResult> {
  console.log('🚀 [Pipeline] Starting for:', meetingTitle);
  console.log('📁 [Pipeline] File type:', fileType);

  let transcript = '';
  let confidence = 0;
  let duration = 0;
  let summary = '';
  let tasks: ExtractedTask[] = [];
  let utterances: SpeakerUtterance[] = [];
  let speakerMapping: SpeakerMapping = {};

  // Step 1: Get transcript based on file type
  if (fileType === 'image') {
    const result = await extractTextFromImage(fileUrl);
    transcript = result.text;
    // For images, use simple summary (no LeMUR)
    const extraction = extractSimpleSummaryAndTasks(transcript, meetingTitle);
    summary = extraction.summary;
    tasks = extraction.tasks;
  } else {
    // Audio or Video - use AssemblyAI with speaker diarization
    const result = await transcribeWithAssemblyAI(fileUrl);
    transcript = result.text;
    confidence = result.confidence;
    duration = result.duration;
    utterances = result.utterances;
    speakerMapping = result.speakerMapping;
    
    console.log('👥 [Pipeline] Speakers found:', Object.keys(speakerMapping).length);
    
    // Use AssemblyAI LeMUR for summary & tasks WITH speaker info
    if (result.transcriptId && transcript.length > 10) {
      const extraction = await extractSummaryWithLemur(result.transcriptId, meetingTitle, speakerMapping);
      summary = extraction.summary;
      tasks = extraction.tasks;
    } else {
      // Fallback to simple extraction
      const extraction = extractSimpleSummaryAndTasks(transcript, meetingTitle);
      summary = extraction.summary;
      tasks = extraction.tasks;
    }
  }

  if (!transcript || transcript.trim().length === 0) {
    throw new Error('No transcript could be generated');
  }

  return {
    transcript,
    confidence,
    duration,
    summary,
    tasks,
    utterances,
    speakerMapping,
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

    // Save transcript WITH speaker segments
    await db.collection('transcripts').doc(meetingId).set({
      meetingId,
      userId: user.uid,
      text: result.transcript,
      summary: result.summary,
      confidence: result.confidence,
      duration: result.duration,
      wordCount: result.transcript.split(/\s+/).length,
      // Speaker diarization data
      utterances: result.utterances,
      speakerMapping: result.speakerMapping,
      speakerCount: Object.keys(result.speakerMapping).length,
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log('💾 Transcript saved with', result.utterances.length, 'utterances');

    // Save tasks WITH speaker assignment details
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
          confidence: task.confidence || 0.7,
          sourceSentence: task.sourceSentence || '',
          completed: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      console.log('💾 Tasks saved:', result.tasks.length);
    }

    // Update meeting to completed WITH speaker info
    await meetingRef.update({
      status: 'completed',
      taskCount: result.tasks.length,
      summary: result.summary.substring(0, 500),
      duration: result.duration,
      speakerCount: Object.keys(result.speakerMapping).length,
      speakers: Object.values(result.speakerMapping),
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
