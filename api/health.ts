/**
 * Health Check API
 * 
 * GET /api/health
 * 
 * Returns the status of the API and environment variables.
 * Use this to verify your deployment is configured correctly.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin inline
function getAdminDb() {
  if (getApps().length === 0) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error('Missing Firebase Admin credentials');
    }

    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      }),
    });
  }
  return getFirestore();
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  // Check environment variables (don't expose actual values!)
  const envStatus = {
    ASSEMBLYAI_API_KEY: !!process.env.ASSEMBLYAI_API_KEY,
    FIREBASE_PROJECT_ID: !!process.env.FIREBASE_PROJECT_ID,
    FIREBASE_CLIENT_EMAIL: !!process.env.FIREBASE_CLIENT_EMAIL,
    FIREBASE_PRIVATE_KEY: !!process.env.FIREBASE_PRIVATE_KEY,
  };

  const allConfigured = Object.values(envStatus).every(v => v === true);

  // Check Firebase Admin
  let firebaseStatus = 'unknown';
  try {
    const db = getAdminDb();
    await db.collection('_health_check').doc('test').get();
    firebaseStatus = 'connected';
  } catch (error: any) {
    firebaseStatus = `error: ${error.message}`;
  }

  return response.status(200).json({
    status: allConfigured ? 'healthy' : 'missing_config',
    timestamp: new Date().toISOString(),
    environment: {
      ...envStatus,
      allConfigured,
    },
    firebase: firebaseStatus,
    message: allConfigured 
      ? 'All environment variables are configured' 
      : 'Some environment variables are missing. Check Vercel Dashboard > Settings > Environment Variables',
  });
}
