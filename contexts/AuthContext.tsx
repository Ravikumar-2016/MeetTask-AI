/**
 * AuthContext.tsx - Production-ready Firebase Authentication
 * 
 * Features:
 * - Email/Password signup with email verification
 * - Password reset via Firebase
 * - Google OAuth (auto-verified)
 * - Proper error handling without relying on fetchSignInMethodsForEmail
 *   (which returns empty due to Firebase's Email Enumeration Protection)
 * 
 * Note: Firebase has Email Enumeration Protection enabled by default (since 2023),
 * which makes fetchSignInMethodsForEmail return empty arrays. We handle auth
 * errors directly instead.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  User as FirebaseUser,
  AuthError
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase';
import { User } from '../types';

// Extended User type with verification and provider info
interface ExtendedUser extends User {
  emailVerified: boolean;
  authProvider: 'email' | 'google';
}

// Auth context interface
interface AuthContextType {
  user: ExtendedUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  googleLogin: () => Promise<void>;
  logout: () => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  refreshUser: () => Promise<void>;
}

// Default context value
const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => {},
  signup: async () => {},
  googleLogin: async () => {},
  logout: async () => {},
  sendVerificationEmail: async () => {},
  sendPasswordReset: async () => {},
  refreshUser: async () => {}
});

/**
 * Get user-friendly error message from Firebase Auth error
 */
