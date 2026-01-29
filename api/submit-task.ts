/**
 * Submit Task & File Delivery API
 * 
 * POST /api/submit-task - Submit task work
 * GET /api/submit-task?taskId=xxx&download=true - Retrieve task file (secure)
 * 
 * POST: Allows employees to submit their work for a task.
 * GET: Securely delivers files using Cloudinary SDK with authenticated access.
 * 
 * POST Request body:
 * {
 *   taskId: string,
 *   submissionText: string,
 *   submissionFileUrl?: string,
 *   submissionFileName?: string,
 *   cloudinaryPublicId?: string
 * }
 * 
 * GET Query params:
 * - taskId: string (required)
 * - download: boolean (optional, forces download vs inline)
 */

export const runtime = "nodejs";

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { v2 as cloudinary } from 'cloudinary';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import https from 'https';

// ============================================
// CLOUDINARY SETUP
// ============================================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
  secure: true,
});

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
// MIME TYPE MAPPING
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
// FILE DELIVERY HANDLER (GET)
// ============================================
async function handleFileDelivery(request: VercelRequest, response: VercelResponse) {
  const { taskId } = request.query;
  const forceDownload = request.query.download === 'true';

  if (!taskId || typeof taskId !== 'string') {
    return response.status(400).json({ error: 'Task ID is required' });
  }

  console.log('\n========================================');
  console.log('📁 [File Delivery] Request for task:', taskId);
  console.log('========================================\n');

  // Verify authentication
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    console.log('❌ No auth token provided');
    return response.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split('Bearer ')[1];
  const userId = await verifyFirebaseToken(token);
  
  if (!userId) {
    console.log('❌ Invalid auth token');
    return response.status(401).json({ error: 'Invalid authentication token' });
  }

  const db = getAdminDb();

  // Get user info
  const usersSnapshot = await db.collection('users').where('uid', '==', userId).limit(1).get();
  
  if (usersSnapshot.empty) {
    console.log('❌ User not found in database');
    return response.status(403).json({ error: 'User not found' });
  }

  const userData = usersSnapshot.docs[0].data();
  const userMtaiId = userData.mtaiId;
  const userRole = userData.role;

  console.log('👤 User:', userMtaiId, '| Role:', userRole);

  // Get task from Firestore
  const taskDoc = await db.collection('tasks').doc(taskId).get();
  
  if (!taskDoc.exists) {
    console.log('❌ Task not found');
    return response.status(404).json({ error: 'File not found' });
  }

  const task = taskDoc.data()!;

  // Verify authorization: must be assigned employee OR creator manager
  const isAssignedEmployee = userRole === 'employee' && task.assignedTo === userMtaiId;
  const isCreatorManager = userRole === 'manager' && task.creatorId === userId;
  
  if (!isAssignedEmployee && !isCreatorManager) {
    console.log('❌ Access denied - user not authorized for this task');
    return response.status(403).json({ error: 'You do not have permission to access this file' });
  }

  // Check if task has a file submission
  if (!task.submissionFileUrl) {
    console.log('❌ No file attached to task');
    return response.status(404).json({ error: 'No file attached to this task' });
  }

  const fileName = task.submissionFileName || 'attachment';
  const cloudinaryPublicId = task.cloudinaryPublicId;

  if (!cloudinaryPublicId) {
    console.log('❌ No Cloudinary public ID found');
    return response.status(404).json({ error: 'File metadata is incomplete' });
  }

  console.log('📄 File:', fileName);
  console.log('🔑 Public ID:', cloudinaryPublicId);

  // Verify the resource exists in Cloudinary using authenticated SDK
  try {
    const resourceInfo = await cloudinary.api.resource(cloudinaryPublicId, {
      resource_type: 'raw',
    });
    
    console.log('✅ Cloudinary resource verified:', resourceInfo.bytes, 'bytes');
  } catch (cloudinaryError: any) {
    console.error('❌ Cloudinary error:', cloudinaryError.message);
    
    if (cloudinaryError.error?.http_code === 404) {
      return response.status(404).json({ error: 'File not found in storage' });
    } else if (cloudinaryError.error?.http_code === 401) {
      return response.status(403).json({ error: 'Unable to authenticate with storage provider' });
    } else {
      console.error('❌ Cloudinary error details:', cloudinaryError);
      return response.status(502).json({ error: 'Storage provider error' });
    }
  }

  // Generate a secure, time-limited delivery URL (valid for 1 hour)
  const secureUrl = cloudinary.url(cloudinaryPublicId, {
    resource_type: 'raw',
    secure: true,
    sign_url: true,
    type: 'authenticated',
    expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
  });

  console.log('🔗 Generated secure URL');

  // Set response headers
  const mimeType = getMimeType(fileName);
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

  // Stream the file from Cloudinary to the client
  return new Promise<void>((resolve, reject) => {
    https.get(secureUrl, (fileResponse) => {
      if (fileResponse.statusCode !== 200) {
        console.error('❌ Failed to fetch file, status:', fileResponse.statusCode);
        
        if (fileResponse.statusCode === 401 || fileResponse.statusCode === 403) {
          response.status(403).json({ error: 'File access denied by storage provider' });
        } else if (fileResponse.statusCode === 404) {
          response.status(404).json({ error: 'File not found in storage' });
        } else {
          response.status(502).json({ error: 'Failed to retrieve file from storage' });
        }
        
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
        console.log('✅ File streamed successfully to client');
        resolve();
      });

      fileResponse.on('error', (err) => {
        console.error('❌ Stream error:', err.message);
        reject(err);
      });
    }).on('error', (err) => {
      console.error('❌ HTTPS request error:', err.message);
      response.status(502).json({ error: 'Failed to connect to storage provider' });
      resolve();
    });
  });
}

// ============================================
// TASK SUBMISSION HANDLER (POST)
// ============================================
async function handleTaskSubmission(request: VercelRequest, response: VercelResponse) {
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
    updateData.cloudinaryPublicId = cloudinaryPublicId || null; // Save for file delivery endpoint

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
      // File delivery handler
      return await handleFileDelivery(request, response);
    } else if (request.method === 'POST') {
      // Task submission handler
      return await handleTaskSubmission(request, response);
    } else {
      return response.status(405).json({ error: 'Method not allowed' });
    }
  } catch (error: any) {
    console.error('❌ [Submit Task] Unexpected error:', error.message);
    console.error('❌ Stack:', error.stack);
    return response.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
