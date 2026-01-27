/**
 * Token Verification Helper
 * 
 * Verifies Firebase ID tokens from the Authorization header.
 * Usage: const user = await verifyToken(request);
 */

import type { VercelRequest } from '@vercel/node';
import { adminAuth } from './firebaseAdmin';
import { DecodedIdToken } from 'firebase-admin/auth';

export interface AuthenticatedUser {
  uid: string;
  email: string | undefined;
  emailVerified: boolean;
}

export class AuthError extends Error {
  statusCode: number;
  
  constructor(message: string, statusCode: number = 401) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

/**
 * Extract and verify Firebase ID token from request
 * 
 * @param request - Vercel request object
 * @returns Authenticated user info
 * @throws AuthError if token is missing or invalid
 */
export async function verifyToken(request: VercelRequest): Promise<AuthenticatedUser> {
  // Get Authorization header
  const authHeader = request.headers.authorization;
  
  if (!authHeader) {
    throw new AuthError('Missing Authorization header');
  }

  // Check for Bearer token format
  if (!authHeader.startsWith('Bearer ')) {
    throw new AuthError('Invalid Authorization format. Use: Bearer <token>');
  }

  // Extract token
  const token = authHeader.substring(7); // Remove 'Bearer ' prefix

  if (!token || token.trim() === '') {
    throw new AuthError('Empty token provided');
  }

  try {
    // Verify token with Firebase Admin
    const decodedToken: DecodedIdToken = await adminAuth.verifyIdToken(token);
    
    return {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified || false,
    };
  } catch (error: any) {
    console.error('Token verification failed:', error.message);
    
    // Provide specific error messages
    if (error.code === 'auth/id-token-expired') {
      throw new AuthError('Token has expired. Please sign in again.', 401);
    }
    if (error.code === 'auth/id-token-revoked') {
      throw new AuthError('Token has been revoked. Please sign in again.', 401);
    }
    if (error.code === 'auth/argument-error') {
      throw new AuthError('Invalid token format.', 401);
    }
    
    throw new AuthError('Invalid or expired token.', 401);
  }
}
