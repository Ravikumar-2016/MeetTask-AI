/**
 * Process Meeting Worker API
 * 
 * POST /api/process-meeting
 * 
 * This is the WORKER that does the actual AI processing.
 * Called by the orchestrator (non-blocking).
 * 
 * Responsibilities:
 * 1. Fetch meeting document
 * 2. Run AI pipeline based on file type
 * 3. Save transcript to Firestore
 * 4. Save tasks to Firestore
 * 5. Update meeting status → "completed"
 * 6. On ANY error → update status → "error"
 * 
 * Request body:
 * { meetingId: string }
 * 
 * IMPORTANT: 
 * - This runs in background (triggered by orchestrator)
 * - Always updates Firestore on success/failure
 * - UI updates automatically via real-time listeners
 * 
 * @module api/process-meeting
 */

// Force Node.js runtime - Edge runtime forces v1beta which breaks Gemini SDK
export const config = {
  runtime: 'nodejs',
};

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb } from './_lib/firebaseAdmin';
import { verifyToken, AuthError } from './_lib/verifyToken';
import { FieldValue } from 'firebase-admin/firestore';
import { runPipeline, ExtractedTask, FileType } from './_lib/aiPipeline';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface ProcessMeetingBody {
  meetingId: string;
}

interface MeetingDoc {
  userId: string;
  title: string;
  fileUrl?: string;
  audioUrl?: string;
  fileType?: FileType;
  status: 'uploaded' | 'processing' | 'completed' | 'error';
}

// ============================================
// HELPER: Update Meeting Status
// ============================================

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
  console.log(`📊 [Worker] Meeting ${meetingId} status → ${status}`);
}

// ============================================
// HELPER: Save Transcript
// ============================================

async function saveTranscript(
  meetingId: string,
  userId: string,
  text: string,
  summary: string
): Promise<void> {
  const transcriptData = {
    meetingId,
    userId,
    text,
    summary,
    wordCount: text.split(/\s+/).length,
    createdAt: FieldValue.serverTimestamp(),
  };

  // Use meetingId as doc ID for easy retrieval
  await adminDb.collection('transcripts').doc(meetingId).set(transcriptData);
  console.log('💾 [Worker] Transcript saved');
}

// ============================================
// HELPER: Save Tasks
// ============================================

async function saveTasks(
  meetingId: string,
  userId: string,
  tasks: ExtractedTask[]
): Promise<number> {
  if (!tasks || tasks.length === 0) {
    console.log('📝 [Worker] No tasks to save');
    return 0;
  }

  const batch = adminDb.batch();
  const tasksRef = adminDb.collection('tasks');

  for (const task of tasks) {
    const taskDoc = tasksRef.doc();
    batch.set(taskDoc, {
      meetingId,
      userId,
      text: task.title,
      title: task.title,
      description: task.description || '',
      assignedTo: task.assignedTo || 'Unassigned',
      dueDate: task.dueDate || 'No deadline',
      priority: task.priority || 'medium',
      completed: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  console.log('💾 [Worker] Tasks saved:', tasks.length);
  return tasks.length;
}

// ============================================
// MAIN HANDLER
// ============================================

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  // ----------------------------------------
  // CORS Headers
  // ----------------------------------------
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  if (request.method !== 'POST') {
    return response.status(405).json({
      success: false,
      error: 'Method not allowed. Use POST.',
    });
  }

  console.log('\n========================================');
  console.log('⚙️ [Worker] Process Meeting Started');
  console.log('========================================\n');

  let meetingId: string | undefined;

  try {
    // ----------------------------------------
    // Step 1: Verify Authentication
    // ----------------------------------------
    console.log('🔐 [Worker] Verifying authentication...');
    const user = await verifyToken(request);
    console.log('✅ [Worker] User:', user.uid);

    // ----------------------------------------
    // Step 2: Validate Request
    // ----------------------------------------
    const body = request.body as ProcessMeetingBody;
    meetingId = body.meetingId;

    if (!meetingId || typeof meetingId !== 'string') {
      return response.status(400).json({
        success: false,
        error: 'meetingId is required',
      });
    }

    console.log('📋 [Worker] Processing meeting:', meetingId);

    // ----------------------------------------
    // Step 3: Fetch Meeting Document
    // ----------------------------------------
    console.log('🔍 [Worker] Fetching meeting...');
    const meetingRef = adminDb.collection('meetings').doc(meetingId);
    const meetingSnap = await meetingRef.get();

    if (!meetingSnap.exists) {
      throw new Error('Meeting not found');
    }

    const meeting = meetingSnap.data() as MeetingDoc;
    console.log('✅ [Worker] Meeting:', meeting.title);

    // ----------------------------------------
    // Step 4: Verify Ownership
    // ----------------------------------------
    if (meeting.userId !== user.uid) {
      throw new Error('Unauthorized: You do not own this meeting');
    }

    // ----------------------------------------
    // Step 5: Check if Already Completed
    // ----------------------------------------
    if (meeting.status === 'completed') {
      console.log('⏭️ [Worker] Already completed, skipping');
      return response.status(200).json({
        success: true,
        message: 'Meeting already processed',
        meetingId,
      });
    }

    // ----------------------------------------
    // Step 6: Get File URL and Type
    // ----------------------------------------
    const fileUrl = meeting.fileUrl || meeting.audioUrl;
    const fileType: FileType = meeting.fileType || 'audio';

    if (!fileUrl) {
      throw new Error('No file URL found in meeting');
    }

    console.log('📁 [Worker] File type:', fileType);
    console.log('🔗 [Worker] File URL:', fileUrl.substring(0, 50) + '...');

    // ----------------------------------------
    // Step 7: Run AI Pipeline
    // ----------------------------------------
    console.log('🤖 [Worker] Running AI pipeline...');
    const result = await runPipeline(fileUrl, fileType, meeting.title);

    // ----------------------------------------
    // Step 8: Save Transcript
    // ----------------------------------------
    console.log('💾 [Worker] Saving transcript...');
    await saveTranscript(meetingId, user.uid, result.transcript, result.summary);

    // ----------------------------------------
    // Step 9: Save Tasks
    // ----------------------------------------
    console.log('💾 [Worker] Saving tasks...');
    const taskCount = await saveTasks(meetingId, user.uid, result.tasks);

    // ----------------------------------------
    // Step 10: Update Meeting → Completed
    // ----------------------------------------
    console.log('✅ [Worker] Updating status to completed...');
    await updateMeetingStatus(meetingId, 'completed', {
      summary: result.summary,
      taskCount,
    });

    // ----------------------------------------
    // Success!
    // ----------------------------------------
    console.log('\n========================================');
    console.log('🎉 [Worker] Processing Complete!');
    console.log('   - Transcript:', result.transcript.length, 'chars');
    console.log('   - Summary:', result.summary.length, 'chars');
    console.log('   - Tasks:', taskCount);
    console.log('========================================\n');

    return response.status(200).json({
      success: true,
      message: 'Meeting processed successfully',
      meetingId,
      taskCount,
    });

  } catch (error: any) {
    // ----------------------------------------
    // Error Handling
    // ----------------------------------------
    console.error('❌ [Worker] Error:', error.message);

    // Always update status to error if we have meetingId
    if (meetingId) {
      try {
        await updateMeetingStatus(meetingId, 'error', {
          errorMessage: error.message || 'Processing failed',
        });
      } catch (updateError) {
        console.error('❌ [Worker] Failed to update error status');
      }
    }

    if (error instanceof AuthError) {
      return response.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    return response.status(500).json({
      success: false,
      error: error.message || 'Processing failed',
      meetingId,
    });
  }
}
