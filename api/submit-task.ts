/**
 * Submit Task API
 * 
 * POST /api/submit-task
 * 
 * Allows employees to submit their work for a task.
 * Stores direct Cloudinary URLs - no backend proxy needed.
 * 
 * Request body:
 * {
 *   taskId: string,
 *   submissionText: string,
 *   submissionFileUrl?: string,
 *   submissionFileName?: string,
 *   cloudinaryPublicId?: string
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
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' });
  }

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

    // Employees only
    if (userData.role !== 'employee') {
      return response.status(403).json({ error: 'Only employees can submit task work' });
    }

    // Parse request
    const { 
      taskId, 
      submissionText, 
      submissionFileUrl, 
      submissionFileName,
      submissionFileSize,
      submissionFileType,
      cloudinaryPublicId,
    } = request.body;

    if (!taskId) {
      return response.status(400).json({ error: 'Task ID is required' });
    }

    // Text response is always required
    if (!submissionText || !submissionText.trim()) {
      return response.status(400).json({ error: 'Text response is required' });
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

    // Check if file is required but not provided
    if (task.requiresFile && !submissionFileUrl) {
      return response.status(400).json({ error: 'This task requires a file upload' });
    }

    // Update task with submission
    const updateData: Record<string, any> = {
      submissionText: submissionText.trim(),
      submittedAt: FieldValue.serverTimestamp(),
      status: 'completed',
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Add file data if provided - store direct Cloudinary URL
    if (submissionFileUrl) {
      updateData.submissionFileUrl = submissionFileUrl;
      updateData.submissionFileName = submissionFileName || 'attachment';
      updateData.submissionFileSize = submissionFileSize || null;
      updateData.submissionFileType = submissionFileType || null;
      updateData.cloudinaryPublicId = cloudinaryPublicId || null;

      // Save file metadata to dedicated collection
      const fileData = {
        fileId: cloudinaryPublicId || `file_${Date.now()}`,
        taskId: taskId,
        meetingId: task.meetingId,
        uploaderId: userId,
        uploaderMtaiId: userMtaiId,
        uploaderName: userData.name || userData.displayName || 'Unknown',
        fileName: submissionFileName || 'attachment',
        fileExtension: submissionFileName?.split('.').pop()?.toLowerCase() || '',
        fileType: submissionFileType || 'application/octet-stream',
        fileSize: submissionFileSize || 0,
        fileUrl: submissionFileUrl, // Direct Cloudinary URL
        cloudinaryPublicId: cloudinaryPublicId || null,
        folder: `meettask/tasks/${taskId}`,
        uploadedAt: FieldValue.serverTimestamp(),
      };

      // Add to taskFiles collection
      await db.collection('taskFiles').add(fileData);
      console.log('📁 File metadata saved to taskFiles collection');
    }

    await taskRef.update(updateData);

    console.log('\n✅ Task submission saved!');
    console.log('   - Status: completed');
    console.log('   - Has file:', !!submissionFileUrl);

    return response.status(200).json({
      success: true,
      message: 'Task submitted successfully',
      status: 'completed',
      hasFile: !!submissionFileUrl,
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('❌ Stack:', error.stack);
    return response.status(500).json({ error: error.message });
  }
}
