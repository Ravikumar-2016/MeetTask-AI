/**
 * Migrate Users API - One-time migration
 * 
 * POST /api/migrate-users
 * 
 * Migrates all existing users to have MTAI IDs.
 * This is a one-time operation to fix users created before the MTAI ID system.
 * 
 * NOTE: This requires admin access. In production, you'd want to secure this endpoint.
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
// GENERATE MTAI ID
// ============================================
async function generateMtaiId(db: FirebaseFirestore.Firestore): Promise<string> {
  const counterRef = db.collection('system').doc('counters');
  
  try {
    const counterDoc = await counterRef.get();
    let nextNumber = 1;
    
    if (counterDoc.exists) {
      nextNumber = (counterDoc.data()?.userCount || 0) + 1;
    }
    
    await counterRef.set({ userCount: nextNumber }, { merge: true });
    
    return `MTAI${nextNumber.toString().padStart(3, '0')}`;
  } catch (error) {
    // Fallback
    return `MTAI${Date.now().toString().slice(-6)}`;
  }
}

// ============================================
// MAIN HANDLER
// ============================================
export default async function handler(request: VercelRequest, response: VercelResponse) {
  // CORS
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (request.method === 'OPTIONS') return response.status(200).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });

  console.log('\n========================================');
  console.log('🔄 [Migration] Starting user migration');
  console.log('========================================\n');

  try {
    const db = getAdminDb();
    
    // Get all users
    const usersSnap = await db.collection('users').get();
    
    const migrated: string[] = [];
    const alreadyHasMtaiId: string[] = [];
    const errors: string[] = [];
    
    for (const docSnap of usersSnap.docs) {
      const data = docSnap.data();
      const docId = docSnap.id;
      const email = data.email || docId;
      
      try {
        if (data.mtaiId) {
          // Already has MTAI ID
          alreadyHasMtaiId.push(`${docId} (${data.mtaiId})`);
          continue;
        }
        
        // Generate new MTAI ID
        const mtaiId = await generateMtaiId(db);
        
        // Determine if this is email-based or UID-based document
        const isEmailBased = docId.includes('@');
        
        if (isEmailBased) {
          // Update existing document
          await docSnap.ref.update({
            mtaiId,
            updatedAt: FieldValue.serverTimestamp(),
          });
          migrated.push(`${docId} → ${mtaiId} (updated)`);
        } else {
          // UID-based document - migrate to email-based if email exists
          if (email && email.includes('@')) {
            // Create new email-based document
            const emailRef = db.collection('users').doc(email);
            await emailRef.set({
              uid: data.uid || docId,
              mtaiId,
              email: email,
              displayName: data.displayName || email.split('@')[0],
              photoURL: data.photoURL || null,
              authProviders: data.authProviders || [data.authProvider || 'unknown'],
              createdAt: data.createdAt || FieldValue.serverTimestamp(),
              updatedAt: FieldValue.serverTimestamp(),
            });
            migrated.push(`${docId} → ${email} (${mtaiId}) (migrated to email-based)`);
          } else {
            // No email, just add MTAI ID to existing document
            await docSnap.ref.update({
              mtaiId,
              updatedAt: FieldValue.serverTimestamp(),
            });
            migrated.push(`${docId} → ${mtaiId} (updated UID-based)`);
          }
        }
      } catch (err: any) {
        errors.push(`${docId}: ${err.message}`);
      }
    }

    console.log('\n✅ Migration complete!');
    console.log('   - Migrated:', migrated.length);
    console.log('   - Already had MTAI ID:', alreadyHasMtaiId.length);
    console.log('   - Errors:', errors.length);

    return response.status(200).json({
      success: true,
      summary: {
        total: usersSnap.size,
        migrated: migrated.length,
        alreadyHasMtaiId: alreadyHasMtaiId.length,
        errors: errors.length,
      },
      details: {
        migrated,
        alreadyHasMtaiId,
        errors,
      },
    });

  } catch (error: any) {
    console.error('❌ Migration error:', error.message);
    return response.status(500).json({ error: error.message });
  }
}
