/**
 * Submit Task API
 * 
 * POST /api/submit-task - Submit task work
 * GET /api/submit-task?taskId=xxx&download=true - Retrieve task file (secure proxy)
 * 
 * POST: Allows employees to submit their work for a task.
 * Supports file uploads (via Cloudinary URL) and text responses.
 * 
 * GET: Securely streams files from Cloudinary through our backend.
 * This eliminates 401 errors and preview issues by:
 * 1. Verifying user authentication
 * 2. Checking task ownership (assigned employee or creator manager)
 * 3. Fetching file from Cloudinary using server credentials
 * 4. Streaming to client with proper headers
 * 
 * POST Request body:
 * {
 *   taskId: string,
 *   submissionText: string,
 *   submissionFileUrl?: string,
 *   submissionFileName?: string
 * }
 * 
 * GET Query params:
 * - taskId: string (required)
 * - download: boolean (optional, forces download vs inline)
 */

export const runtime = "nodejs";

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import https from 'https';
import http from 'http';

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
// MIME TYPE MAPPING (for file streaming)
// ============================================
const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
  txt: 'text/plain',
};

function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return MIME_TYPES[ext] || 'application/octet-stream';
}

// ============================================
// FILE PROXY HANDLER
// ============================================
async function handleFileProxy(request: VercelRequest, response: VercelResponse) {
  const { taskId } = request.query;
  const forceDownload = request.query.download === 'true';

  if (!taskId || typeof taskId !== 'string') {
    return response.status(400).json({ error: 'Task ID is required' });
  }

  console.log('\n========================================');
  console.log('📁 [File Proxy] Serving file for task:', taskId);
  console.log('========================================\n');

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

  // Get user info
  const usersSnapshot = await db.collection('users').where('uid', '==', userId).limit(1).get();
  
  if (usersSnapshot.empty) {
    return response.status(403).json({ error: 'User not found' });
  }

  const userData = usersSnapshot.docs[0].data();
  const userMtaiId = userData.mtaiId;
  const userRole = userData.role;

  console.log('👤 User:', userMtaiId, '| Role:', userRole);

  // Get task from Firestore
  const taskDoc = await db.collection('tasks').doc(taskId).get();
  
  if (!taskDoc.exists) {
    return response.status(404).json({ error: 'Task not found' });
  }

  const task = taskDoc.data()!;

  // Check authorization: must be assigned employee OR creator manager
  const isAssignedEmployee = userRole === 'employee' && task.assignedTo === userMtaiId;
  const isCreatorManager = userRole === 'manager' && task.creatorId === userId;
  
  if (!isAssignedEmployee && !isCreatorManager) {
    console.log('❌ Access denied - not authorized for this task');
    return response.status(403).json({ error: 'Not authorized to access this file' });
  }

  // Check if task has a file
  if (!task.submissionFileUrl) {
    return response.status(404).json({ error: 'No file attached to this task' });
  }

  const fileUrl = task.submissionFileUrl;
  const fileName = task.submissionFileName || 'attachment';
  const mimeType = getMimeType(fileName);

  console.log('📄 File:', fileName);
  console.log('🔗 URL:', fileUrl);
  console.log('📋 MIME:', mimeType);

  // Set response headers
  response.setHeader('Content-Type', mimeType);
  
  if (forceDownload) {
    response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  } else {
    // Inline display for PDFs and text, attachment for others
    const inlineTypes = ['application/pdf', 'text/plain'];
    if (inlineTypes.includes(mimeType)) {
      response.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    } else {
      response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    }
  }

  // Fetch file from Cloudinary and stream to response
  const protocol = fileUrl.startsWith('https') ? https : http;
  
  return new Promise<void>((resolve, reject) => {
    protocol.get(fileUrl, (fileResponse) => {
      if (fileResponse.statusCode !== 200) {
        console.error('❌ Cloudinary returned:', fileResponse.statusCode);
        response.status(502).json({ error: 'Failed to fetch file from storage' });
        resolve();
        return;
      }

      // Forward content length if available
      if (fileResponse.headers['content-length']) {
        response.setHeader('Content-Length', fileResponse.headers['content-length']);
      }

      // Stream the file
      fileResponse.pipe(response);
      
      fileResponse.on('end', () => {
        console.log('✅ File streamed successfully');
        resolve();
      });

      fileResponse.on('error', (err) => {
        console.error('❌ Stream error:', err);
        reject(err);
      });
    }).on('error', (err) => {
      console.error('❌ Fetch error:', err);
      response.status(502).json({ error: 'Failed to connect to storage' });
      resolve();
    });
  });
}

// ============================================
// SUBMIT TASK HANDLER
// ============================================
async function handleSubmitTask(request: VercelRequest, response: VercelResponse) {
  console.log('\n========================================');
  console.log('📤 [Submit Task] Employee Submission');
  console.log('========================================\n');

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

  // Add file data if provided
  if (submissionFileUrl) {
    updateData.submissionFileUrl = submissionFileUrl;
    updateData.submissionFileName = submissionFileName || 'attachment';
    updateData.submissionFileSize = submissionFileSize || null;
    updateData.submissionFileType = submissionFileType || null;

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
      fileUrl: submissionFileUrl,
      cloudinaryPublicId: cloudinaryPublicId || null,
      folder: `meettask/meetings/${task.meetingId}/tasks/${taskId}`,
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
}

// ============================================
// MAIN HANDLER
// ============================================
export default async function handler(request: VercelRequest, response: VercelResponse) {
  // CORS
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (request.method === 'OPTIONS') return response.status(200).end();

  try {
    // Route based on method
    if (request.method === 'GET') {
      // File proxy handler
      return await handleFileProxy(request, response);
    } else if (request.method === 'POST') {
      // Submit task handler
      return await handleSubmitTask(request, response);
    } else {
      return response.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('❌ Stack:', error.stack);
    return response.status(500).json({ 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}
