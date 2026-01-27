
import axios from 'axios';
import { auth } from '../lib/firebase';

// API base URL - uses Vercel serverless functions
const API_BASE_URL = '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Get Firebase ID token for authenticated requests
 */
async function getAuthToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('User not authenticated');
  }
  return user.getIdToken();
}

/**
 * Trigger AI processing for a meeting via the Orchestrator
 * 
 * This calls the orchestrator endpoint which:
 * 1. Updates status to "processing"
 * 2. Triggers the worker in background
 * 3. Returns immediately (non-blocking)
 * 
 * The UI updates automatically via Firestore real-time listeners.
 * 
 * @param meetingId - The Firestore document ID of the meeting
 * @returns Promise with processing initiation result
 */
export const processMeeting = async (meetingId: string): Promise<{ success: boolean; message?: string; error?: string }> => {
  try {
    const token = await getAuthToken();
    
    // Call orchestrator - now processes directly (may take up to 5 min for long videos)
    const response = await api.post('/orchestrator', 
      { meetingId },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        timeout: 300000, // 5 minutes for full AI processing
      }
    );
    
    console.log('[API] Orchestrator response:', response.data);
    return response.data;
  } catch (error: any) {
    console.error('[API] Orchestrator error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error || error.message || 'Failed to start processing',
    };
  }
};

export const uploadMeeting = async (file: File, title: string, onProgress?: (p: number) => void) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('title', title);

  return api.post('/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onProgress(percentCompleted);
      }
    },
  });
};

export const fetchMeetings = async () => {
  const response = await api.get('/meetings');
  return response.data;
};

export const fetchMeetingDetails = async (id: string) => {
  const response = await api.get(`/meetings/${id}`);
  return response.data;
};

export const updateTaskStatus = async (taskId: string, status: string) => {
  const response = await api.patch(`/tasks/${taskId}`, { status });
  return response.data;
};

export default api;
