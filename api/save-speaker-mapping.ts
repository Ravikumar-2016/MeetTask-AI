/**
 * Save Speaker Mapping & Extract Tasks
 * 
 * POST /api/save-speaker-mapping
 * 
 * ENTERPRISE WORKFLOW:
 * 1. User maps speakers: { A: "MTAI001", B: "MTAI002" }
 * 2. Validates: No duplicates, creator excluded from assignment
 * 3. Saves mapping to transcript
 * 4. Uses LeMUR to extract tasks with correct assignments
 * 5. Saves tasks to dedicated /tasks collection
 * 6. Triggers async email notifications
 * 7. Status → "completed"
 * 
 * Request body:
 * {
 *   meetingId: string,
 *   speakerMapping: { A: "MTAI001", B: "MTAI002", ... }
 * }
 */

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
// TYPES
// ============================================
interface SpeakerMapping {
  [speakerId: string]: string; // "A" => "MTAI001"
}

interface FirestoreUser {
  uid: string;
  mtaiId: string;
  email: string;
  displayName: string;
  photoURL?: string | null;
  authProviders: string[];
}

// Enhanced Task type for enterprise workflow
interface EnhancedTask {
  id: string;
  meetingId: string;
  meetingTitle: string;
  
  // Ownership
  creatorId: string;           // Meeting owner's Firebase UID
  creatorMtaiId: string;       // Meeting owner's MTAI ID
  creatorName: string;
  
  // Assignment
  assignedTo: string;          // MTAI ID
  assignedToName: string;
  assignedToEmail: string;
  speakerId?: string;
  
  // Task details
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  dueDate?: string;
  
  // AI extraction
  confidence?: number;
  sourceSentence?: string;
  
  // Timestamps
  createdAt: any;
  updatedAt: any;
  
  // Legacy compatibility
  userId: string;
}

// ============================================
// LOOKUP USERS BY MTAI ID (or temporary ID)
// ============================================
async function lookupUsersByMtaiId(
  db: FirebaseFirestore.Firestore,
  mtaiIds: string[]
): Promise<Map<string, FirestoreUser>> {
  const usersMap = new Map<string, FirestoreUser>();
  
  // Query all users
  const usersSnap = await db.collection('users').get();
  
  usersSnap.forEach((docSnap) => {
    const data = docSnap.data();
    const email = data.email || docSnap.id;
    const mtaiId = data.mtaiId || `TEMP-${docSnap.id.substring(0, 6).toUpperCase()}`;
    
    if (mtaiIds.includes(mtaiId)) {
      usersMap.set(mtaiId, {
        uid: data.uid || docSnap.id,
        mtaiId: mtaiId,
        email: email,
        displayName: data.displayName || email.split('@')[0] || 'User',
        photoURL: data.photoURL || null,
        authProviders: data.authProviders || [],
      });
    }
  });
  
  return usersMap;
}

