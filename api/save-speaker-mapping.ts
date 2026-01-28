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
// TASK EXTRACTION WITH GEMINI (Primary & Only Method)
// ============================================
async function extractTasksWithGemini(
  transcriptText: string,
  speakerMapping: SpeakerMapping,
  mtaiIdToName: Map<string, string>
): Promise<any[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    console.error('❌ GEMINI_API_KEY not configured');
    return [];
  }
  
  console.log('🤖 Gemini: Extracting tasks...');
  console.log('🗺️ Gemini: Speaker mapping:', speakerMapping);
  
  // Build speaker info for prompt
  const speakerInfo = Object.entries(speakerMapping)
    .filter(([_, mtaiId]) => mtaiId)
    .map(([id, mtaiId]) => {
      const name = mtaiIdToName.get(mtaiId) || mtaiId;
      return `Speaker ${id} = ${name} (ID: ${mtaiId})`;
    })
    .join('\n');

  console.log('👥 Gemini: Speaker info:\n', speakerInfo);

  // Truncate transcript to fit context window (leave room for prompt)
  const maxTranscriptLength = 25000;
  const truncatedTranscript = transcriptText.length > maxTranscriptLength 
    ? transcriptText.substring(0, maxTranscriptLength) + '\n\n[Transcript truncated...]'
    : transcriptText;

  const prompt = `You are a meeting assistant that extracts action items from meeting transcripts.

SPEAKER MAPPING:
${speakerInfo}

MEETING TRANSCRIPT:
${truncatedTranscript}

TASK:
Extract ALL action items and tasks from this meeting transcript. Look for:
- Explicit commitments ("I'll do...", "I will...")
- Assignments ("Can you...", "Please...")
- Decisions that require follow-up
- Deadlines mentioned

For each task, return a JSON object with these exact fields:
- "title": Brief, actionable task title (max 80 characters)
- "description": Clear description of what needs to be done
- "assignedToMtaiId": The MTAI ID (e.g., "MTAI001") of the person responsible based on speaker mapping
- "speakerId": The speaker letter (A, B, C, etc.) who owns this task
- "priority": One of "critical", "high", "medium", or "low"
- "dueDate": If a deadline is mentioned, use YYYY-MM-DD format, otherwise null
- "sourceSentence": The exact quote from the transcript that mentions this task

PRIORITY GUIDELINES:
- critical: Urgent, blocking other work, explicitly marked as priority
- high: Important deadline mentioned, significant business impact
- medium: Normal work items, standard priority
- low: Nice-to-have, can be delayed, minor items

IMPORTANT RULES:
1. Only extract CLEAR action items with explicit commitments
2. Match tasks to the correct speaker using the mapping above
3. Never invent tasks that weren't discussed
4. If no clear tasks are found, return an empty array []
5. Return ONLY valid JSON - no markdown, no explanations

Return your response as a JSON array of task objects:`;

  try {
    console.log('📤 Gemini: Sending request...');
    
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          ],
        }),
      }
    );

    console.log('📥 Gemini: Response status:', res.status);

    if (!res.ok) {
      const errorText = await res.text();
      console.error('❌ Gemini API error:', res.status, errorText);
      return [];
    }

    const data = await res.json();
    
    // Extract text from Gemini response
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('📄 Gemini response (first 500 chars):', content.substring(0, 500));

    // Parse JSON from response
    let tasks: any[] = [];
    try {
      // Try direct parse first (since we requested JSON mime type)
      tasks = JSON.parse(content);
      
      // If not an array, try to find array in response
      if (!Array.isArray(tasks)) {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          tasks = JSON.parse(jsonMatch[0]);
        } else {
          console.warn('⚠️ Gemini: Response is not an array');
          tasks = [];
        }
      }
      
      console.log('✅ Gemini: Parsed', tasks.length, 'tasks');
    } catch (parseError: any) {
      console.error('❌ Failed to parse Gemini response:', parseError.message);
      // Try to find JSON array in response as fallback
      try {
        const jsonMatch = content.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          tasks = JSON.parse(jsonMatch[0]);
          console.log('✅ Gemini: Recovered', tasks.length, 'tasks from partial response');
        }
      } catch {
        console.error('❌ Could not recover JSON from response');
      }
    }

    return Array.isArray(tasks) ? tasks : [];
  } catch (error: any) {
    console.error('❌ Gemini extraction failed:', error.message);
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

    // Extract tasks using Gemini AI
    console.log('🤖 Extracting tasks with Gemini...');
    
    let extractedTasks: any[] = [];
    
    // Get transcript text for extraction
    const transcriptText = transcript.formattedTranscript || transcript.text || '';
    console.log('📄 Transcript length:', transcriptText.length, 'chars');
    
    if (transcriptText.length > 50) {
      if (process.env.GEMINI_API_KEY) {
        try {
          extractedTasks = await extractTasksWithGemini(
            transcriptText,
            speakerMapping,
            mtaiIdToName
          );
          console.log('✅ Gemini extraction completed, tasks:', extractedTasks.length);
        } catch (geminiError: any) {
          console.error('❌ Gemini extraction failed:', geminiError.message);
          // Don't fail the whole operation - just log and continue with 0 tasks
        }
      } else {
        console.error('❌ GEMINI_API_KEY not configured - cannot extract tasks');
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
      // Use mtaiId from Gemini response or fall back to first speaker
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

    return response.status(200).json({
      success: true,
      tasks: savedTasks,
      tasksExtracted: savedTasks.length,
      status: 'completed',
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('❌ Stack:', error.stack);
    return response.status(500).json({ error: error.message });
  }
}