const getAuthErrorMessage = (error: AuthError): string => {
  const errorMessages: Record<string, string> = {
    'auth/user-not-found': 'No account found with this email. Please sign up first.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/invalid-credential': 'Invalid email or password. Please check your credentials.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/email-already-in-use': 'An account with this email already exists. Please sign in.',
    'auth/weak-password': 'Password should be at least 6 characters long.',
    'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
    'auth/user-disabled': 'This account has been disabled. Please contact support.',
    'auth/popup-closed-by-user': 'Sign-in popup was closed. Please try again.',
    'auth/popup-blocked': 'Popup was blocked by your browser. Please allow popups for this site.',
    'auth/account-exists-with-different-credential': 'An account already exists with this email using a different sign-in method.',
    'auth/network-request-failed': 'Network error. Please check your internet connection.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled. Please contact support.',
    'auth/requires-recent-login': 'Please sign in again to complete this action.'
  };

  return errorMessages[error.code] || error.message || 'An unexpected error occurred. Please try again.';
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<ExtendedUser | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Convert Firebase User to our ExtendedUser type
   */
  const mapFirebaseUser = useCallback((firebaseUser: FirebaseUser): ExtendedUser => {
    // Determine auth provider from providerData
    const isGoogleUser = firebaseUser.providerData.some(
      provider => provider.providerId === 'google.com'
    );

    return {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
      photoURL: firebaseUser.photoURL,
      emailVerified: firebaseUser.emailVerified,
      authProvider: isGoogleUser ? 'google' : 'email'
    };
  }, []);

  /**
   * Create or update user document in Firestore
   */
  const saveUserToFirestore = useCallback(async (firebaseUser: FirebaseUser) => {
    try {
      const userRef = doc(db, 'users', firebaseUser.uid);
      const userSnap = await getDoc(userRef);
      const isGoogleUser = firebaseUser.providerData.some(p => p.providerId === 'google.com');

      const userData = {
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
        photoURL: firebaseUser.photoURL || null,
        emailVerified: firebaseUser.emailVerified,
        authProvider: isGoogleUser ? 'google' : 'email',
        updatedAt: serverTimestamp()
      };

      if (!userSnap.exists()) {
        // New user - create document
        await setDoc(userRef, {
          ...userData,
          createdAt: serverTimestamp()
        });
        console.log('✅ User document created');
      } else {
        // Existing user - update document
        await setDoc(userRef, userData, { merge: true });
        console.log('✅ User document updated');
      }
    } catch (error: any) {
      // Don't fail auth if Firestore fails (permissions, network, etc.)
      console.warn('⚠️ Firestore update failed:', error.message);
    }
  }, []);

  /**
   * Email/Password Login
   */
  const login = useCallback(async (email: string, password: string) => {
    try {
      console.log('🔐 Attempting login...');
      const result = await signInWithEmailAndPassword(auth, email, password);
      await saveUserToFirestore(result.user);
      console.log('✅ Login successful');
    } catch (error: any) {
      console.error('❌ Login error:', error.code);
      throw new Error(getAuthErrorMessage(error));
    }
  }, [saveUserToFirestore]);

  /**
   * Email/Password Signup with verification email
   */
  const signup = useCallback(async (email: string, password: string) => {
    try {
      console.log('📝 Creating account...');
      
      // Create the user account
      const result = await createUserWithEmailAndPassword(auth, email, password);
      console.log('✅ Account created');

      // Send verification email
      try {
        await sendEmailVerification(result.user);
        console.log('📧 Verification email sent');
      } catch (emailError: any) {
        console.warn('⚠️ Could not send verification email:', emailError.message);
        // Don't fail signup if email fails - user can resend later
      }

      // Save to Firestore
      await saveUserToFirestore(result.user);
      
    } catch (error: any) {
      console.error('❌ Signup error:', error.code);
      throw new Error(getAuthErrorMessage(error));
    }
  }, [saveUserToFirestore]);

  /**
   * Google OAuth Login
   */
  const googleLogin = useCallback(async () => {
    try {
      console.log('🔵 Starting Google sign-in...');
      const result = await signInWithPopup(auth, googleProvider);
      await saveUserToFirestore(result.user);
      console.log('✅ Google sign-in successful');
    } catch (error: any) {
      console.error('❌ Google sign-in error:', error.code);
      throw new Error(getAuthErrorMessage(error));
    }
  }, [saveUserToFirestore]);

  /**
   * Send verification email to current user
   */
  const sendVerificationEmail = useCallback(async () => {
    if (!auth.currentUser) {
      throw new Error('You must be signed in to send a verification email.');
    }

    if (auth.currentUser.emailVerified) {
      throw new Error('Your email is already verified.');
    }

    try {
      await sendEmailVerification(auth.currentUser);
      console.log('📧 Verification email sent');
    } catch (error: any) {
      console.error('❌ Verification email error:', error.code);
      throw new Error(getAuthErrorMessage(error));
    }
  }, []);

  /**
   * Send password reset email
   */
  const sendPasswordReset = useCallback(async (email: string) => {
    try {
      console.log('🔑 Sending password reset email...');
      await sendPasswordResetEmail(auth, email);
      console.log('📧 Password reset email sent');
    } catch (error: any) {
      console.error('❌ Password reset error:', error.code);
      throw new Error(getAuthErrorMessage(error));
    }
  }, []);

  /**
   * Sign out
   */
  const logout = useCallback(async () => {
    try {
      await firebaseSignOut(auth);
      console.log('👋 Signed out');
    } catch (error: any) {
      console.error('❌ Sign out error:', error.code);
      throw new Error('Failed to sign out. Please try again.');
    }
  }, []);

  /**
   * Refresh current user data (for checking email verification status)
   */
  const refreshUser = useCallback(async () => {
    if (auth.currentUser) {
      await auth.currentUser.reload();
      setUser(mapFirebaseUser(auth.currentUser));
      console.log('🔄 User data refreshed');
    }
  }, [mapFirebaseUser]);

  /**
   * Listen for auth state changes
   */
  useEffect(() => {
    console.log('🔍 Setting up auth listener...');
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        console.log('👤 User signed in:', firebaseUser.email);
        setUser(mapFirebaseUser(firebaseUser));
      } else {
        console.log('👤 No user signed in');
        setUser(null);
      }
      setLoading(false);
    });

    return () => {
      console.log('🧹 Cleaning up auth listener');
      unsubscribe();
    };
  }, [mapFirebaseUser]);

  const value: AuthContextType = {
    user,
    loading,
    login,
    signup,
    googleLogin,
    logout,
    sendVerificationEmail,
    sendPasswordReset,
    refreshUser
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
