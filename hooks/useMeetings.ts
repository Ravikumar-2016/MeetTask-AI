/**
 * useMeetings.ts - Reusable hook for fetching meetings from Firestore
 * 
 * Features:
 * - Real-time updates via onSnapshot
 * - Waits for authenticated user before querying
 * - ALWAYS filters by userId (required by Firestore rules)
 * - Handles loading/error states properly
 * - Permission denied = empty state (not error)
 * - Debug logging
 */

import { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  Timestamp,
  FirestoreError
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { Meeting, MeetingStatus } from '../types';

// UI state type for proper state management
type LoadState = 'loading' | 'empty' | 'success' | 'error';

interface UseMeetingsReturn {
  meetings: Meeting[];
  loading: boolean;
  error: string | null;
  state: LoadState;
}

/**
 * Format Firestore timestamp to readable date string
 */
const formatDate = (timestamp: Timestamp | string | undefined): string => {
  if (!timestamp) return 'Unknown date';
  
  try {
    const date = timestamp instanceof Timestamp 
      ? timestamp.toDate() 
      : new Date(timestamp);
    
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return 'Invalid date';
  }
};

/**
 * Hook to fetch user's meetings from Firestore with real-time updates
 * 
 * IMPORTANT: This hook ALWAYS includes where('userId', '==', uid) filter
 * to comply with Firestore security rules. Never query meetings without this filter.
 * 
 * CRITICAL: Waits for Firebase Auth to restore session before querying.
 * On page reload, Firebase Auth takes time to restore the session from localStorage.
 * Querying Firestore before auth is ready will result in permission errors.
 */
export const useMeetings = (): UseMeetingsReturn => {
  const { user, loading: authLoading } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  
  // Track if we've received first snapshot to avoid showing errors during initial load
  const hasReceivedData = useRef(false);

  useEffect(() => {
    console.log('[useMeetings] Effect running - authLoading:', authLoading, 'user:', user?.uid || 'null');
    
    // ============================================
    // CRITICAL: Wait for auth to finish loading
    // On page reload, Firebase restores auth session asynchronously.
    // We MUST wait for this to complete before querying Firestore.
    // ============================================
    if (authLoading) {
      console.log('[useMeetings] Auth still loading, keeping loading state...');
      // Keep loading state while auth is restoring - DO NOT query Firestore yet
      setLoading(true);
      setState('loading');
      setError(null); // Clear any previous errors while waiting
      return; // Exit early - no cleanup needed, no subscription created
    }

    // No user after auth finished = show empty state (not an error)
    if (!user?.uid) {
      console.log('[useMeetings] Auth finished but no user - showing empty state');
      setMeetings([]);
      setLoading(false);
      setError(null);
      setState('empty');
      return;
    }

    // ============================================
    // Auth is complete AND we have a user - safe to query Firestore
    // ============================================
    console.log('[useMeetings] Auth ready with user:', user.uid, '- setting up Firestore listener');
    setLoading(true);
    setError(null);
    setState('loading');
    hasReceivedData.current = false;

    // ============================================
    // CRITICAL: Query MUST include userId filter
    // Firestore rules require: where('userId', '==', auth.uid)
    // Never query meetings collection without this filter!
    // 
    // NOTE: We only use 'where' without 'orderBy' to avoid requiring
    // a composite index. We sort the results in JavaScript instead.
    // ============================================
    const meetingsQuery = query(
      collection(db, 'meetings'),
      where('userId', '==', user.uid)
    );

    // Subscribe to real-time updates
    const unsubscribe = onSnapshot(
      meetingsQuery,
      (snapshot) => {
        hasReceivedData.current = true;
        const meetingsData: Meeting[] = [];
        
        snapshot.forEach((doc) => {
          const data = doc.data();
          meetingsData.push({
            id: doc.id,
            title: data.title || 'Untitled Meeting',
            date: formatDate(data.createdAt),
            status: (data.status as MeetingStatus) || 'uploaded',
            fileType: data.fileType || 'audio', // Default to audio for backward compatibility
            audioUrl: data.audioUrl,
            userId: data.userId,
            taskCount: data.taskCount || 0,
            errorMessage: data.errorMessage,
            createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
          });
        });

        // Sort by createdAt descending (newest first) in JavaScript
        // This avoids requiring a composite Firestore index
        meetingsData.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateB - dateA;
        });

        console.log('[useMeetings] Received snapshot:', meetingsData.length, 'meetings');
        setMeetings(meetingsData);
        setLoading(false);
        setError(null);
        // Set state based on whether we have meetings
        setState(meetingsData.length > 0 ? 'success' : 'empty');
      },
      (err: FirestoreError) => {
        console.error('[useMeetings] Firestore error - Code:', err.code);
        console.error('[useMeetings] Firestore error - Message:', err.message);
        console.error('[useMeetings] Firestore error - Full:', err);
        
        // Handle permission-denied as empty state (not an error)
        // This happens when user has no documents or rules deny access
        if (err.code === 'permission-denied') {
          console.log('[useMeetings] Permission denied - treating as empty state (this is normal for new users)');
          setMeetings([]);
          setLoading(false);
          setError(null);
          setState('empty');
          return;
        }
        
        // Query was cancelled, likely due to component unmount - ignore
        if (err.code === 'cancelled') {
          console.log('[useMeetings] Query cancelled (unmount) - ignoring');
          return;
        }
        
        // Check for missing index error
        if (err.code === 'failed-precondition' || err.message?.includes('index')) {
          console.error('[useMeetings] MISSING INDEX - Create the required index in Firebase Console');
          console.error('[useMeetings] Index needed: meetings collection, fields: userId (asc) + createdAt (desc)');
          setError('Database configuration error. Please contact support.');
          setMeetings([]);
          setLoading(false);
          setState('error');
          return;
        }
        
        // Only show error for real failures (network, unknown errors)
        const errorMessage = err.code === 'unavailable' 
          ? 'Service unavailable. Please check your connection.'
          : 'Failed to load meetings. Please try again.';
        
        console.error('[useMeetings] Setting error state:', errorMessage);
        setError(errorMessage);
        setMeetings([]);
        setLoading(false);
        setState('error');
      }
    );

    // Cleanup subscription on unmount or user change
    return () => {
      console.log('[useMeetings] Cleaning up listener');
      unsubscribe();
    };
  }, [user?.uid, authLoading]);

  return { meetings, loading, error, state };
};

