/**
 * Reset Meeting Status API
 * 
 * POST /api/reset-meeting
 * 
 * Resets a meeting to allow reprocessing.
 * - targetStatus: 'uploaded' (re-transcribe) or 'needs_mapping' (re-extract tasks)
 * 
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

    const { meetingId, targetStatus = 'uploaded' } = request.body;
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

    // Handle different reset targets
    if (targetStatus === 'needs_mapping') {
      // Reset to needs_mapping - keep transcript, just re-extract tasks
      
      // Delete existing tasks for this meeting
      const tasksSnap = await db.collection('tasks').where('meetingId', '==', meetingId).get();
      const batch = db.batch();
      tasksSnap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      console.log('[Reset] Deleted', tasksSnap.size, 'existing tasks');
      
      // Reset mapping flags
      await meetingRef.update({
        status: 'needs_mapping',
        speakerMapping: null,
        speakerMappingComplete: false,
        taskCount: 0,
        errorMessage: null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      
      // Also reset transcript mapping flags
      await db.collection('transcripts').doc(meetingId).update({
        speakerMapping: null,
        speakerMappingComplete: false,
        updatedAt: FieldValue.serverTimestamp(),
      }).catch(() => {}); // Ignore if transcript doesn't exist
      
      console.log('[Reset] Meeting', meetingId, 'reset to needs_mapping');
    } else {
      // Reset to uploaded status (full re-transcription)
      await meetingRef.update({
        status: 'uploaded',
        errorMessage: null,
        transcriptId: null,
        speakerMapping: null,
        speakerMappingComplete: false,
        taskCount: 0,
        updatedAt: FieldValue.serverTimestamp(),
      });
      
      console.log('[Reset] Meeting', meetingId, 'reset to uploaded');
    }

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
