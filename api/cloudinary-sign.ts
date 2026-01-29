/**
 * Cloudinary Sign API
 * 
 * POST /api/cloudinary-sign
 * 
 * Generates signed upload parameters for secure Cloudinary uploads.
 * This keeps API secrets server-side while allowing direct browser uploads.
 * 
 * Request body:
 * {
 *   taskId: string,
 *   meetingId: string,
 *   fileName: string
 * }
 * 
 * Response:
 * {
 *   signature: string,
 *   timestamp: number,
 *   cloudName: string,
 *   apiKey: string,
 *   folder: string
 * }
 */

export const runtime = "nodejs";

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createHash } from 'crypto';

// ============================================
// ALLOWED FILE TYPES
// ============================================
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'zip', 'txt'];
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
  'text/plain',
];

// Max file size: 20MB
const MAX_FILE_SIZE = 20 * 1024 * 1024;

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
// CLOUDINARY SIGNATURE GENERATION
// ============================================
function generateCloudinarySignature(params: Record<string, string | number>, apiSecret: string): string {
  // Sort parameters alphabetically and create signature string
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  
  // Create SHA-1 hash with API secret appended
  return createHash('sha1')
    .update(sortedParams + apiSecret)
    .digest('hex');
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
  console.log('🔐 [Cloudinary Sign] Generating Upload Signature');
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

    // Get user info
    const usersSnapshot = await db.collection('users').where('uid', '==', userId).limit(1).get();
    
    if (usersSnapshot.empty) {
      return response.status(403).json({ error: 'User not found' });
    }

    const userData = usersSnapshot.docs[0].data();
    const userMtaiId = userData.mtaiId;

    console.log('👤 User:', userMtaiId, '| Role:', userData.role);

    // Parse request
    const { taskId, meetingId, fileName, fileSize, fileType } = request.body;

    if (!taskId || !meetingId || !fileName) {
      return response.status(400).json({ 
        error: 'Missing required fields: taskId, meetingId, fileName' 
      });
    }

    // Validate file extension
    const fileExtension = fileName.split('.').pop()?.toLowerCase();
    if (!fileExtension || !ALLOWED_EXTENSIONS.includes(fileExtension)) {
      return response.status(400).json({ 
        error: `Invalid file type. Allowed formats: ${ALLOWED_EXTENSIONS.join(', ').toUpperCase()}`,
        allowedFormats: ALLOWED_EXTENSIONS
      });
    }

    // Validate file size if provided
    if (fileSize && fileSize > MAX_FILE_SIZE) {
      return response.status(400).json({ 
        error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`,
        maxSize: MAX_FILE_SIZE
      });
    }

    // Validate MIME type if provided
    if (fileType && !ALLOWED_MIME_TYPES.includes(fileType)) {
      console.log('⚠️ Non-standard MIME type:', fileType, '- allowing based on extension');
    }

    console.log('📁 File:', fileName, '| Size:', fileSize ? `${(fileSize / 1024).toFixed(1)}KB` : 'unknown');

    // Verify task exists and user is assigned to it
    const taskRef = db.collection('tasks').doc(taskId);
    const taskDoc = await taskRef.get();

    if (!taskDoc.exists) {
      return response.status(404).json({ error: 'Task not found' });
    }

    const task = taskDoc.data()!;

    // Only assigned employee or manager can upload
    if (userData.role === 'employee' && task.assignedTo !== userMtaiId) {
      return response.status(403).json({ error: 'You are not assigned to this task' });
    }

    // Check for existing submission (prevent duplicate uploads unless manager)
    if (task.submissionFileUrl && userData.role === 'employee') {
      return response.status(400).json({ 
        error: 'A file has already been submitted for this task. Contact your manager to allow re-upload.',
        existingFile: task.submissionFileName
      });
    }

    // Get Cloudinary credentials from environment
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      console.error('❌ Missing Cloudinary credentials');
      return response.status(500).json({ error: 'File upload service not configured' });
    }

    // Generate folder path: meettask/meetings/{meetingId}/tasks/{taskId}/
    const folder = `meettask/meetings/${meetingId}/tasks/${taskId}`;
    
    // Generate timestamp
    const timestamp = Math.floor(Date.now() / 1000);

    // Generate unique public_id to avoid overwrites
    const sanitizedFileName = fileName
      .replace(/\.[^/.]+$/, '') // Remove extension
      .replace(/[^a-zA-Z0-9_-]/g, '_') // Sanitize
      .substring(0, 50); // Limit length
    
    const uniqueId = `${sanitizedFileName}_${timestamp}`;

    // Parameters to sign - MUST match exactly what frontend sends
    // Cloudinary requires alphabetical order for signature
    // access_mode=public allows direct URL access without authentication
    const paramsToSign: Record<string, string | number> = {
      access_mode: 'public',
      folder,
      public_id: uniqueId,
      timestamp,
    };

    // Generate signature
    const signature = generateCloudinarySignature(paramsToSign, apiSecret);

    console.log('✅ Signature generated');
    console.log('   Folder:', folder);
    console.log('   Public ID:', uniqueId);
    console.log('   Timestamp:', timestamp);
    console.log('   Access Mode: public');

    return response.status(200).json({
      success: true,
      signature,
      timestamp,
      cloudName,
      apiKey,
      folder,
      publicId: uniqueId,
    });


  } catch (error: any) {
    console.error('❌ [Cloudinary Sign] Error:', error);
    return response.status(500).json({ 
      error: 'Failed to generate upload signature',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
