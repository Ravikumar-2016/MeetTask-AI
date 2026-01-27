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
import { adminDb } from '../lib/firebaseAdmin';
import { verifyToken, AuthError } from '../lib/verifyToken';
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
    // Step 7: Trigger Worker (Non-Blocking)
    // ----------------------------------------
    console.log('🚀 [Orchestrator] Triggering worker...');
    
    // Get the base URL for the worker
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_VERCEL_URL
        ? `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`
        : 'http://localhost:3000';
    
    const workerUrl = `${baseUrl}/api/process-meeting`;
    console.log('📡 [Orchestrator] Worker URL:', workerUrl);

    // Fire and forget - don't await the worker
    // This allows us to return immediately
    fetch(workerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': request.headers.authorization || '',
      },
      body: JSON.stringify({ meetingId }),
    }).then(res => {
      console.log('📬 [Orchestrator] Worker triggered, status:', res.status);
    }).catch(err => {
      console.error('❌ [Orchestrator] Failed to trigger worker:', err.message);
      // Update status to error if worker fails to start
      meetingRef.update({
        status: 'error',
        errorMessage: 'Failed to start processing',
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    // ----------------------------------------
    // Step 8: Return Immediately
    // ----------------------------------------
    console.log('✅ [Orchestrator] Returning success (processing started)');
    console.log('========================================\n');

    return response.status(200).json({
      success: true,
      message: 'Processing started. The meeting will be updated automatically.',
      meetingId,
      status: 'processing',
    });

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
