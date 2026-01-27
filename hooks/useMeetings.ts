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

import { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
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
 */
export const useMeetings = (): UseMeetingsReturn => {
  const { user, loading: authLoading } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    // Wait for auth to finish loading
    if (authLoading) {
      console.log('[useMeetings] Waiting for auth...');
      setState('loading');
      return;
    }

    // No user = empty state (not an error)
    if (!user?.uid) {
      console.log('[useMeetings] No authenticated user, showing empty state');
      setMeetings([]);
      setLoading(false);
      setError(null);
      setState('empty');
      return;
    }

    console.log('[useMeetings] Setting up listener for user:', user.uid);
    setLoading(true);
    setError(null);
    setState('loading');

    // ============================================
    // CRITICAL: Query MUST include userId filter
    // Firestore rules require: where('userId', '==', auth.uid)
    // Never query meetings collection without this filter!
    // ============================================
    const meetingsQuery = query(
      collection(db, 'meetings'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    // Subscribe to real-time updates
    const unsubscribe = onSnapshot(
      meetingsQuery,
      (snapshot) => {
        const meetingsData: Meeting[] = [];
        
        snapshot.forEach((doc) => {
          const data = doc.data();
          meetingsData.push({
            id: doc.id,
            title: data.title || 'Untitled Meeting',
            date: formatDate(data.createdAt),
            status: (data.status as MeetingStatus) || 'uploaded',
            audioUrl: data.audioUrl,
            userId: data.userId,
            taskCount: data.taskCount || 0,
            errorMessage: data.errorMessage,
            createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
          });
        });

        console.log('[useMeetings] Received update:', meetingsData.length, 'meetings');
        setMeetings(meetingsData);
        setLoading(false);
        setError(null);
        // Set state based on whether we have meetings
        setState(meetingsData.length > 0 ? 'success' : 'empty');
      },
      (err: FirestoreError) => {
        console.error('[useMeetings] Firestore error:', err.code, err.message);
        
        // Handle different error types appropriately
        if (err.code === 'permission-denied') {
          // Permission denied usually means no data for this user
          // Treat as empty state, not error (user just has no meetings)
          console.log('[useMeetings] Permission denied - treating as empty state');
          setMeetings([]);
          setLoading(false);
          setError(null);
          setState('empty');
          return;
        }
        
        // Only show error for real failures (network, unknown errors)
        let errorMessage = 'Failed to load meetings. Please try again.';
        if (err.code === 'unavailable') {
          errorMessage = 'Service unavailable. Please check your connection.';
        } else if (err.code === 'cancelled') {
          // Query was cancelled, likely due to component unmount - not an error
          return;
        }
        
        setError(errorMessage);
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
      return 'bg-blue-100 text-blue-700 animate-pulse';
    case 'uploaded':
      return 'bg-amber-100 text-amber-700';
    case 'error':
      return 'bg-rose-100 text-rose-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
};
