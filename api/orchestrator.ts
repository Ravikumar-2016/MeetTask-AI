/**
 * Orchestrator API - Backend Brain
 * 
 * POST /api/orchestrator
 * 
 * This is the ENTRY POINT for AI processing.
 * When frontend uploads a file, it calls this endpoint.
 * 
 * Responsibilities:
 * 1. Verify meetingId exists
 * 2. Verify user owns the meeting
 * 3. Update status → "processing"
 * 4. Trigger the worker (process-meeting) asynchronously
 * 5. Return immediately (non-blocking)
 * 
 * Request body:
 * { meetingId: string }
 * 
 * Response:
 * { success: true, message: "Processing started" }
 * 
 * IMPORTANT: This endpoint returns IMMEDIATELY.
 * The actual AI work happens in /api/process-meeting
 * UI updates automatically via Firestore real-time listeners.
 * 
 * @module api/orchestrator
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb } from './_lib/firebaseAdmin';
import { verifyToken, AuthError } from './_lib/verifyToken';
import { FieldValue } from 'firebase-admin/firestore';

// ============================================
// TYPE DEFINITIONS
// ============================================

interface OrchestratorBody {
  meetingId: string;
}

interface MeetingDoc {
  userId: string;
  title: string;
  fileUrl?: string;
  audioUrl?: string;
  fileType?: 'audio' | 'video' | 'image';
  status: 'uploaded' | 'processing' | 'completed' | 'error';
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
  console.log('🎯 [Orchestrator] Request received');
  console.log('========================================\n');

  // ----------------------------------------
  // Step 0: Check Environment Variables
  // ----------------------------------------
  const missingEnvVars: string[] = [];
  if (!process.env.GEMINI_API_KEY) missingEnvVars.push('GEMINI_API_KEY');
  if (!process.env.OPENAI_API_KEY) missingEnvVars.push('OPENAI_API_KEY');
  
  if (missingEnvVars.length > 0) {
    console.error('❌ [Orchestrator] Missing environment variables:', missingEnvVars.join(', '));
    return response.status(500).json({
      success: false,
      error: `Server configuration error: Missing ${missingEnvVars.join(', ')}. Please add these in Vercel Dashboard > Settings > Environment Variables.`,
    });
  }

  try {
    // ----------------------------------------
    // Step 1: Verify Authentication
    // ----------------------------------------
    console.log('🔐 [Orchestrator] Verifying authentication...');
    const user = await verifyToken(request);
    console.log('✅ [Orchestrator] User authenticated:', user.uid);

    // ----------------------------------------
    // Step 2: Validate Request Body
    // ----------------------------------------
    const { meetingId } = request.body as OrchestratorBody;

    if (!meetingId || typeof meetingId !== 'string') {
      console.log('❌ [Orchestrator] Invalid meetingId');
      return response.status(400).json({
        success: false,
        error: 'meetingId is required and must be a string',
      });
    }

    console.log('📋 [Orchestrator] Meeting ID:', meetingId);

    // ----------------------------------------
    // Step 3: Verify Meeting Exists
    // ----------------------------------------
    console.log('🔍 [Orchestrator] Fetching meeting document...');
    const meetingRef = adminDb.collection('meetings').doc(meetingId);
    const meetingSnap = await meetingRef.get();

    if (!meetingSnap.exists) {
      console.log('❌ [Orchestrator] Meeting not found');
      return response.status(404).json({
        success: false,
        error: 'Meeting not found',
      });
    }

    const meeting = meetingSnap.data() as MeetingDoc;
    console.log('✅ [Orchestrator] Meeting found:', meeting.title);

    // ----------------------------------------
    // Step 4: Verify Ownership
    // ----------------------------------------
    if (meeting.userId !== user.uid) {
      console.log('❌ [Orchestrator] User does not own this meeting');
      return response.status(403).json({
        success: false,
        error: 'You do not have permission to process this meeting',
      });
    }

    // ----------------------------------------
    // Step 5: Check Current Status
    // ----------------------------------------
    if (meeting.status === 'processing') {
      console.log('⏳ [Orchestrator] Meeting already processing');
      return response.status(200).json({
        success: true,
        message: 'Meeting is already being processed',
        meetingId,
      });
    }

    if (meeting.status === 'completed') {
      console.log('✅ [Orchestrator] Meeting already completed');
      return response.status(200).json({
        success: true,
        message: 'Meeting has already been processed',
        meetingId,
      });
    }

    // ----------------------------------------
    // Step 6: Update Status to "processing"
    // ----------------------------------------
    console.log('📊 [Orchestrator] Updating status to "processing"...');
    await meetingRef.update({
      status: 'processing',
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log('✅ [Orchestrator] Status updated');

    // ----------------------------------------
    // Step 7: Run AI Pipeline Directly
    // ----------------------------------------
    // Instead of fire-and-forget (which doesn't work reliably on serverless),
    // we run the pipeline directly but structure code so it completes quickly
    // Frontend already navigates away, so user doesn't wait.
    
    console.log('🚀 [Orchestrator] Starting AI processing...');
    
    // Get file URL
    const fileUrl = meeting.fileUrl || meeting.audioUrl;
    if (!fileUrl) {
      await meetingRef.update({
        status: 'error',
        errorMessage: 'No file URL found',
        updatedAt: FieldValue.serverTimestamp(),
      });
      return response.status(400).json({
        success: false,
        error: 'No file URL found in meeting document',
      });
    }
    
    const fileType = (meeting.fileType || 'audio') as 'audio' | 'video' | 'image';
    const meetingTitle = meeting.title || 'Untitled Meeting';
    console.log('📁 [Orchestrator] File URL:', fileUrl);
    console.log('📁 [Orchestrator] File type:', fileType);
    console.log('📁 [Orchestrator] Meeting title:', meetingTitle);
    
    // Import and run pipeline
    const { runPipeline } = await import('./_lib/aiPipeline');
    
    try {
      const pipelineResult = await runPipeline(fileUrl, fileType, meetingTitle);
      
      console.log('✅ [Orchestrator] Pipeline completed');
      console.log('📝 [Orchestrator] Transcript length:', pipelineResult.transcript.length);
      console.log('📝 [Orchestrator] Summary length:', pipelineResult.summary.length);
      console.log('📋 [Orchestrator] Tasks extracted:', pipelineResult.tasks.length);
      
      // Save transcript
      await adminDb.collection('transcripts').doc(meetingId).set({
        meetingId,
        userId: user.uid,
        text: pipelineResult.transcript,
        summary: pipelineResult.summary,
        wordCount: pipelineResult.transcript.split(/\s+/).length,
        createdAt: FieldValue.serverTimestamp(),
      });
      console.log('💾 [Orchestrator] Transcript saved');
      
      // Save tasks
      if (pipelineResult.tasks.length > 0) {
        const batch = adminDb.batch();
        const tasksRef = adminDb.collection('tasks');
        
        for (const task of pipelineResult.tasks) {
          const taskDoc = tasksRef.doc();
          batch.set(taskDoc, {
            meetingId,
            userId: user.uid,
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
        console.log('💾 [Orchestrator] Tasks saved:', pipelineResult.tasks.length);
      }
      
      // Update meeting to completed
      await meetingRef.update({
        status: 'completed',
        taskCount: pipelineResult.tasks.length,
        summary: pipelineResult.summary.substring(0, 500),
        updatedAt: FieldValue.serverTimestamp(),
      });
      
      console.log('✅ [Orchestrator] Meeting completed successfully');
      console.log('========================================\n');
      
      return response.status(200).json({
        success: true,
        message: 'Processing completed',
        meetingId,
        status: 'completed',
        taskCount: pipelineResult.tasks.length,
      });
      
    } catch (pipelineError: any) {
      console.error('❌ [Orchestrator] Pipeline error:', pipelineError.message);
      
      await meetingRef.update({
        status: 'error',
        errorMessage: pipelineError.message || 'AI processing failed',
        updatedAt: FieldValue.serverTimestamp(),
      });
      
      return response.status(500).json({
        success: false,
        error: pipelineError.message || 'AI processing failed',
      });
    }

  } catch (error: any) {
    console.error('❌ [Orchestrator] Error:', error.message);

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
