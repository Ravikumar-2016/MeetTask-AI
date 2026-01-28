/**
 * Save Speaker Mapping & Extract Tasks
 * 
 * POST /api/save-speaker-mapping
 * 
 * Called when user maps speakers to real people:
 * - User maps: { A: "john@email.com", B: "jane@email.com" }
 * - We save the mapping
 * - We use LeMUR to extract tasks with correct assignments
 * - Status → "completed"
 * 
 * Request body:
 * {
 *   meetingId: string,
 *   speakerMapping: { A: "email@...", B: "email@...", ... }
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
  [speakerId: string]: string; // "A" => "john@email.com"
}

interface Task {
  id: string;
  meetingId: string;
  userId: string;
  title: string;
  description: string;
  assignedTo: string;
  assignedToName?: string;
  speakerId?: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in_progress' | 'completed';
  dueDate?: string;
  createdAt: any;
}

interface SpeakerUtterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

// ============================================
// LeMUR TASK EXTRACTION
// ============================================
async function extractTasksWithLeMUR(
  transcriptId: string,
  speakerMapping: SpeakerMapping,
  participants: string[]
): Promise<any[]> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  
  // Build speaker info for prompt
  const speakerInfo = Object.entries(speakerMapping)
    .map(([id, email]) => `Speaker ${id} = ${email}`)
    .join(', ');

  const prompt = `Analyze this meeting transcript and extract action items/tasks.

SPEAKER MAPPING:
${speakerInfo}

For each task found, return:
1. title: Brief task title
2. description: What needs to be done
3. assignedTo: Email of the person who should do it (use the speaker mapping above)
4. speakerId: The speaker ID (A, B, C) who is assigned
5. priority: "low", "medium", or "high"
6. dueDate: If mentioned (YYYY-MM-DD format)

Return a JSON array of tasks. If no clear tasks found, return an empty array [].

IMPORTANT:
- Only extract CLEAR action items (things someone committed to do)
- Use the exact email addresses from the speaker mapping
- If someone says "I'll do X", assign to that speaker's email
- If someone says "Can you do X?", assign to the person being asked

Return ONLY valid JSON, no markdown, no explanation.`;

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

    // Get participant names for display
    const participants = Object.values(speakerMapping) as string[];
    
    // Build participant info (look up display names)
    const userDocs = await Promise.all(
      participants.map(email => db.collection('users').doc(email).get())
    );
    
    const emailToName: { [email: string]: string } = {};
    userDocs.forEach((doc, i) => {
      if (doc.exists) {
        emailToName[participants[i]] = doc.data()?.displayName || participants[i];
      } else {
        emailToName[participants[i]] = participants[i].split('@')[0];
      }
    });

    console.log('📧 Email to Name:', emailToName);

    // Extract tasks using LeMUR
    console.log('🤖 Extracting tasks with LeMUR...');
    
    let extractedTasks: any[] = [];
    
    if (meeting.transcriptId) {
      extractedTasks = await extractTasksWithLeMUR(
        meeting.transcriptId,
        speakerMapping,
        participants
      );
    }

    console.log('📋 Tasks extracted:', extractedTasks.length);

    // Save tasks to Firestore
    const savedTasks: Task[] = [];
    const batch = db.batch();

    for (const task of extractedTasks) {
      const taskRef = db.collection('tasks').doc();
      const assignedEmail = task.assignedTo || participants[0] || userId;
      
      const taskData: Task = {
        id: taskRef.id,
        meetingId,
        userId,
        title: task.title || 'Untitled Task',
        description: task.description || '',
        assignedTo: assignedEmail,
        assignedToName: emailToName[assignedEmail] || assignedEmail.split('@')[0],
        speakerId: task.speakerId,
        priority: task.priority || 'medium',
        status: 'pending',
        dueDate: task.dueDate,
        createdAt: FieldValue.serverTimestamp(),
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
      emailToName,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Update meeting to completed
    await meetingRef.update({
      status: 'completed',
      speakerMapping,
      speakerMappingComplete: true,
      taskCount: savedTasks.length,
      participants,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log('\n✅ Speaker mapping saved & tasks extracted!');
    console.log('   - Tasks:', savedTasks.length);
    console.log('   - Status: completed');

    return response.status(200).json({
      success: true,
      meetingId,
      tasksExtracted: savedTasks.length,
      tasks: savedTasks,
      status: 'completed',
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    return response.status(500).json({ error: error.message });
  }
}
