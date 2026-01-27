/**
 * Firebase Admin SDK Initialization
 * 
 * Uses environment variables instead of JSON file for security.
 * Required env variables:
 * - FIREBASE_PROJECT_ID
 * - FIREBASE_CLIENT_EMAIL
 * - FIREBASE_PRIVATE_KEY
 * 
 * Get these from Firebase Console:
 * Project Settings → Service Accounts → Generate New Private Key
 */

import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

let app: App;

/**
 * Initialize Firebase Admin SDK
 * Uses singleton pattern to prevent multiple initializations
 */
function initializeFirebaseAdmin(): App {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  // Validate required environment variables
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Missing Firebase Admin SDK credentials. Please set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY environment variables.'
    );
  }

  // Initialize with service account credentials from env variables
  app = initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      // Handle escaped newlines in private key (common in env variables)
      privateKey: privateKey.replace(/\\n/g, '\n'),
    }),
  });

  console.log('✅ Firebase Admin SDK initialized');
  return app;
}

// Initialize on module load
app = initializeFirebaseAdmin();

// Export initialized services
export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);
export { app as adminApp };
