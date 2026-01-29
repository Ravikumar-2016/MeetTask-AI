/**
 * Save Speaker Mapping & Extract Tasks
 * 
 * POST /api/save-speaker-mapping
 * 
 * ENTERPRISE WORKFLOW:
 * 1. User maps speakers: { A: "MTAI001", B: "MTAI002" }
 * 2. Validates: No duplicates, creator excluded from assignment
 * 3. Saves mapping to transcript
 * 4. Uses GEMINI to extract tasks with correct assignments
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

// CRITICAL: Force Node.js runtime
export const runtime = "nodejs";

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ============================================
// OPENAI CONFIG (More reliable than Gemini)
// ============================================
const OPENAI_MODEL = 'gpt-4o-mini'; // Fast, cheap, reliable

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
  speakerId: string | null;
  
  // Task details
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
  dueDate: string | null;
  
  // AI extraction (use null not undefined for Firestore)
  confidence: number | null;
  sourceSentence: string | null;
  
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
// TASK EXTRACTION WITH OPENAI (GPT-4o-mini)
// ============================================
async function extractTasksWithAI(
  transcriptText: string,
  speakerMapping: SpeakerMapping,
  mtaiIdToName: Map<string, string>
): Promise<any[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    console.error('❌ OPENAI_API_KEY not configured');
    throw new Error('OPENAI_API_KEY not configured');
  }
  
  console.log('🤖 OpenAI: Extracting tasks with GPT-4o-mini...');
  console.log('🗺️ Speaker mapping:', speakerMapping);
  
  // Build speaker info for prompt
  const speakerInfo = Object.entries(speakerMapping)
    .filter(([_, mtaiId]) => mtaiId)
    .map(([id, mtaiId]) => {
      const name = mtaiIdToName.get(mtaiId) || mtaiId;
      return `Speaker ${id} = ${name} (ID: ${mtaiId})`;
    })
    .join('\n');

  console.log('👥 Speaker info:\n', speakerInfo);

  // Truncate transcript to fit context window
  const maxTranscriptLength = 25000;
  const truncatedTranscript = transcriptText.length > maxTranscriptLength 
    ? transcriptText.substring(0, maxTranscriptLength) + '\n\n[Transcript truncated...]'
    : transcriptText;

  const systemPrompt = `You are a meeting task extraction assistant. Extract ALL action items from meeting transcripts.

For each task, return a JSON object with:
- "title": Brief task title
- "description": What needs to be done
- "assignedToMtaiId": The MTAI ID from speaker mapping
- "speakerId": Speaker letter (A, B, C) who owns this task
- "priority": "high", "medium", or "low"
- "dueDate": YYYY-MM-DD if mentioned, otherwise null
- "sourceSentence": Exact quote from transcript

Return ONLY a valid JSON array. No markdown, no explanation.`;

  const userPrompt = `SPEAKER MAPPING:
${speakerInfo}

TRANSCRIPT:
${truncatedTranscript}

Extract all tasks as JSON array:`;

  try {
    console.log('📤 OpenAI: Sending request...');
    console.log('📄 Transcript length:', truncatedTranscript.length, 'chars');
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 4000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '[]';
    
    console.log('📄 OpenAI response:', content);

    // Parse JSON from response
    let tasks: any[] = [];
    try {
      // Clean the response - remove markdown code blocks if present
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }
      
      // Try to find JSON array in response
      const jsonMatch = cleanContent.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        tasks = JSON.parse(jsonMatch[0]);
        console.log('✅ OpenAI: Parsed', tasks.length, 'tasks');
        if (tasks.length > 0) {
          console.log('📋 First task:', JSON.stringify(tasks[0], null, 2));
        }
      } else {
        tasks = JSON.parse(cleanContent);
        if (!Array.isArray(tasks)) {
          tasks = [tasks];
        }
      }
    } catch (parseError: any) {
      console.error('❌ Failed to parse OpenAI response:', parseError.message);
      console.log('📄 Raw response:', content);
    }

    return Array.isArray(tasks) ? tasks : [];
  } catch (error: any) {
    console.error('❌ OpenAI extraction failed:', error.message);
    throw error;
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

    // Extract tasks using OpenAI
    console.log('🤖 Extracting tasks with OpenAI GPT-4o-mini...');
    
    let extractedTasks: any[] = [];
    
    // Get transcript text for extraction
    const transcriptText = transcript.formattedTranscript || transcript.text || '';
    console.log('📄 Transcript length:', transcriptText.length, 'chars');
    
    // Track if AI extraction actually failed (vs just finding no tasks)
    let aiError: string | null = null;
    
    if (transcriptText.length > 50) {
      if (process.env.OPENAI_API_KEY) {
        try {
          extractedTasks = await extractTasksWithAI(
            transcriptText,
            speakerMapping,
            mtaiIdToName
          );
          console.log('✅ OpenAI extraction completed, tasks:', extractedTasks.length);
        } catch (err: any) {
          aiError = err.message;
          console.error('❌ OpenAI extraction FAILED:', aiError);
          // CRITICAL: Set error status and STOP pipeline
          await meetingRef.update({
            status: 'task_extraction_failed',
            errorMessage: `OpenAI failed: ${aiError}`,
            speakerMapping,
            speakerMappingComplete: true,
            updatedAt: FieldValue.serverTimestamp(),
          });
          
          return response.status(200).json({
            success: false,
            error: 'Task extraction failed',
            errorDetails: aiError,
            status: 'task_extraction_failed',
          });
        }
      } else {
        console.error('❌ OPENAI_API_KEY not configured - cannot extract tasks');
        aiError = 'OPENAI_API_KEY not configured';
      }
    } else {
      console.warn('⚠️ Transcript too short for task extraction');
    }

    console.log('📋 Tasks extracted:', extractedTasks.length);

    // Save tasks to Firestore with enhanced structure
    const savedTasks: EnhancedTask[] = [];
    const batch = db.batch();

    for (const task of extractedTasks) {
      const taskRef = db.collection('tasks').doc();
      // Use mtaiId from AI response or fall back to first speaker
      const assignedMtaiId = task.assignedToMtaiId || task.assignedTo || mtaiIds[0] || '';
      
      // Normalize priority
      let priority = (task.priority || 'medium').toLowerCase();
      if (!['critical', 'high', 'medium', 'low'].includes(priority)) {
        priority = 'medium';
      }
      
      // Build task data - IMPORTANT: No undefined values allowed in Firestore
      const taskData: EnhancedTask = {
        id: taskRef.id,
        meetingId,
        meetingTitle: meeting.title || 'Untitled Meeting',
        
        // Ownership
        creatorId: userId,
        creatorMtaiId: creatorMtaiId || '',
        creatorName: creatorName || 'Meeting Organizer',
        
        // Assignment
        assignedTo: assignedMtaiId,
        assignedToName: mtaiIdToName.get(assignedMtaiId) || assignedMtaiId || '',
        assignedToEmail: mtaiIdToEmail.get(assignedMtaiId) || '',
        speakerId: task.speakerId || null,
        
        // Task details
        title: task.title || 'Untitled Task',
        description: task.description || '',
        priority: priority as 'critical' | 'high' | 'medium' | 'low',
        status: 'pending',
        dueDate: task.dueDate || null,
        
        // AI extraction metadata - use null instead of undefined
        confidence: typeof task.confidence === 'number' ? task.confidence : null,
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

    // CRITICAL: Determine correct status based on extraction result
    // Don't mark as completed if AI failed (0 tasks from extraction failure)
    let finalStatus: string;
    if (savedTasks.length > 0) {
      finalStatus = 'completed';
    } else if (transcriptText.length < 50) {
      finalStatus = 'no_tasks_found'; // Transcript too short
    } else {
      // AI was called but returned 0 tasks - could be failure or genuinely no tasks
      // Check if OPENAI_API_KEY exists to distinguish
      finalStatus = process.env.OPENAI_API_KEY ? 'no_tasks_found' : 'task_extraction_failed';
    }

    // Update meeting with correct status
    await meetingRef.update({
      status: finalStatus,
      speakerMapping,
      speakerMappingComplete: true,
      taskCount: savedTasks.length,
      participants: mtaiIds,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log('\n✅ Speaker mapping saved!');
    console.log('   - Tasks:', savedTasks.length);
    console.log('   - Status:', finalStatus);

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

    return response.status(200).json({
      success: true,
      tasks: savedTasks,
      tasksExtracted: savedTasks.length,
      status: finalStatus,
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('❌ Stack:', error.stack);
    return response.status(500).json({ error: error.message });
  }
}
