/**
 * Update Task API
 * 
 * POST /api/update-task
 * 
 * Allows assigned users to update task status, add comments, or upload files.
 * 
 * Request body:
 * {
 *   taskId: string,
 *   action: 'status_change' | 'comment' | 'file_upload',
 *   status?: 'pending' | 'in_progress' | 'completed' | 'blocked',
 *   comment?: string,
 *   fileUrl?: string,
 *   fileName?: string
 * }
 * 
 * Authorization:
 * - Assignee can update status, add comments, upload files
 * - Creator can also update any task from their meetings
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
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

function getAdminAuth() {
  initAdmin();
  return getAuth();
}

// ============================================
// TYPES
// ============================================
type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';
type UpdateAction = 'status_change' | 'comment' | 'file_upload';

interface UpdateRequest {
  taskId: string;
  action: UpdateAction;
  status?: TaskStatus;
  comment?: string;
  fileUrl?: string;
  fileName?: string;
}

interface TaskUpdate {
  id: string;
  taskId: string;
  userId: string;
  userMtaiId: string;
  userName: string;
  type: UpdateAction;
  content: string;
  previousStatus?: TaskStatus;
  newStatus?: TaskStatus;
  fileUrl?: string;
  fileName?: string;
  createdAt: any;
}

// ============================================
// VERIFY TOKEN
// ============================================
async function verifyToken(request: VercelRequest): Promise<{ uid: string; email?: string }> {
  const authHeader = request.headers.authorization;
  
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('No token provided');
  }

  const token = authHeader.split('Bearer ')[1];
  const auth = getAdminAuth();
  const decodedToken = await auth.verifyIdToken(token);
  
  return { uid: decodedToken.uid, email: decodedToken.email };
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
  console.log('📝 [Task Update] Processing request');
  console.log('========================================\n');

  try {
    // Verify auth
    const { uid } = await verifyToken(request);
    console.log('👤 User:', uid);

    // Parse request
    const { taskId, action, status, comment, fileUrl, fileName }: UpdateRequest = request.body;

    if (!taskId || !action) {
      return response.status(400).json({ error: 'Missing taskId or action' });
    }

    // Validate action
    if (!['status_change', 'comment', 'file_upload'].includes(action)) {
      return response.status(400).json({ error: 'Invalid action. Use: status_change, comment, or file_upload' });
    }

    // Validate status change
    if (action === 'status_change') {
      if (!status || !['pending', 'in_progress', 'completed', 'blocked'].includes(status)) {
        return response.status(400).json({ error: 'Invalid status. Use: pending, in_progress, completed, or blocked' });
      }
    }

    // Validate comment
    if (action === 'comment' && (!comment || comment.trim() === '')) {
      return response.status(400).json({ error: 'Comment cannot be empty' });
    }

    // Validate file upload
    if (action === 'file_upload' && !fileUrl) {
      return response.status(400).json({ error: 'fileUrl required for file_upload action' });
    }

    console.log('📋 Task ID:', taskId);
    console.log('🎯 Action:', action);

    const db = getAdminDb();

    // Get task
    const taskRef = db.collection('tasks').doc(taskId);
    const taskDoc = await taskRef.get();

    if (!taskDoc.exists) {
      return response.status(404).json({ error: 'Task not found' });
    }

    const task = taskDoc.data()!;

    // Get user info for the update
    const userQuery = await db.collection('users').where('uid', '==', uid).limit(1).get();
    const userData = userQuery.empty ? null : userQuery.docs[0].data();
    const userMtaiId = userData?.mtaiId || '';
    const userName = userData?.displayName || 'Unknown User';

    // Authorization check:
    // 1. User is the task creator (meeting owner)
    // 2. User is the assignee (matched by MTAI ID or Firebase UID)
    const isCreator = task.creatorId === uid || task.userId === uid;
    const isAssignee = task.assignedTo === userMtaiId;
    
    if (!isCreator && !isAssignee) {
      console.log('❌ Authorization failed');
      console.log('   - Creator ID:', task.creatorId);
      console.log('   - Assigned To:', task.assignedTo);
      console.log('   - User MTAI ID:', userMtaiId);
      return response.status(403).json({ error: 'Not authorized to update this task' });
    }

    console.log('✅ Authorization: isCreator=' + isCreator + ', isAssignee=' + isAssignee);

    // Build update object
    const updates: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp(),
      lastUpdateAt: FieldValue.serverTimestamp(),
    };

    // Build task update entry
    const updateEntry: TaskUpdate = {
      id: db.collection('task_updates').doc().id,
      taskId,
      userId: uid,
      userMtaiId,
      userName,
      type: action,
      content: '',
      createdAt: FieldValue.serverTimestamp(),
    };

    // Handle different actions
    switch (action) {
      case 'status_change':
        const previousStatus = task.status;
        updates.status = status;
        updateEntry.previousStatus = previousStatus;
        updateEntry.newStatus = status;
        updateEntry.content = `Status changed from "${previousStatus}" to "${status}"`;
        
        // Set completedAt timestamp if completed
        if (status === 'completed') {
          updates.completedAt = FieldValue.serverTimestamp();
        } else if (task.completedAt) {
          // Remove completedAt if status changed from completed
          updates.completedAt = FieldValue.delete();
        }
        break;

      case 'comment':
        updateEntry.content = comment!;
        break;

      case 'file_upload':
        updateEntry.content = `Uploaded file: ${fileName || 'Attachment'}`;
        updateEntry.fileUrl = fileUrl;
        updateEntry.fileName = fileName;
        break;
    }

    // Update task
    await taskRef.update(updates);
    console.log('💾 Task updated');

    // Save update entry to task_updates collection
    await db.collection('task_updates').doc(updateEntry.id).set(updateEntry);
    console.log('💾 Update entry saved');

    // Also add to task's updates array (for easy querying)
    await taskRef.update({
      updates: FieldValue.arrayUnion({
        id: updateEntry.id,
        type: action,
        content: updateEntry.content,
        userName,
        createdAt: new Date().toISOString(),
      }),
    });

    console.log('\n✅ Task update complete!');

    return response.status(200).json({
      success: true,
      taskId,
      action,
      update: {
        ...updateEntry,
        createdAt: new Date().toISOString(),
      },
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    
    if (error.message.includes('token') || error.message.includes('auth')) {
      return response.status(401).json({ error: 'Authentication failed' });
    }
    
    return response.status(500).json({ error: error.message });
  }
}
