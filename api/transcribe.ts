/**
 * Transcription API
 * 
 * POST /api/transcribe
 * 
 * Transcribes audio using OpenAI Whisper API and saves transcript to Firestore.
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
 *   transcript: string
 * }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb } from '../lib/firebaseAdmin';
import { verifyToken, AuthError } from '../lib/verifyToken';
import { FieldValue } from 'firebase-admin/firestore';
import OpenAI from 'openai';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Request body interface
interface TranscribeBody {
  meetingId: string;
}

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
    console.log(`🎙️ Transcription requested by user: ${user.uid}`);

    // 2. Validate request body
    const { meetingId } = request.body as TranscribeBody;

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

    // 5. Check if already transcribed
    const transcriptRef = adminDb.collection('transcripts').doc(meetingId);
    const transcriptSnap = await transcriptRef.get();

    if (transcriptSnap.exists) {
      return response.status(200).json({
        success: true,
        meetingId,
        transcript: transcriptSnap.data()?.text,
        message: 'Transcript already exists.',
      });
    }

    // 6. Update meeting status to processing
    await meetingRef.update({
      status: 'processing',
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`📥 Fetching audio from: ${meeting.audioUrl}`);

    // 7. Download audio file from Cloudinary
    const audioResponse = await fetch(meeting.audioUrl);
    
    if (!audioResponse.ok) {
      throw new Error(`Failed to download audio: ${audioResponse.status}`);
    }

    const audioBuffer = await audioResponse.arrayBuffer();
    const audioBlob = new Blob([audioBuffer]);
    
    // Create a File object for OpenAI
    const audioFile = new File([audioBlob], 'audio.mp3', { type: 'audio/mpeg' });

    console.log(`🔄 Sending to OpenAI Whisper...`);

    // 8. Send to OpenAI Whisper for transcription
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'en', // Can be made dynamic based on user preference
      response_format: 'text',
    });

    console.log(`✅ Transcription completed. Length: ${transcription.length} chars`);

    // 9. Save transcript to Firestore
    await transcriptRef.set({
      meetingId,
      userId: user.uid,
      text: transcription,
      wordCount: transcription.split(/\s+/).length,
      createdAt: FieldValue.serverTimestamp(),
    });

    // 10. Update meeting status (still processing until tasks are extracted)
    await meetingRef.update({
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(`💾 Transcript saved for meeting: ${meetingId}`);

    // 11. Return success response
    return response.status(200).json({
      success: true,
      meetingId,
      transcript: transcription,
      wordCount: transcription.split(/\s+/).length,
    });

  } catch (error: any) {
    console.error('❌ Transcription error:', error);

    // Try to update meeting status to error
    try {
      const { meetingId } = request.body as TranscribeBody;
      if (meetingId) {
        await adminDb.collection('meetings').doc(meetingId).update({
          status: 'error',
          errorMessage: error.message || 'Transcription failed',
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

    // Handle OpenAI errors
    if (error.status === 429) {
      return response.status(429).json({
        success: false,
        error: 'Rate limit exceeded. Please try again later.',
      });
    }

    if (error.code === 'insufficient_quota') {
      return response.status(402).json({
        success: false,
        error: 'OpenAI quota exceeded. Please check your billing.',
      });
    }

    // Generic error
    return response.status(500).json({
      success: false,
      error: 'Transcription failed. Please try again.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
}