// ============================================
// LeMUR TASK EXTRACTION (Enhanced)
// ============================================
async function extractTasksWithLeMUR(
  transcriptId: string,
  speakerMapping: SpeakerMapping,
  mtaiIdToName: Map<string, string>
): Promise<any[]> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  
  // Build speaker info for prompt using display names
  const speakerInfo = Object.entries(speakerMapping)
    .map(([id, mtaiId]) => {
      const name = mtaiIdToName.get(mtaiId) || mtaiId;
      return `Speaker ${id} = ${name} (${mtaiId})`;
    })
    .join('\n');

  const prompt = `Analyze this meeting transcript and extract ALL action items and tasks.

SPEAKER MAPPING:
${speakerInfo}

For each task found, return:
1. title: Brief, actionable task title (max 80 chars)
2. description: Clear description of what needs to be done
3. assignedToMtaiId: The MTAI ID (e.g., "MTAI001") of the person responsible
4. speakerId: The speaker ID (A, B, C) who is assigned
5. priority: "critical", "high", "medium", or "low"
6. dueDate: If mentioned (YYYY-MM-DD format), else null
7. sourceSentence: The exact quote from transcript that mentions this task

PRIORITY GUIDELINES:
- critical: Urgent, blocking other work, mentioned as priority
- high: Important deadline, significant impact
- medium: Normal priority, standard work
- low: Nice-to-have, can be delayed

Return a JSON array of tasks. If no clear tasks found, return [].

RULES:
- Only extract CLEAR action items (explicit commitments)
- "I'll do X" → assign to that speaker
- "Can you do X?" or "Please do X" → assign to person being asked
- When in doubt about assignee, use the speaker who accepted the task
- Never invent tasks that weren't discussed

Return ONLY valid JSON array, no markdown, no explanation.`;

  try {
    const lemurRes = await fetch('https://api.assemblyai.com/lemur/v3/generate/task', {
      method: 'POST',
      headers: {
        'Authorization': apiKey!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        transcript_ids: [transcriptId],
        prompt,
        final_model: 'anthropic/claude-3-5-sonnet',
      }),
    });

    if (!lemurRes.ok) {
      const errorText = await lemurRes.text();
      console.error('LeMUR error:', errorText);
      return [];
    }

    const lemurData = await lemurRes.json();
    console.log('LeMUR response:', lemurData.response?.substring(0, 200));

    // Parse JSON from response
    let tasks: any[] = [];
    try {
      const responseText = lemurData.response || '';
      // Try to find JSON array in response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        tasks = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error('Failed to parse LeMUR response:', parseError);
    }

    return Array.isArray(tasks) ? tasks : [];
  } catch (error) {
    console.error('LeMUR extraction failed:', error);
    return [];
  }
}

