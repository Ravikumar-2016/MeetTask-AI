
import axios from 'axios';

// Replace with your actual backend URL in production
const API_BASE_URL = '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

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
