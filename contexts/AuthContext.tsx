/**
 * AuthContext.tsx - Production-ready Firebase Authentication
 * 
 * Features:
 * - Human-readable MTAI IDs (MTAI001, MTAI002, etc.)
 * - User deduplication by email (same person = one user)
 * - Email/Password signup with email verification
 * - Password reset via Firebase
 * - Google OAuth (auto-verified)
 * - Auth provider linking (google + password = same user)
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
import { doc, setDoc, getDoc, collection, query, where, getDocs, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase';
import { User, FirestoreUser } from '../types';

// Extended User type with verification and provider info
interface ExtendedUser extends User {
  emailVerified: boolean;
  authProvider: 'email' | 'google';
  mtaiId: string;
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

/**
 * Generate next MTAI ID (MTAI001, MTAI002, etc.)
 */
const generateMtaiId = async (): Promise<string> => {
  const counterRef = doc(db, 'system', 'counters');
  
  try {
    const newId = await runTransaction(db, async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      
      let nextNumber = 1;
      if (counterDoc.exists()) {
        nextNumber = (counterDoc.data().userCount || 0) + 1;
      }
      
      transaction.set(counterRef, { userCount: nextNumber }, { merge: true });
      
      return `MTAI${nextNumber.toString().padStart(3, '0')}`;
    });
    
    console.log('✅ Generated MTAI ID:', newId);
    return newId;
  } catch (error) {
    // Fallback: use timestamp-based ID
    console.warn('⚠️ Counter transaction failed, using fallback');
    return `MTAI${Date.now().toString().slice(-6)}`;
  }
};

/**
 * Find existing user by email (for deduplication)
 */
const findUserByEmail = async (email: string): Promise<FirestoreUser | null> => {
  try {
    // First check in users collection by email document ID
    const userRef = doc(db, 'users', email);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      return userSnap.data() as FirestoreUser;
    }
    
    return null;
  } catch (error) {
    console.warn('⚠️ Error finding user by email:', error);
    return null;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<ExtendedUser | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Convert Firebase User to our ExtendedUser type (with MTAI ID lookup)
   */
  const mapFirebaseUser = useCallback(async (firebaseUser: FirebaseUser): Promise<ExtendedUser> => {
    // Determine auth provider from providerData
    const isGoogleUser = firebaseUser.providerData.some(
      provider => provider.providerId === 'google.com'
    );

    // Look up MTAI ID from Firestore
    let mtaiId = 'MTAI000';
    if (firebaseUser.email) {
      const existingUser = await findUserByEmail(firebaseUser.email);
      if (existingUser) {
        mtaiId = existingUser.mtaiId;
      }
    }

    return {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'User',
      photoURL: firebaseUser.photoURL,
      emailVerified: firebaseUser.emailVerified,
      authProvider: isGoogleUser ? 'google' : 'email',
      mtaiId
    };
  }, []);

  /**
   * Create or update user document in Firestore
   * KEY: Uses email as document ID for deduplication
   * Merges auth providers if same email signs up multiple ways
   */
  const saveUserToFirestore = useCallback(async (firebaseUser: FirebaseUser) => {
    if (!firebaseUser.email) {
      console.warn('⚠️ No email for user, skipping Firestore save');
      return;
    }

    try {
      const email = firebaseUser.email;
      const userRef = doc(db, 'users', email); // KEY: email as document ID
      const userSnap = await getDoc(userRef);
      
      const isGoogleUser = firebaseUser.providerData.some(p => p.providerId === 'google.com');
      const isPasswordUser = firebaseUser.providerData.some(p => p.providerId === 'password');
      const currentProvider: 'google' | 'password' = isGoogleUser ? 'google' : 'password';

      if (userSnap.exists()) {
        // EXISTING USER - merge auth providers
        const existingData = userSnap.data() as FirestoreUser;
        const existingProviders = existingData.authProviders || [];
        
        // Add current provider if not already in list
        const updatedProviders = existingProviders.includes(currentProvider)
          ? existingProviders
          : [...existingProviders, currentProvider];

        await setDoc(userRef, {
          // Keep existing mtaiId
          mtaiId: existingData.mtaiId,
          uid: firebaseUser.uid, // Update to latest UID
          email: email,
          displayName: firebaseUser.displayName || existingData.displayName || email.split('@')[0],
          photoURL: firebaseUser.photoURL || existingData.photoURL || null,
          authProviders: updatedProviders,
          updatedAt: serverTimestamp()
        }, { merge: true });
        
        console.log('✅ User merged, providers:', updatedProviders);
      } else {
        // NEW USER - generate MTAI ID
        const mtaiId = await generateMtaiId();
        
        const userData: FirestoreUser = {
          uid: firebaseUser.uid,
          mtaiId,
          email: email,
          displayName: firebaseUser.displayName || email.split('@')[0],
          photoURL: firebaseUser.photoURL || null,
          authProviders: [currentProvider],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        await setDoc(userRef, userData);
        console.log('✅ New user created:', mtaiId);
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
      const mappedUser = await mapFirebaseUser(auth.currentUser);
      setUser(mappedUser);
      console.log('🔄 User data refreshed');
    }
  }, [mapFirebaseUser]);

  /**
   * Listen for auth state changes
   * 
   * CRITICAL: On page reload, Firebase Auth restores the session from localStorage.
   * This happens asynchronously, so `loading` stays true until onAuthStateChanged fires.
   * All Firestore queries MUST wait for `loading === false` before executing.
   */
  useEffect(() => {
    console.log('🔍 Setting up auth listener...');
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        console.log('👤 Auth state changed: User signed in:', firebaseUser.email);
        const mappedUser = await mapFirebaseUser(firebaseUser);
        setUser(mappedUser);
        console.log('👤 User MTAI ID:', mappedUser.mtaiId);
      } else {
        console.log('👤 Auth state changed: No user signed in');
        setUser(null);
      }
      // CRITICAL: Set loading to false AFTER user state is set
      // This ensures queries don't run until we know the auth state
      console.log('✅ Auth loading complete');
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
