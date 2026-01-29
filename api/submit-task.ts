/**
 * Submit Task API
 * 
 * POST /api/submit-task
 * 
 * Allows employees to submit their work for a task.
 * Supports file uploads (via Cloudinary URL) and text responses.
 * 
 * Request body:
 * {
 *   taskId: string,
 *   submissionText: string,
 *   submissionFileUrl?: string,
 *   submissionFileName?: string
 * }
 */

export const runtime = "nodejs";

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ============================================
// FIREBASE ADMIN SETUP
// ============================================
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

function getAdminDb() {
  initAdmin();
  return getFirestore();
}

// ============================================
// TOKEN VERIFICATION
// ============================================
async function verifyFirebaseToken(token: string): Promise<string | null> {
  try {
    const { getAuth } = await import('firebase-admin/auth');
    initAdmin();
    const decodedToken = await getAuth().verifyIdToken(token);
    return decodedToken.uid;
  } catch {
    return null;
  }
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
  console.log('📤 [Submit Task] Employee Submission');
  console.log('========================================\n');

  try {
    // Verify auth
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return response.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split('Bearer ')[1];
    const userId = await verifyFirebaseToken(token);
    
    if (!userId) {
      return response.status(401).json({ error: 'Invalid token' });
    }

    const db = getAdminDb();

    // Get user's MTAI ID
    const usersSnapshot = await db.collection('users').where('uid', '==', userId).limit(1).get();
    
    if (usersSnapshot.empty) {
      return response.status(403).json({ error: 'User not found' });
    }

    const userData = usersSnapshot.docs[0].data();
    const userMtaiId = userData.mtaiId;

    // Employees only (or allow anyone assigned to the task)
    if (userData.role !== 'employee') {
      return response.status(403).json({ error: 'Only employees can submit task work' });
    }

    // Parse request
    const { taskId, submissionText, submissionFileUrl, submissionFileName } = request.body;

    if (!taskId) {
      return response.status(400).json({ error: 'Task ID is required' });
    }

    // Must provide either text or file
    if (!submissionText && !submissionFileUrl) {
      return response.status(400).json({ error: 'Please provide a response or upload a file' });
    }

    console.log('📝 Task ID:', taskId);
    console.log('👤 Employee:', userMtaiId);

    // Get the task
    const taskRef = db.collection('tasks').doc(taskId);
    const taskDoc = await taskRef.get();

    if (!taskDoc.exists) {
      return response.status(404).json({ error: 'Task not found' });
    }

    const task = taskDoc.data()!;

    // Verify user is assigned to this task
    if (task.assignedTo !== userMtaiId) {
      return response.status(403).json({ error: 'You are not assigned to this task' });
    }

    // Update task with submission
    await taskRef.update({
      submissionText: submissionText || null,
      submissionFileUrl: submissionFileUrl || null,
      submissionFileName: submissionFileName || null,
      submittedAt: FieldValue.serverTimestamp(),
      status: 'completed',
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log('\n✅ Task submission saved!');
    console.log('   - Status: completed');

    return response.status(200).json({
      success: true,
      message: 'Task submitted successfully',
      status: 'completed',
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('❌ Stack:', error.stack);
    return response.status(500).json({ error: error.message });
  }
}
