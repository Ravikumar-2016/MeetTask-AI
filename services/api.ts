
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
 * Process a meeting through the AI pipeline
 * 
 * This triggers:
 * 1. Transcription with Gemini (for audio/video)
 * 2. Extraction with OpenAI (summary + tasks)
 * 3. Saves results to Firestore
 * 
 * @param meetingId - The Firestore document ID of the meeting
 * @returns Promise with processing result
 */
export const processMeeting = async (meetingId: string): Promise<{ success: boolean; message?: string; error?: string }> => {
  try {
    const token = await getAuthToken();
    
    const response = await api.post('/process-meeting', 
      { meetingId },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        timeout: 120000, // 2 minute timeout for long transcriptions
      }
    );
    
    return response.data;
  } catch (error: any) {
    console.error('[API] Process meeting error:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error || error.message || 'Processing failed',
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