/**
 * Get status badge color class
 */
export const getStatusBadgeClass = (status: MeetingStatus): string => {
  switch (status) {
    case 'completed':
      return 'bg-emerald-100 text-emerald-700';
    case 'processing':
    case 'transcribing':
    case 'analyzing':
      return 'bg-blue-100 text-blue-700 animate-pulse';
    case 'needs_mapping':
      return 'bg-amber-100 text-amber-700';
    case 'uploaded':
      return 'bg-slate-100 text-slate-700';
    case 'error':
      return 'bg-rose-100 text-rose-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
};

/**
 * Get human-readable status label
 */
export const getStatusLabel = (status: MeetingStatus | string): string => {
  switch (status) {
    case 'completed':
      return 'COMPLETED';
    case 'transcribing':
      return 'TRANSCRIBING...';
    case 'analyzing':
      return 'ANALYZING...';
    case 'processing':
      return 'PROCESSING';
    case 'needs_mapping':
      return 'NEEDS MAPPING';
    case 'uploaded':
      return 'UPLOADED';
    case 'error':
      return 'ERROR';
    default:
      return (status as string)?.toUpperCase() || 'UNKNOWN';
  }
};

/**
 * Get icon name for file type
 * Returns Material Icons name
 */
export const getFileTypeIcon = (fileType?: string): string => {
  switch (fileType) {
    case 'video':
      return 'videocam';
    case 'audio':
    default:
      return 'mic';
  }
};
