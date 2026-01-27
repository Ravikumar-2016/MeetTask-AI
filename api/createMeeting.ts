/**
 * Create Meeting API
 * 
 * POST /api/createMeeting
 * 
 * Creates a new meeting document in Firestore after frontend uploads to Cloudinary.
 * 
 * Request body:
 * {
 *   title: string,
 *   audioUrl: string (Cloudinary URL)
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   meeting: { id, title, userId, audioUrl, status, createdAt }
 * }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb } from '../lib/firebaseAdmin';
import { verifyToken, AuthError } from '../lib/verifyToken';
import { FieldValue } from 'firebase-admin/firestore';

// Request body interface
interface CreateMeetingBody {
  title: string;
  audioUrl: string;
}

// Response meeting interface
interface MeetingResponse {
  id: string;
  title: string;
  userId: string;
  audioUrl: string;
  status: 'uploaded' | 'processing' | 'completed' | 'error';
  createdAt: string;
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
    console.log(`📝 Creating meeting for user: ${user.uid}`);

    // 2. Validate request body
    const { title, audioUrl } = request.body as CreateMeetingBody;

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return response.status(400).json({
        success: false,
        error: 'Title is required and must be a non-empty string.',
      });
    }

    if (!audioUrl || typeof audioUrl !== 'string') {
      return response.status(400).json({
        success: false,
        error: 'Audio URL is required.',
      });
    }

    // Validate Cloudinary URL format
    if (!audioUrl.includes('cloudinary.com') && !audioUrl.includes('res.cloudinary')) {
      return response.status(400).json({
        success: false,
        error: 'Invalid audio URL. Must be a Cloudinary URL.',
      });
    }

    // 3. Create meeting document
    const meetingsRef = adminDb.collection('meetings');
    const meetingData = {
      title: title.trim(),
      userId: user.uid,
      audioUrl: audioUrl,
      status: 'uploaded' as const,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    const docRef = await meetingsRef.add(meetingData);
    console.log(`✅ Meeting created with ID: ${docRef.id}`);

    // 4. Return success response
    const meetingResponse: MeetingResponse = {
      id: docRef.id,
      title: title.trim(),
      userId: user.uid,
      audioUrl: audioUrl,
      status: 'uploaded',
      createdAt: new Date().toISOString(),
    };

    return response.status(201).json({
      success: true,
      meeting: meetingResponse,
    });

  } catch (error: any) {
    console.error('❌ Create meeting error:', error);

    // Handle auth errors
    if (error instanceof AuthError) {
      return response.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }

    // Handle Firestore errors
    if (error.code?.startsWith('firestore/')) {
      return response.status(500).json({
        success: false,
        error: 'Database error. Please try again.',
      });
    }

    // Generic error
    return response.status(500).json({
      success: false,
      error: 'Failed to create meeting. Please try again.',
    });
  }
}
