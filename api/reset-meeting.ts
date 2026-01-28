/**
 * Reset Meeting Status API
 * 
 * POST /api/reset-meeting
 * 
 * Resets a stuck meeting back to "uploaded" status so it can be reprocessed.
 * Requires authentication and meeting ownership.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Firebase Admin setup
function initAdmin() {
  if (getApps().length > 0) return getApps()[0];
  
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID!,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
      privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, '\n'),
    }),
  });
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (request.method === 'OPTIONS') return response.status(200).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });

  try {
    initAdmin();
    const db = getFirestore();
    const auth = getAuth();

    // Verify auth
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return response.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const decoded = await auth.verifyIdToken(token);
    const userId = decoded.uid;

    const { meetingId } = request.body;
    if (!meetingId) {
      return response.status(400).json({ error: 'meetingId required' });
    }

    // Get meeting
    const meetingRef = db.collection('meetings').doc(meetingId);
    const meetingSnap = await meetingRef.get();

    if (!meetingSnap.exists) {
      return response.status(404).json({ error: 'Meeting not found' });
    }

    const meeting = meetingSnap.data();
    if (meeting?.userId !== userId) {
      return response.status(403).json({ error: 'Not authorized' });
    }

    // Reset to uploaded status
    await meetingRef.update({
      status: 'uploaded',
      errorMessage: null,
      transcriptId: null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log('[Reset] Meeting', meetingId, 'reset to uploaded');

    return response.status(200).json({
      success: true,
      message: 'Meeting reset to uploaded status',
      meetingId,
    });

  } catch (error: any) {
    console.error('[Reset] Error:', error.message);
    return response.status(500).json({ error: error.message });
  }
}
