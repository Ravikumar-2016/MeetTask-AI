/**
 * Save Speaker Mapping API
 * 
 * POST /api/save-speaker-mapping
 * 
 * SIMPLIFIED WORKFLOW (No AI Task Extraction):
 * 1. Manager maps speakers to employees: { A: "MTAI001", B: "MTAI002" }
 * 2. Validates: No duplicates, manager excluded from mapping
 * 3. Saves mapping to transcript
 * 4. Updates meeting status to "completed"
 * 5. Manager manually creates tasks in Task Manager
 * 
 * Request body:
 * {
 *   meetingId: string,
 *   speakerMapping: { A: "MTAI001", B: "MTAI002", ... }
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
  console.log('🗺️ [Speaker Mapping] Save Mapping');
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

    // Verify ownership (only manager who created meeting can save mapping)
    if (meeting.userId !== userId) {
      return response.status(403).json({ error: 'Not authorized' });
    }

    // VALIDATION: Check for duplicate assignments
    const assignedMtaiIds = Object.values(speakerMapping) as string[];
    const nonEmptyAssignees = assignedMtaiIds.filter(id => id && id !== '');
    const uniqueAssignees = new Set(nonEmptyAssignees);
    
    if (uniqueAssignees.size !== nonEmptyAssignees.length) {
      return response.status(400).json({ 
        error: 'Duplicate assignment detected. Each employee can only be assigned to one speaker.' 
      });
    }

    // Get creator info
    const creatorDoc = await db.collection('users').where('uid', '==', userId).limit(1).get();
    const creatorData = creatorDoc.empty ? null : creatorDoc.docs[0].data();
    const creatorMtaiId = creatorData?.mtaiId || '';

    // VALIDATION: Manager should not be in the mapping
    if (nonEmptyAssignees.includes(creatorMtaiId)) {
      return response.status(400).json({ 
        error: 'Manager cannot be assigned as a meeting participant.' 
      });
    }

    // Look up employee names for the mapping
    const mtaiIdToName = new Map<string, string>();
    
    if (nonEmptyAssignees.length > 0) {
      const usersSnapshot = await db.collection('users').get();
      usersSnapshot.forEach((doc) => {
        const data = doc.data();
        if (nonEmptyAssignees.includes(data.mtaiId)) {
          mtaiIdToName.set(data.mtaiId, data.name || data.displayName || data.email?.split('@')[0] || 'User');
        }
      });
    }

    console.log('👥 Mapped employees:', Object.fromEntries(mtaiIdToName));

    // Update transcript with mapping
    const transcriptRef = db.collection('transcripts').doc(meetingId);
    const transcriptDoc = await transcriptRef.get();
    
    if (transcriptDoc.exists) {
      await transcriptRef.update({
        speakerMapping,
        speakerMappingComplete: true,
        mtaiIdToName: Object.fromEntries(mtaiIdToName),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // Update meeting status to completed
    await meetingRef.update({
      status: 'completed',
      speakerMapping,
      speakerMappingComplete: true,
      participants: nonEmptyAssignees,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log('\n✅ Speaker mapping saved successfully!');
    console.log('   - Participants:', nonEmptyAssignees.length);
    console.log('   - Status: completed');
    console.log('   - Ready for manual task creation');

    return response.status(200).json({
      success: true,
      status: 'completed',
      participants: nonEmptyAssignees,
      message: 'Speaker mapping saved. You can now create tasks manually in the Task Manager.',
    });

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error('❌ Stack:', error.stack);
    return response.status(500).json({ error: error.message });
  }
}
