/**
 * AuthContext.tsx - Authentication System for MeetTask AI (v2)
 * 
 * SIMPLIFIED ARCHITECTURE:
 * - Two roles: Manager and Employee
 * - Role selected during signup (required)
 * - Role stored in Firestore and included in user context
 * 
 * STORAGE:
 * - users/{mtaiId} → User documents with role
 * - counters/users → { lastId: number } for ID generation
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
import { User, FirestoreUser, AuthProvider as AuthProviderType, UserRole } from '../types';

// ============================================
// TYPES
// ============================================

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string, role: UserRole) => Promise<void>;
  googleLogin: (name: string, role: UserRole) => Promise<void>;
  logout: () => Promise<void>;
  sendVerificationEmail: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  isManager: boolean;
  isEmployee: boolean;
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
  refreshUser: async () => {},
  isManager: false,
  isEmployee: false
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
    'auth/network-request-failed': 'Network error. Please check your internet connection.',
  };

  return errorMessages[error.code] || error.message || 'An unexpected error occurred.';
};

// ============================================
// MTAI ID GENERATION
// ============================================

const generateMtaiId = async (): Promise<string> => {
  const counterRef = doc(db, 'counters', 'users');
  
  const newId = await runTransaction(db, async (transaction) => {
    const counterDoc = await transaction.get(counterRef);
    
    let nextNumber = 1;
    if (counterDoc.exists()) {
      nextNumber = (counterDoc.data().lastId || 0) + 1;
    }
    
    transaction.set(counterRef, { lastId: nextNumber });
    return `MTAI${nextNumber.toString().padStart(3, '0')}`;
  });
  
  console.log('✅ [Auth] Generated MTAI ID:', newId);
  return newId;
};

// ============================================
// USER LOOKUP
// ============================================

const findUserByEmail = async (email: string): Promise<{ mtaiId: string; data: FirestoreUser } | null> => {
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('email', '==', email));
    const snapshot = await getDocs(q);
    
    if (!snapshot.empty) {
      const docSnap = snapshot.docs[0];
      return {
        mtaiId: docSnap.id,
        data: docSnap.data() as FirestoreUser
      };
    }
    
    return null;
  } catch (error) {
    console.error('❌ [Auth] Error finding user:', error);
    return null;
  }
};

// ============================================
// AUTH PROVIDER COMPONENT
// ============================================

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Role helpers
  const isManager = user?.role === 'manager';
  const isEmployee = user?.role === 'employee';

  /**
   * Create user in Firestore (for signup)
   */
  const createUserInFirestore = useCallback(async (
    firebaseUser: FirebaseUser,
    provider: AuthProviderType,
    name: string,
    role: UserRole
  ): Promise<string> => {
    if (!firebaseUser.email) {
      throw new Error('Email is required');
    }

    const email = firebaseUser.email;
    console.log('📝 [Auth] Creating user:', email, 'role:', role);

    // Check if user already exists
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      throw new Error('An account with this email already exists. Please sign in.');
    }

    // Generate new MTAI ID
    const mtaiId = await generateMtaiId();
    
    const userData: FirestoreUser = {
      uid: firebaseUser.uid,
      mtaiId: mtaiId,
      name: name,
      email: email,
      role: role,
      authProviders: [provider],
      photoURL: firebaseUser.photoURL || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(db, 'users', mtaiId), userData);
    console.log('✅ [Auth] User created:', mtaiId, 'role:', role);
    
    return mtaiId;
  }, []);

  /**
   * Update existing user (for login)
   */
  const updateUserInFirestore = useCallback(async (
    firebaseUser: FirebaseUser,
    provider: AuthProviderType,
    existingUser: { mtaiId: string; data: FirestoreUser }
  ): Promise<void> => {
    const existingProviders = existingUser.data.authProviders || [];
    const updatedProviders = existingProviders.includes(provider)
      ? existingProviders
      : [...existingProviders, provider];

    await setDoc(doc(db, 'users', existingUser.mtaiId), {
      uid: firebaseUser.uid,
      authProviders: updatedProviders,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }, []);

  /**
   * Build User object from Firestore
   */
  const buildUserObject = useCallback(async (firebaseUser: FirebaseUser): Promise<User | null> => {
    if (!firebaseUser.email) return null;

    const existingUser = await findUserByEmail(firebaseUser.email);
    if (!existingUser) return null;

    return {
      uid: firebaseUser.uid,
      mtaiId: existingUser.mtaiId,
      email: firebaseUser.email,
      name: existingUser.data.name,
      displayName: existingUser.data.name,
      role: existingUser.data.role,
      photoURL: existingUser.data.photoURL || null,
      emailVerified: firebaseUser.emailVerified,
      authProviders: existingUser.data.authProviders
    };
  }, []);

  // ============================================
  // AUTH METHODS
  // ============================================

  /**
   * Email/Password Login (existing users only)
   */
  const login = useCallback(async (email: string, password: string) => {
    try {
      console.log('🔐 [Auth] Logging in:', email);
      
      // Check if user exists first
      const existingUser = await findUserByEmail(email);
      if (!existingUser) {
        throw new Error('No account found with this email. Please sign up first.');
      }
      
      const result = await signInWithEmailAndPassword(auth, email, password);
      await updateUserInFirestore(result.user, 'password', existingUser);
      
      const userObj = await buildUserObject(result.user);
      if (userObj) {
        setUser(userObj);
        console.log('✅ [Auth] Login successful:', userObj.mtaiId, 'role:', userObj.role);
      }
    } catch (error: any) {
      console.error('❌ [Auth] Login error:', error);
      if (error.code) {
        throw new Error(getAuthErrorMessage(error));
      }
      throw error;
    }
  }, [updateUserInFirestore, buildUserObject]);

  /**
   * Email/Password Signup (requires name and role)
   */
  const signup = useCallback(async (email: string, password: string, name: string, role: UserRole) => {
    try {
      console.log('📝 [Auth] Signing up:', email, 'as', role);
      
      // Check if user already exists
      const existingUser = await findUserByEmail(email);
      if (existingUser) {
        throw new Error('An account with this email already exists. Please sign in.');
      }
      
      const result = await createUserWithEmailAndPassword(auth, email, password);
      
      // Send verification email
      try {
        await sendEmailVerification(result.user);
      } catch (e) {
        console.warn('⚠️ Could not send verification email');
      }

      // Create Firestore document with role
      await createUserInFirestore(result.user, 'password', name, role);
      
      const userObj = await buildUserObject(result.user);
      if (userObj) {
        setUser(userObj);
        console.log('✅ [Auth] Signup complete:', userObj.mtaiId, 'role:', userObj.role);
      }
    } catch (error: any) {
      console.error('❌ [Auth] Signup error:', error);
      if (error.code) {
        throw new Error(getAuthErrorMessage(error));
      }
      throw error;
    }
  }, [createUserInFirestore, buildUserObject]);

  /**
   * Google Login/Signup (requires name and role for new users)
   */
  const googleLogin = useCallback(async (name: string, role: UserRole) => {
    try {
      console.log('🔵 [Auth] Google sign-in...');
      const result = await signInWithPopup(auth, googleProvider);
      
      const existingUser = await findUserByEmail(result.user.email!);
      
      if (existingUser) {
        // Existing user - just update
        await updateUserInFirestore(result.user, 'google', existingUser);
      } else {
        // New user - create with role
        const displayName = name || result.user.displayName || result.user.email!.split('@')[0];
        await createUserInFirestore(result.user, 'google', displayName, role);
      }
      
      const userObj = await buildUserObject(result.user);
      if (userObj) {
        setUser(userObj);
        console.log('✅ [Auth] Google sign-in complete:', userObj.mtaiId, 'role:', userObj.role);
      }
    } catch (error: any) {
      console.error('❌ [Auth] Google error:', error);
      if (error.code) {
        throw new Error(getAuthErrorMessage(error));
      }
      throw error;
    }
  }, [createUserInFirestore, updateUserInFirestore, buildUserObject]);

  /**
   * Sign out
   */
  const logout = useCallback(async () => {
    await firebaseSignOut(auth);
    setUser(null);
    console.log('👋 [Auth] Signed out');
  }, []);

  /**
   * Send verification email
   */
  const sendVerificationEmail = useCallback(async () => {
    if (!auth.currentUser) throw new Error('You must be signed in.');
    if (auth.currentUser.emailVerified) throw new Error('Email already verified.');
    await sendEmailVerification(auth.currentUser);
  }, []);

  /**
   * Send password reset
   */
  const sendPasswordReset = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  }, []);

  /**
   * Refresh user
   */
  const refreshUser = useCallback(async () => {
    if (auth.currentUser) {
      await auth.currentUser.reload();
      const userObj = await buildUserObject(auth.currentUser);
      setUser(userObj);
    }
  }, [buildUserObject]);

  // ============================================
  // AUTH STATE LISTENER
  // ============================================

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userObj = await buildUserObject(firebaseUser);
        setUser(userObj);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
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
    refreshUser,
    isManager,
    isEmployee
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
