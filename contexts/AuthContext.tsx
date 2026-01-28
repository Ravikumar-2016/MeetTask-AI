/**
 * AuthContext.tsx - Authentication System for MeetTask AI
 * 
 * ARCHITECTURE:
 * - Firebase Auth = Authentication only (Google, Email/Password)
 * - Firestore = User database
 * 
 * STORAGE:
 * - users/{mtaiId}     → User documents (MTAI001, MTAI002, etc.)
 * - counters/users     → { lastId: number } for ID generation
 * 
 * FEATURES:
 * - Human-readable MTAI IDs (MTAI001, MTAI002, etc.)
 * - Email deduplication (same email = same user)
 * - Provider merging (Google + Password = same user)
 * - Email verification for password signups
 * - Password reset
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
import { 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  query, 
  where, 
  getDocs, 
  runTransaction, 
  serverTimestamp 
} from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase';
import { User, FirestoreUser, AuthProvider as AuthProviderType } from '../types';

// ============================================
// TYPES
// ============================================

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  googleLogin: () => Promise<void>;
  logout: () => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  refreshUser: () => Promise<void>;
}

// ============================================
// CONTEXT
// ============================================

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

// ============================================
// ERROR HANDLING
// ============================================

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
  };

  return errorMessages[error.code] || error.message || 'An unexpected error occurred. Please try again.';
};

// ============================================
// MTAI ID GENERATION
// ============================================

/**
 * Generate next sequential MTAI ID
 * Uses Firestore transaction to ensure uniqueness
 * Counter stored at: counters/users → { lastId: number }
 */
const generateMtaiId = async (): Promise<string> => {
  const counterRef = doc(db, 'counters', 'users');
  
  try {
    const newId = await runTransaction(db, async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      
      let nextNumber = 1;
      if (counterDoc.exists()) {
        nextNumber = (counterDoc.data().lastId || 0) + 1;
      }
      
      // Update counter
      transaction.set(counterRef, { lastId: nextNumber });
      
      // Format: MTAI001, MTAI002, etc.
      return `MTAI${nextNumber.toString().padStart(3, '0')}`;
    });
    
    console.log('✅ [Auth] Generated MTAI ID:', newId);
    return newId;
  } catch (error) {
    console.error('❌ [Auth] Counter transaction failed:', error);
    throw new Error('Failed to generate user ID. Please try again.');
  }
};

// ============================================
// USER LOOKUP
// ============================================

/**
 * Find existing user by email (for deduplication)
 * Queries users collection where email matches
 */
const findUserByEmail = async (email: string): Promise<{ mtaiId: string; data: FirestoreUser } | null> => {
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', email));
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
      const doc = snapshot.docs[0];
      return {
        mtaiId: doc.id,
        data: doc.data() as FirestoreUser
      };
    }
    
    return null;
  } catch (error) {
    console.error('❌ [Auth] Error finding user by email:', error);
    return null;
  }
};

/**
 * Get user by MTAI ID
 */
const getUserByMtaiId = async (mtaiId: string): Promise<FirestoreUser | null> => {
  try {
    const userRef = doc(db, 'users', mtaiId);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      return userSnap.data() as FirestoreUser;
    }
    
    return null;
  } catch (error) {
    console.error('❌ [Auth] Error getting user by MTAI ID:', error);
    return null;
  }
};

