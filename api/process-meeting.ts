/**
 * Process Meeting API - AI Transcription + Action Extraction Pipeline
 * 
 * POST /api/process-meeting
 * 
 * This endpoint processes uploaded audio/video meetings:
 * 1. Verifies user authentication
 * 2. Fetches meeting from Firestore
 * 3. If image → marks completed (no transcription needed)
 * 4. If audio/video → transcribes with Gemini
 * 5. Extracts summary + tasks with OpenAI
 * 6. Saves transcript, tasks, and summary to Firestore
 * 7. Updates meeting status
 * 
 * Request body:
 * { meetingId: string }
 * 
 * Required Environment Variables:
 * - GEMINI_API_KEY: Google Gemini API key
 * - OPENAI_API_KEY: OpenAI API key
 * - Firebase Admin credentials (already configured)
 * 
 * @module api/process-meeting
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb } from '../lib/firebaseAdmin';
import { verifyToken, AuthError } from '../lib/verifyToken';
import { FieldValue } from 'firebase-admin/firestore';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface ProcessMeetingBody {
  meetingId: string;
}

interface MeetingDoc {
  title: string;
  userId: string;
  audioUrl: string;
  fileType?: 'image' | 'video' | 'audio';
  status: 'uploaded' | 'processing' | 'completed' | 'error';
  errorMessage?: string;
}

interface ExtractedTask {
  title: string;
  owner: string;
  deadline: string;
  priority: 'high' | 'medium' | 'low';
  description?: string;
}

interface ExtractionResult {
  summary: string;
  tasks: ExtractedTask[];
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Update meeting status in Firestore
 */
async function updateMeetingStatus(
  meetingId: string, 
  status: 'processing' | 'completed' | 'error',
  additionalData?: Record<string, any>
): Promise<void> {
  const updateData: Record<string, any> = {
    status,
    updatedAt: FieldValue.serverTimestamp(),
    ...additionalData,
  };
  
  await adminDb.collection('meetings').doc(meetingId).update(updateData);
  console.log(`📊 Meeting ${meetingId} status updated to: ${status}`);
}

/**
 * Transcribe audio/video using Google Gemini
 * 
 * Gemini can process audio files directly via URL or base64.
 * We use the URL approach for efficiency with Cloudinary files.
 */
