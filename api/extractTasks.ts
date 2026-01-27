/**
 * Task Extraction API
 * 
 * POST /api/extractTasks
 * 
 * Extracts action items/tasks from meeting transcript using Google Gemini.
 * Saves tasks to Firestore and updates meeting status to completed.
 * 
 * Request body:
 * {
 *   meetingId: string
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   meetingId: string,
 *   tasks: Task[]
 * }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb } from './_lib/firebaseAdmin';
import { verifyToken, AuthError } from './_lib/verifyToken';
import { FieldValue } from 'firebase-admin/firestore';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Task interface matching frontend types
interface ExtractedTask {
  title: string;
  description: string;
  owner: string;
  deadline: string;
  priority: 'high' | 'medium' | 'low';
}

// Request body interface
interface ExtractTasksBody {
  meetingId: string;
}

// Prompt for Gemini to extract tasks
const EXTRACTION_PROMPT = `You are an expert at extracting action items and tasks from meeting transcripts.

Analyze the following meeting transcript and extract ALL action items, tasks, and commitments mentioned.

For each task, provide:
1. title: A clear, concise title (max 100 chars)
2. description: Detailed description of what needs to be done
3. owner: The person responsible (use "Unassigned" if not mentioned)
4. deadline: The deadline mentioned (use "TBD" if not specified, or extract dates like "next week", "by Friday", etc.)
5. priority: high/medium/low based on urgency words used

Rules:
- Extract EVERY actionable item, even small ones
- If someone says "I will...", "We need to...", "Let's...", "Can you...", etc., that's likely a task
- Be thorough - it's better to extract too many tasks than miss important ones
- Return valid JSON only, no markdown formatting
- If no tasks found, return an empty array

Return ONLY a JSON array in this exact format:
[
  {
    "title": "Task title here",
    "description": "Detailed description",
    "owner": "Person name or Unassigned",
    "deadline": "Date or TBD",
    "priority": "high|medium|low"
  }
]

TRANSCRIPT:
`;

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
    console.log(`📋 Task extraction requested by user: ${user.uid}`);

    // 2. Validate request body
    const { meetingId } = request.body as ExtractTasksBody;

    if (!meetingId || typeof meetingId !== 'string') {
      return response.status(400).json({
        success: false,
        error: 'Meeting ID is required.',
      });
    }

    // 3. Get meeting document
    const meetingRef = adminDb.collection('meetings').doc(meetingId);
    const meetingSnap = await meetingRef.get();

    if (!meetingSnap.exists) {
      return response.status(404).json({
        success: false,
        error: 'Meeting not found.',
      });
    }

    const meeting = meetingSnap.data();

    // 4. Verify user owns this meeting
    if (meeting?.userId !== user.uid) {
      return response.status(403).json({
        success: false,
        error: 'You do not have permission to access this meeting.',
      });
    }

    // 5. Get transcript
    const transcriptRef = adminDb.collection('transcripts').doc(meetingId);
    const transcriptSnap = await transcriptRef.get();

    if (!transcriptSnap.exists) {
      return response.status(400).json({
        success: false,
        error: 'Transcript not found. Please transcribe the meeting first.',
      });
    }

    const transcript = transcriptSnap.data()?.text;

    if (!transcript || transcript.trim() === '') {
      return response.status(400).json({
        success: false,
        error: 'Transcript is empty.',
      });
    }

    console.log(`🔄 Sending transcript to Gemini (${transcript.length} chars)...`);

    // 6. Update meeting status to processing
    await meetingRef.update({
      status: 'processing',
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 7. Send to Gemini for task extraction
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const result = await model.generateContent(EXTRACTION_PROMPT + transcript);
    const responseText = result.response.text();

    console.log(`📝 Gemini response received`);

    // 8. Parse JSON response
    let extractedTasks: ExtractedTask[] = [];
    
    try {
      // Clean up response (remove markdown code blocks if present)
      let cleanedResponse = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      extractedTasks = JSON.parse(cleanedResponse);
      
      // Validate it's an array
      if (!Array.isArray(extractedTasks)) {
        throw new Error('Response is not an array');
      }
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', responseText);
      // Return empty tasks rather than failing
      extractedTasks = [];
    }

    console.log(`✅ Extracted ${extractedTasks.length} tasks`);

    // 9. Save tasks to Firestore
    const tasksRef = adminDb.collection('tasks');
    const savedTasks: any[] = [];

    for (const task of extractedTasks) {
      // Validate and sanitize task data
      const taskData = {
        meetingId,
        userId: user.uid,
        title: String(task.title || 'Untitled Task').slice(0, 200),
        description: String(task.description || '').slice(0, 2000),
        owner: String(task.owner || 'Unassigned').slice(0, 100),
        deadline: String(task.deadline || 'TBD').slice(0, 50),
        priority: ['high', 'medium', 'low'].includes(task.priority) ? task.priority : 'medium',
        status: 'pending' as const,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      const taskDocRef = await tasksRef.add(taskData);
      
      savedTasks.push({
        id: taskDocRef.id,
        ...taskData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    // 10. Update meeting status to completed
    await meetingRef.update({
      status: 'completed',
      taskCount: savedTasks.length,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`💾 Saved ${savedTasks.length} tasks for meeting: ${meetingId}`);

    // 11. Return success response
    return response.status(200).json({
      success: true,
      meetingId,
      taskCount: savedTasks.length,
      tasks: savedTasks,
    });

  } catch (error: any) {
    console.error('❌ Task extraction error:', error);

    // Try to update meeting status to error
    try {
      const { meetingId } = request.body as ExtractTasksBody;
      if (meetingId) {
        await adminDb.collection('meetings').doc(meetingId).update({
          status: 'error',
          errorMessage: error.message || 'Task extraction failed',
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    } catch (updateError) {
      console.error('Failed to update meeting status:', updateError);
    }

    // Handle auth errors
    if (error instanceof AuthError) {
      return response.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    // Handle Gemini errors
    if (error.message?.includes('quota') || error.message?.includes('rate')) {
      return response.status(429).json({
        success: false,
        error: 'API rate limit exceeded. Please try again later.',
      });
    }

    // Generic error
    return response.status(500).json({
      success: false,
      error: 'Task extraction failed. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}
