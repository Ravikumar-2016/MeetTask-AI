/**
 * AuthContext.tsx - Authentication System for MeetTask AI (v2)
 * 
 * ARCHITECTURE (IMPORTANT):
 * 
 * Firebase Auth is the SOURCE OF TRUTH for credentials (email/password).
 * Firestore is ONLY for profile data (name, role, mtaiId, etc.).
 * 
 * LOGIN FLOW:
 * 1. Firebase Auth validates credentials FIRST (signInWithEmailAndPassword)
 * 2. Only after successful auth, fetch profile from Firestore
 * 3. If Firestore profile missing, auto-create it (sync fix)
 * 4. Never block login based on Firestore - Auth is primary
 * 
 * SIGNUP FLOW:
 * 1. Create user in Firebase Auth FIRST
 * 2. Then create Firestore document with uid from Auth
 * 3. uid is the link between Auth and Firestore
 * 
 * PASSWORD RESET:
 * - Uses Firebase Auth directly (sendPasswordResetEmail)
 * - No Firestore dependency needed
 * 
 * STORAGE:
 * - users/{mtaiId} → User documents with role, name, etc.
 * - counters/users → { lastId: number } for MTAI ID generation
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
  completeGoogleSignup: (name: string, role: UserRole) => Promise<void>;
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
  completeGoogleSignup: async () => {},
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
   * Auto-create Firestore profile for existing Firebase Auth users
   * This handles the case where a user exists in Firebase Auth but not in Firestore
   * (sync fix for users created before proper flow was implemented)
   */
  const autoCreateFirestoreProfile = useCallback(async (
    firebaseUser: FirebaseUser,
    provider: AuthProviderType
  ): Promise<string> => {
    if (!firebaseUser.email) {
      throw new Error('Email is required');
    }

    const email = firebaseUser.email;
    console.log('🔄 [Auth] Auto-creating Firestore profile for:', email);

    // Generate new MTAI ID
    const mtaiId = await generateMtaiId();
    
    // Default role to 'employee' for auto-synced users
    // They can contact admin to change role if needed
    const userData: FirestoreUser = {
      uid: firebaseUser.uid,
      mtaiId: mtaiId,
      name: firebaseUser.displayName || email.split('@')[0],
      email: email,
      role: 'employee' as UserRole, // Default role for auto-synced users
      authProviders: [provider],
      photoURL: firebaseUser.photoURL || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(db, 'users', mtaiId), userData);
    console.log('✅ [Auth] Auto-created profile:', mtaiId, '(default role: employee)');
    
    return mtaiId;
  }, []);

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
   * Email/Password Login
   * 
   * CORRECT FLOW:
   * 1. Try Firebase Auth FIRST (source of truth for credentials)
   * 2. If auth succeeds, fetch Firestore profile
   * 3. If Firestore profile missing, auto-create it (sync fix)
   * 4. Only show "no account" error if Firebase Auth returns auth/user-not-found
   */
  const login = useCallback(async (email: string, password: string) => {
    try {
      console.log('🔐 [Auth] Logging in:', email);
      
      // Step 1: Try Firebase Auth FIRST - this is the source of truth for credentials
      const result = await signInWithEmailAndPassword(auth, email, password);
      console.log('✅ [Auth] Firebase Auth successful for:', email);
      
      // Step 2: Fetch Firestore profile
      let existingUser = await findUserByEmail(email);
      
      // Step 3: If Firestore profile is missing, auto-create it (sync fix)
      if (!existingUser) {
        console.log('⚠️ [Auth] Firestore profile missing, auto-creating...');
        await autoCreateFirestoreProfile(result.user, 'password');
        existingUser = await findUserByEmail(email);
      } else {
        // Update existing user's auth info
        await updateUserInFirestore(result.user, 'password', existingUser);
      }
      
      // Step 4: Build and set user object
      const userObj = await buildUserObject(result.user);
      if (userObj) {
        setUser(userObj);
        console.log('✅ [Auth] Login complete:', userObj.mtaiId, 'role:', userObj.role);
      }
    } catch (error: any) {
      console.error('❌ [Auth] Login error:', error);
      // Firebase Auth errors have .code property - use proper error messages
      if (error.code) {
        throw new Error(getAuthErrorMessage(error));
      }
      throw error;
    }
  }, [autoCreateFirestoreProfile, updateUserInFirestore, buildUserObject]);

  /**
   * Email/Password Signup (requires name and role)
   * 
   * CORRECT FLOW:
   * 1. Create user in Firebase Auth FIRST (source of truth for credentials)
   * 2. Then create Firestore document using uid from Auth
   * 3. uid is the primary link between Auth and Firestore
   */
  const signup = useCallback(async (email: string, password: string, name: string, role: UserRole) => {
    try {
      console.log('📝 [Auth] Signing up:', email, 'as', role);
      
      // Step 1: Create user in Firebase Auth FIRST
      // Firebase Auth will throw auth/email-already-in-use if account exists
      const result = await createUserWithEmailAndPassword(auth, email, password);
      console.log('✅ [Auth] Firebase Auth account created for:', email);
      
      // Step 2: Send verification email (non-blocking)
      try {
        await sendEmailVerification(result.user);
        console.log('📧 [Auth] Verification email sent');
      } catch (e) {
        console.warn('⚠️ Could not send verification email');
      }

      // Step 3: Create Firestore document with role (using uid from Auth)
      await createUserInFirestore(result.user, 'password', name, role);
      
      // Step 4: Build and set user object
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
   * Complete Google Signup for new users (after role selection)
   * This re-authenticates with Google and creates the Firestore document
   */
  const completeGoogleSignup = useCallback(async (name: string, role: UserRole) => {
    try {
      console.log('🔵 [Auth] Completing Google signup with role:', role);
      
      // Re-authenticate with Google (user already selected account before)
      const result = await signInWithPopup(auth, googleProvider);
      
      // Check if somehow already exists (edge case)
      const existingUser = await findUserByEmail(result.user.email!);
      
      if (existingUser) {
        // Just update and proceed
        await updateUserInFirestore(result.user, 'google', existingUser);
      } else {
        // Create new user with the selected role
        const displayName = name || result.user.displayName || result.user.email!.split('@')[0];
        await createUserInFirestore(result.user, 'google', displayName, role);
      }
      
      const userObj = await buildUserObject(result.user);
      if (userObj) {
        setUser(userObj);
        console.log('✅ [Auth] Google signup complete:', userObj.mtaiId, 'role:', userObj.role);
      }
    } catch (error: any) {
      console.error('❌ [Auth] Complete Google signup error:', error);
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
   * Uses Firebase Auth directly - no Firestore dependency needed
   * Firebase will return auth/user-not-found if email doesn't exist
   */
  const sendPasswordReset = useCallback(async (email: string) => {
    try {
      console.log('📧 [Auth] Sending password reset to:', email);
      await sendPasswordResetEmail(auth, email);
      console.log('✅ [Auth] Password reset email sent');
    } catch (error: any) {
      console.error('❌ [Auth] Password reset error:', error);
      if (error.code) {
        throw new Error(getAuthErrorMessage(error));
      }
      throw error;
    }
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
        console.log('🔄 [Auth] Auth state changed - user:', firebaseUser.email);
        
        // Try to build user object from Firestore
        let userObj = await buildUserObject(firebaseUser);
        
        // If Firestore profile is missing but Firebase Auth user exists,
        // auto-create the profile (sync fix for edge cases)
        if (!userObj && firebaseUser.email) {
          console.log('⚠️ [Auth] Firestore profile missing for authenticated user, auto-creating...');
          try {
            // Determine provider from Firebase user
            const hasGoogleProvider = firebaseUser.providerData.some(p => p.providerId === 'google.com');
            const provider: AuthProviderType = hasGoogleProvider ? 'google' : 'password';
            await autoCreateFirestoreProfile(firebaseUser, provider);
            userObj = await buildUserObject(firebaseUser);
          } catch (syncError) {
            console.error('❌ [Auth] Failed to auto-create profile:', syncError);
          }
        }
        
        setUser(userObj);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [buildUserObject, autoCreateFirestoreProfile]);

  // ============================================
  // CONTEXT VALUE
  // ============================================

  const value: AuthContextType = {
    user,
    loading,
    login,
    signup,
    googleLogin,
    completeGoogleSignup,
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