async function transcribeWithGemini(audioUrl: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  console.log('🎤 Starting Gemini transcription...');
  console.log('📁 Audio URL:', audioUrl.substring(0, 80) + '...');

  // Gemini API endpoint for audio transcription
  // Using gemini-1.5-flash for fast transcription
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: `You are a professional transcriptionist. Please transcribe the following audio/video file accurately. 
            
Instructions:
- Transcribe ALL spoken words exactly as heard
- Include speaker labels if multiple speakers are detected (e.g., "Speaker 1:", "Speaker 2:")
- Include timestamps every few minutes if the audio is long
- Preserve the natural flow and punctuation
- If any part is unclear, mark it as [inaudible]
- Do NOT summarize - provide the full verbatim transcript

Output the transcript directly without any preamble or explanation.`
          },
          {
            fileData: {
              mimeType: getMimeType(audioUrl),
              fileUri: audioUrl
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1, // Low temperature for accurate transcription
      maxOutputTokens: 8192,
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ Gemini API error:', response.status, errorText);
    throw new Error(`Gemini transcription failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  
  // Extract transcript from Gemini response
  const transcript = result.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!transcript) {
    console.error('❌ No transcript in Gemini response:', JSON.stringify(result, null, 2));
    throw new Error('Gemini returned empty transcript');
  }

  console.log('✅ Transcription complete. Length:', transcript.length, 'characters');
  return transcript;
}

/**
 * Get MIME type from URL
 */
function getMimeType(url: string): string {
  const extension = url.split('.').pop()?.toLowerCase().split('?')[0];
  
  const mimeTypes: Record<string, string> = {
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'webm': 'video/webm',
    'm4a': 'audio/mp4',
    'ogg': 'audio/ogg',
    'flac': 'audio/flac',
  };
  
  return mimeTypes[extension || ''] || 'audio/mpeg';
}

/**
 * Extract summary and tasks using OpenAI
 * 
 * Uses GPT-4o-mini for cost-effective structured extraction.
 */
async function extractWithOpenAI(transcript: string, meetingTitle: string): Promise<ExtractionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  console.log('🤖 Starting OpenAI extraction...');

  const systemPrompt = `You are an AI assistant that analyzes meeting transcripts to extract actionable insights.

Your task is to:
1. Write a concise summary (2-4 sentences) of the meeting
2. Extract all action items/tasks mentioned

For each task, identify:
- title: Clear, actionable task title
- owner: Who is responsible (use "Unassigned" if unclear)
- deadline: When it's due (use ISO date format YYYY-MM-DD, or "No deadline" if not specified)
- priority: high, medium, or low (based on urgency/importance mentioned)
- description: Brief context about the task

IMPORTANT: 
- Only extract REAL tasks mentioned in the transcript
- If no tasks are mentioned, return an empty tasks array
- Be specific with task titles (avoid vague descriptions)
- Deadline must be a valid date or "No deadline"

Respond ONLY with valid JSON in this exact format:
{
  "summary": "string",
  "tasks": [
    {
      "title": "string",
      "owner": "string",
      "deadline": "YYYY-MM-DD or No deadline",
      "priority": "high|medium|low",
      "description": "string"
    }
  ]
}`;

  const userPrompt = `Meeting Title: ${meetingTitle}

Transcript:
${transcript}

Extract the summary and all action items from this meeting transcript.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3, // Low temperature for consistent extraction
      max_tokens: 2000,
      response_format: { type: 'json_object' }, // Force JSON response
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ OpenAI API error:', response.status, errorText);
    throw new Error(`OpenAI extraction failed: ${response.status}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('OpenAI returned empty response');
  }

  try {
    const extracted: ExtractionResult = JSON.parse(content);
    console.log('✅ Extraction complete. Summary length:', extracted.summary?.length);
    console.log('✅ Tasks extracted:', extracted.tasks?.length || 0);
    return extracted;
  } catch (parseError) {
    console.error('❌ Failed to parse OpenAI response:', content);
    throw new Error('Failed to parse extraction result as JSON');
  }
}

/**
 * Save transcript to Firestore
 */
async function saveTranscript(
  meetingId: string, 
  userId: string, 
  transcript: string
): Promise<void> {
  const transcriptData = {
    meetingId,
    userId,
    text: transcript,
    wordCount: transcript.split(/\s+/).length,
    createdAt: FieldValue.serverTimestamp(),
  };

  // Use meetingId as document ID for easy retrieval
  await adminDb.collection('transcripts').doc(meetingId).set(transcriptData);
  console.log('💾 Transcript saved. Word count:', transcriptData.wordCount);
}

/**
 * Save tasks to Firestore
 */
async function saveTasks(
  meetingId: string, 
  userId: string, 
  tasks: ExtractedTask[]
): Promise<number> {
  if (!tasks || tasks.length === 0) {
    console.log('📝 No tasks to save');
    return 0;
  }

  const batch = adminDb.batch();
  const tasksRef = adminDb.collection('tasks');

  for (const task of tasks) {
    const taskDoc = tasksRef.doc(); // Auto-generate ID
    batch.set(taskDoc, {
      meetingId,
      userId,
      title: task.title,
      owner: task.owner || 'Unassigned',
      deadline: task.deadline || 'No deadline',
      priority: task.priority || 'medium',
      description: task.description || '',
      status: 'pending',
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  console.log('💾 Tasks saved:', tasks.length);
  return tasks.length;
}

/**
 * Main processing function
 * 
 * Orchestrates the entire pipeline:
 * 1. Update status to processing
 * 2. Skip if image
 * 3. Transcribe with Gemini
 * 4. Extract with OpenAI
 * 5. Save all data
 * 6. Update status to completed
 */
async function processMeeting(meetingId: string, userId: string): Promise<void> {
  console.log('\n========================================');
  console.log(`🚀 Processing meeting: ${meetingId}`);
  console.log('========================================\n');

  // 1. Get meeting document
  const meetingRef = adminDb.collection('meetings').doc(meetingId);
  const meetingSnap = await meetingRef.get();

  if (!meetingSnap.exists) {
    throw new Error('Meeting not found');
  }

  const meeting = meetingSnap.data() as MeetingDoc;

  // Verify ownership
  if (meeting.userId !== userId) {
    throw new Error('Unauthorized: You do not own this meeting');
  }

  // 2. Check if already processed
  if (meeting.status === 'completed') {
    console.log('⏭️ Meeting already completed, skipping');
    return;
  }

  if (meeting.status === 'processing') {
    console.log('⏭️ Meeting already being processed, skipping');
    return;
  }

  // 3. Update status to processing
  await updateMeetingStatus(meetingId, 'processing');

  // 4. Check file type - skip transcription for images
  if (meeting.fileType === 'image') {
    console.log('🖼️ Image file detected - skipping transcription');
    await updateMeetingStatus(meetingId, 'completed', {
      summary: 'Image uploaded - no transcription available',
      taskCount: 0,
    });
    return;
  }

  // 5. Get audio/video URL
  const mediaUrl = meeting.audioUrl;
  if (!mediaUrl) {
    throw new Error('No media URL found in meeting');
  }

  // 6. Transcribe with Gemini
  console.log('\n--- STAGE 1: TRANSCRIPTION ---');
  const transcript = await transcribeWithGemini(mediaUrl);

  // 7. Save transcript
  await saveTranscript(meetingId, userId, transcript);

  // 8. Extract summary and tasks with OpenAI
  console.log('\n--- STAGE 2: EXTRACTION ---');
  const extraction = await extractWithOpenAI(transcript, meeting.title);

  // 9. Save tasks
  const taskCount = await saveTasks(meetingId, userId, extraction.tasks);

  // 10. Update meeting with summary and completion status
  console.log('\n--- STAGE 3: FINALIZATION ---');
  await updateMeetingStatus(meetingId, 'completed', {
    summary: extraction.summary,
    taskCount: taskCount,
  });

  console.log('\n========================================');
  console.log(`✅ Meeting ${meetingId} processed successfully!`);
  console.log(`   - Transcript: ${transcript.length} characters`);
  console.log(`   - Tasks: ${taskCount}`);
  console.log('========================================\n');
}

// ============================================
// API HANDLER
// ============================================

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  // Set CORS headers
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  // Only allow POST
  if (request.method !== 'POST') {
    return response.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.',
    });
  }

  try {
    // 1. Verify authentication
    const user = await verifyToken(request);
    console.log(`🔐 Authenticated user: ${user.uid}`);

    // 2. Validate request body
    const { meetingId } = request.body as ProcessMeetingBody;

    if (!meetingId || typeof meetingId !== 'string') {
      return response.status(400).json({
        success: false,
        error: 'meetingId is required',
      });
    }

    // 3. Start processing (async - don't await for long operations)
    // For Vercel, we need to complete within the timeout (10s for hobby, 60s for pro)
    // So we run synchronously but return early if needed
    
    try {
      await processMeeting(meetingId, user.uid);
      
      return response.status(200).json({
        success: true,
        message: 'Meeting processed successfully',
        meetingId,
      });
    } catch (processingError: any) {
      console.error('❌ Processing error:', processingError.message);
      
      // Update meeting status to error
      try {
        await updateMeetingStatus(meetingId, 'error', {
          errorMessage: processingError.message || 'Unknown processing error',
        });
      } catch (statusError) {
        console.error('❌ Failed to update error status:', statusError);
      }

      return response.status(500).json({
        success: false,
        error: processingError.message || 'Processing failed',
        meetingId,
      });
    }

  } catch (error: any) {
    console.error('❌ API Error:', error.message);

    // Handle auth errors
    if (error instanceof AuthError) {
      return response.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    return response.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}