// ============================================
// AUTH PROVIDER COMPONENT
// ============================================

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * Create or update user in Firestore
   * 
   * LOGIC:
   * 1. Check if user exists by email (deduplication)
   * 2. If exists: merge auth providers, update UID
   * 3. If new: generate MTAI ID, create document at users/{mtaiId}
   */
  const saveUserToFirestore = useCallback(async (
    firebaseUser: FirebaseUser,
    provider: AuthProviderType
  ): Promise<string> => {
    if (!firebaseUser.email) {
      throw new Error('Email is required for account creation');
    }

    const email = firebaseUser.email;
    console.log('📝 [Auth] Saving user to Firestore:', email, 'provider:', provider);

    // Check if user already exists by email
    const existingUser = await findUserByEmail(email);

    if (existingUser) {
      // EXISTING USER - merge auth providers
      console.log('👤 [Auth] Existing user found:', existingUser.mtaiId);
      
      const existingProviders = existingUser.data.authProviders || [];
      const updatedProviders = existingProviders.includes(provider)
        ? existingProviders
        : [...existingProviders, provider];

      // Update existing document
      const userRef = doc(db, 'users', existingUser.mtaiId);
      await setDoc(userRef, {
        uid: firebaseUser.uid,  // Update to latest UID
        displayName: firebaseUser.displayName || existingUser.data.displayName,
        photoURL: firebaseUser.photoURL || existingUser.data.photoURL,
        authProviders: updatedProviders,
        updatedAt: serverTimestamp()
      }, { merge: true });

      console.log('✅ [Auth] User updated, providers:', updatedProviders);
      return existingUser.mtaiId;
    } else {
      // NEW USER - generate MTAI ID and create document
      console.log('🆕 [Auth] Creating new user...');
      
      const mtaiId = await generateMtaiId();
      
      const userData: FirestoreUser = {
        uid: firebaseUser.uid,
        mtaiId: mtaiId,
        email: email,
        displayName: firebaseUser.displayName || email.split('@')[0],
        photoURL: firebaseUser.photoURL || null,
        authProviders: [provider],
        createdAt: serverTimestamp()
      };

      // Create document at users/{mtaiId}
      const userRef = doc(db, 'users', mtaiId);
      await setDoc(userRef, userData);

      console.log('✅ [Auth] New user created:', mtaiId);
      return mtaiId;
    }
  }, []);

  /**
   * Build User object from Firebase Auth + Firestore
   */
  const buildUserObject = useCallback(async (firebaseUser: FirebaseUser): Promise<User | null> => {
    if (!firebaseUser.email) {
      console.warn('⚠️ [Auth] User has no email');
      return null;
    }

    // Find user in Firestore
    const existingUser = await findUserByEmail(firebaseUser.email);
    
    if (!existingUser) {
      console.warn('⚠️ [Auth] User not found in Firestore');
      return null;
    }

    return {
      uid: firebaseUser.uid,
      mtaiId: existingUser.mtaiId,
      email: firebaseUser.email,
      displayName: existingUser.data.displayName || firebaseUser.email.split('@')[0],
      photoURL: existingUser.data.photoURL || null,
      emailVerified: firebaseUser.emailVerified,
      authProviders: existingUser.data.authProviders
    };
  }, []);

  // ============================================
  // AUTH METHODS
  // ============================================

  /**
   * Email/Password Login
   */
  const login = useCallback(async (email: string, password: string) => {
    try {
      console.log('🔐 [Auth] Logging in:', email);
      const result = await signInWithEmailAndPassword(auth, email, password);
      
      // Save to Firestore and get MTAI ID
      const mtaiId = await saveUserToFirestore(result.user, 'password');
      
      // Immediately set user state (don't wait for onAuthStateChanged)
      const userObj = await buildUserObject(result.user);
      if (userObj) {
        setUser(userObj);
        console.log('✅ [Auth] Login successful, user set:', userObj.mtaiId);
      }
    } catch (error: any) {
      console.error('❌ [Auth] Login error:', error.code);
      throw new Error(getAuthErrorMessage(error));
    }
  }, [saveUserToFirestore, buildUserObject]);

  /**
   * Email/Password Signup
   */
  const signup = useCallback(async (email: string, password: string) => {
    try {
      console.log('📝 [Auth] Creating account:', email);
      
      // Create Firebase Auth account
      const result = await createUserWithEmailAndPassword(auth, email, password);
      console.log('✅ [Auth] Firebase account created');

      // Send verification email
      try {
        await sendEmailVerification(result.user);
        console.log('📧 [Auth] Verification email sent');
      } catch (emailError: any) {
        console.warn('⚠️ [Auth] Could not send verification email:', emailError.message);
      }

      // Create Firestore user document
      const mtaiId = await saveUserToFirestore(result.user, 'password');
      
      // Immediately set user state
      const userObj = await buildUserObject(result.user);
      if (userObj) {
        setUser(userObj);
        console.log('✅ [Auth] Signup complete, user set:', userObj.mtaiId);
      }
    } catch (error: any) {
      console.error('❌ [Auth] Signup error:', error.code);
      throw new Error(getAuthErrorMessage(error));
    }
  }, [saveUserToFirestore, buildUserObject]);

  /**
   * Google OAuth Login
   */
  const googleLogin = useCallback(async () => {
    try {
      console.log('🔵 [Auth] Starting Google sign-in...');
      const result = await signInWithPopup(auth, googleProvider);
      
      // Create/update Firestore user document
      const mtaiId = await saveUserToFirestore(result.user, 'google');
      
      // Immediately set user state
      const userObj = await buildUserObject(result.user);
      if (userObj) {
        setUser(userObj);
        console.log('✅ [Auth] Google sign-in successful, user set:', userObj.mtaiId);
      }
    } catch (error: any) {
      console.error('❌ [Auth] Google sign-in error:', error.code);
      throw new Error(getAuthErrorMessage(error));
    }
  }, [saveUserToFirestore, buildUserObject]);

  /**
   * Sign out
   */
  const logout = useCallback(async () => {
    try {
      await firebaseSignOut(auth);
      console.log('👋 [Auth] Signed out');
    } catch (error: any) {
      console.error('❌ [Auth] Sign out error:', error.code);
      throw new Error('Failed to sign out. Please try again.');
    }
  }, []);

  /**
   * Send verification email
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
      console.log('📧 [Auth] Verification email sent');
    } catch (error: any) {
      console.error('❌ [Auth] Verification email error:', error.code);
      throw new Error(getAuthErrorMessage(error));
    }
  }, []);

  /**
   * Send password reset email
   */
  const sendPasswordReset = useCallback(async (email: string) => {
    try {
      console.log('🔑 [Auth] Sending password reset email:', email);
      await sendPasswordResetEmail(auth, email);
      console.log('📧 [Auth] Password reset email sent');
    } catch (error: any) {
      console.error('❌ [Auth] Password reset error:', error.code);
      throw new Error(getAuthErrorMessage(error));
    }
  }, []);

  /**
   * Refresh user data
   */
  const refreshUser = useCallback(async () => {
    if (auth.currentUser) {
      await auth.currentUser.reload();
      const userObj = await buildUserObject(auth.currentUser);
      setUser(userObj);
      console.log('🔄 [Auth] User refreshed');
    }
  }, [buildUserObject]);

  // ============================================
  // AUTH STATE LISTENER
  // ============================================

  useEffect(() => {
    console.log('🔍 [Auth] Setting up auth listener...');
    
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        console.log('👤 [Auth] User signed in:', firebaseUser.email);
        
        // Build user object from Firestore
        const userObj = await buildUserObject(firebaseUser);
        
        if (userObj) {
          setUser(userObj);
          console.log('✅ [Auth] User loaded:', userObj.mtaiId);
        } else {
          // User exists in Firebase but not Firestore - this shouldn't happen
          // but handle it gracefully by setting null
          console.warn('⚠️ [Auth] User not in Firestore');
          setUser(null);
        }
      } else {
        console.log('👤 [Auth] No user signed in');
        setUser(null);
      }
      
      setLoading(false);
      console.log('✅ [Auth] Auth loading complete');
    });

    return () => {
      console.log('🧹 [Auth] Cleaning up auth listener');
      unsubscribe();
    };
  }, [buildUserObject]);

  // ============================================
  // CONTEXT VALUE
  // ============================================

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
