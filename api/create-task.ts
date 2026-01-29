/**
 * Create Task API
 * 
 * POST /api/create-task
 * 
 * Creates a manual task (manager only).
 * No AI extraction - tasks are created directly by managers.
 * 
 * Request body:
 * {
 *   meetingId: string,
 *   title: string,
 *   description: string,
 *   requiresFile: boolean,
 *   assignedToMtaiId: string,
 *   priority: 'critical' | 'high' | 'medium' | 'low',
 *   dueDate?: string (ISO format)
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
  console.log('📝 [Create Task] Manual Task Creation');
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

    // Verify user is a manager
    const usersSnapshot = await db.collection('users').where('uid', '==', userId).limit(1).get();
    
    if (usersSnapshot.empty) {
      return response.status(403).json({ error: 'User not found' });
    }

    const userData = usersSnapshot.docs[0].data();
    
    if (userData.role !== 'manager') {
      return response.status(403).json({ error: 'Only managers can create tasks' });
    }

    // Parse request
    const { meetingId, title, description, assignedToMtaiId, priority, dueDate, requiresFile } = request.body;

    // Validate required fields
    if (!meetingId) {
      return response.status(400).json({ error: 'Meeting ID is required' });
    }
    if (!title || title.trim().length === 0) {
      return response.status(400).json({ error: 'Task title is required' });
    }
    if (!assignedToMtaiId) {
      return response.status(400).json({ error: 'Assigned employee is required' });
    }

    // Validate priority
    const validPriorities = ['critical', 'high', 'medium', 'low'];
    const taskPriority = validPriorities.includes(priority) ? priority : 'medium';

    // Parse requiresFile boolean
    const fileRequired = requiresFile === true;

    console.log('📁 Meeting ID:', meetingId);
    console.log('📝 Title:', title);
    console.log('📎 Requires File:', fileRequired);
    console.log('�👤 Assigned to:', assignedToMtaiId);

    // Get meeting to verify ownership and status
    const meetingRef = db.collection('meetings').doc(meetingId);
    const meetingDoc = await meetingRef.get();

    if (!meetingDoc.exists) {
      return response.status(404).json({ error: 'Meeting not found' });
    }

    const meeting = meetingDoc.data()!;

    // Verify manager owns this meeting
    if (meeting.userId !== userId) {
      return response.status(403).json({ error: 'Not authorized to add tasks to this meeting' });
    }

    // Get assignee info
    const assigneeSnapshot = await db.collection('users').where('mtaiId', '==', assignedToMtaiId).limit(1).get();
    
    if (assigneeSnapshot.empty) {
      return response.status(400).json({ error: 'Assigned employee not found' });
    }

    const assigneeData = assigneeSnapshot.docs[0].data();

    // Validate assignee is an employee
    if (assigneeData.role !== 'employee') {
      return response.status(400).json({ error: 'Tasks can only be assigned to employees' });
    }

    // Generate sequential task ID
    const counterRef = db.collection('counters').doc('taskCounter');
    const counterDoc = await counterRef.get();
    let taskNumber = 1;
    
    if (counterDoc.exists) {
      taskNumber = (counterDoc.data()?.lastUsedTaskId || 0) + 1;
    }
    
    await counterRef.set({ lastUsedTaskId: taskNumber }, { merge: true });
    const taskId = `TASK${String(taskNumber).padStart(3, '0')}`;

    // Create the task with generated ID
    const taskRef = db.collection('tasks').doc();
    
    const taskData = {
      id: taskRef.id,
      taskId: taskId,
      meetingId,
      meetingTitle: meeting.title || 'Untitled Meeting',
      
      // Creator (manager)
      creatorId: userId,
      creatorMtaiId: userData.mtaiId,
      creatorName: userData.name || userData.displayName || 'Manager',
      
      // Assignee (employee)
      assignedTo: assignedToMtaiId,
      assignedToName: assigneeData.name || assigneeData.displayName || 'Employee',
      assignedToEmail: assigneeData.email || '',
      
      // Task details
      title: title.trim(),
      description: (description || '').trim(),
      requiresFile: fileRequired,
      priority: taskPriority,
      status: 'pending',
      dueDate: dueDate || null,
      
      // Submission fields (for employee to fill)
      submissionText: null,
      submissionFileUrl: null,
      submissionFileName: null,
      submittedAt: null,
      
      // Timestamps
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      
      // Legacy compatibility
      userId: userId,
    };

    await taskRef.set(taskData);

    // Update meeting task count
    const currentCount = meeting.taskCount || 0;
    await meetingRef.update({
      taskCount: currentCount + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log('\n✅ Task created successfully!');
    console.log('   - Task ID:', taskId);
    console.log('   - Firestore Doc ID:', taskRef.id);
    console.log('   - Assigned to:', assigneeData.name || assigneeData.email);

    return response.status(200).json({
      success: true,
      task: {
        id: taskRef.id,
        ...taskData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('❌ Stack:', error.stack);
    return response.status(500).json({ error: error.message });
  }
}