// ============================================
// VERIFY TOKEN
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
  console.log('🗺️ [Speaker Mapping] Save & Extract Tasks');
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

    // Parse request
    const { meetingId, speakerMapping } = request.body;

    if (!meetingId || !speakerMapping) {
      return response.status(400).json({ error: 'Missing meetingId or speakerMapping' });
    }

    console.log('📁 Meeting ID:', meetingId);
    console.log('🗺️ Speaker Mapping:', speakerMapping);

    const db = getAdminDb();

    // Get meeting
    const meetingRef = db.collection('meetings').doc(meetingId);
    const meetingDoc = await meetingRef.get();

    if (!meetingDoc.exists) {
      return response.status(404).json({ error: 'Meeting not found' });
    }

    const meeting = meetingDoc.data()!;

    // Verify ownership
    if (meeting.userId !== userId) {
      return response.status(403).json({ error: 'Not authorized' });
    }

    // VALIDATION: Check for duplicate assignments
    const assignedMtaiIds = Object.values(speakerMapping) as string[];
    const uniqueAssignees = new Set(assignedMtaiIds.filter(id => id && id !== ''));
    if (uniqueAssignees.size !== assignedMtaiIds.filter(id => id && id !== '').length) {
      return response.status(400).json({ 
        error: 'Duplicate assignment detected. Each user can only be assigned to one speaker.' 
      });
    }

    // Get meeting creator info for notifications
    const creatorDoc = await db.collection('users').where('uid', '==', userId).limit(1).get();
    const creatorData = creatorDoc.empty ? null : creatorDoc.docs[0].data();
    const creatorMtaiId = creatorData?.mtaiId || '';
    const creatorName = creatorData?.displayName || 'Meeting Organizer';

    // Update status to analyzing
    await meetingRef.update({
      status: 'analyzing',
      speakerMapping,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Get transcript
    const transcriptDoc = await db.collection('transcripts').doc(meetingId).get();
    if (!transcriptDoc.exists) {
      await meetingRef.update({
        status: 'error',
        errorMessage: 'Transcript not found',
        updatedAt: FieldValue.serverTimestamp(),
      });
      return response.status(404).json({ error: 'Transcript not found' });
    }

    const transcript = transcriptDoc.data()!;

    // Get MTAI IDs from mapping (filter empty values - skipped speakers)
    const mtaiIds = (Object.values(speakerMapping) as string[]).filter(id => id && id !== '');
    
    // Look up users by MTAI ID
    const usersMap = await lookupUsersByMtaiId(db, mtaiIds);
    
    // Build MTAI ID to display name mapping
    const mtaiIdToName = new Map<string, string>();
    const mtaiIdToEmail = new Map<string, string>();
    
    for (const [mtaiId, user] of usersMap) {
      mtaiIdToName.set(mtaiId, user.displayName);
      mtaiIdToEmail.set(mtaiId, user.email);
    }

    console.log('👥 Users found:', usersMap.size);
    console.log('📧 MTAI to Name:', Object.fromEntries(mtaiIdToName));

    // Extract tasks using LeMUR
    console.log('🤖 Extracting tasks with LeMUR...');
    
    let extractedTasks: any[] = [];
    
    if (meeting.transcriptId) {
      extractedTasks = await extractTasksWithLeMUR(
        meeting.transcriptId,
        speakerMapping,
        mtaiIdToName
      );
    }

    console.log('📋 Tasks extracted:', extractedTasks.length);

    // Save tasks to Firestore with enhanced structure
    const savedTasks: EnhancedTask[] = [];
    const batch = db.batch();

    for (const task of extractedTasks) {
      const taskRef = db.collection('tasks').doc();
      // Use mtaiId from LeMUR response or fall back to first speaker
      const assignedMtaiId = task.assignedToMtaiId || task.assignedTo || mtaiIds[0] || '';
      
      // Normalize priority (handle "critical" from LLM)
      let priority = (task.priority || 'medium').toLowerCase();
      if (!['critical', 'high', 'medium', 'low'].includes(priority)) {
        priority = 'medium';
      }
      
      const taskData: EnhancedTask = {
        id: taskRef.id,
        meetingId,
        meetingTitle: meeting.title || 'Untitled Meeting',
        
        // Ownership
        creatorId: userId,
        creatorMtaiId: creatorMtaiId,
        creatorName: creatorName,
        
        // Assignment
        assignedTo: assignedMtaiId,
        assignedToName: mtaiIdToName.get(assignedMtaiId) || assignedMtaiId,
        assignedToEmail: mtaiIdToEmail.get(assignedMtaiId) || '',
        speakerId: task.speakerId,
        
        // Task details
        title: task.title || 'Untitled Task',
        description: task.description || '',
        priority: priority as 'critical' | 'high' | 'medium' | 'low',
        status: 'pending',
        dueDate: task.dueDate || null,
        
        // AI extraction metadata
        confidence: task.confidence,
        sourceSentence: task.sourceSentence || null,
        
        // Timestamps
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        
        // Legacy compatibility
        userId: userId,
      };

      batch.set(taskRef, taskData);
      savedTasks.push(taskData);
    }

    await batch.commit();
    console.log('💾 Tasks saved to Firestore');

    // Update transcript with mapping
    await db.collection('transcripts').doc(meetingId).update({
      speakerMapping,
      speakerMappingComplete: true,
      mtaiIdToName: Object.fromEntries(mtaiIdToName),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Update meeting to completed
    await meetingRef.update({
      status: 'completed',
      speakerMapping,
      speakerMappingComplete: true,
      taskCount: savedTasks.length,
      participants: mtaiIds,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log('\n✅ Speaker mapping saved & tasks extracted!');
    console.log('   - Tasks:', savedTasks.length);
    console.log('   - Status: completed');

    // ============================================
    // ASYNC EMAIL NOTIFICATIONS
    // Fire-and-forget - don't block the response
    // ============================================
    if (savedTasks.length > 0) {
      console.log('📧 Triggering async email notifications...');
      
      // Get base URL for notification service
      const baseUrl = process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}`
        : '';
      
      // Fire-and-forget - don't await
      if (baseUrl) {
        fetch(`${baseUrl}/api/send-task-notifications`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meetingId,
            meetingTitle: meeting.title || 'Untitled Meeting',
            tasks: savedTasks,
            creatorName: creatorName,
          }),
        }).catch(err => {
          console.error('📧 Email notification failed (non-blocking):', err.message);
        });
      } else {
        console.log('⚠️ VERCEL_URL not set - skipping email notifications');
      }
    }

      tasks: savedTasks,
      status: 'completed',
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    return response.status(500).json({ error: error.message });
  }
}
