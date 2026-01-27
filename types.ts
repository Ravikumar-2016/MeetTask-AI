
export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified?: boolean;
}

export type MeetingStatus = 'uploaded' | 'processing' | 'completed' | 'error';
export type FileType = 'image' | 'video' | 'audio';
export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskStatus = 'pending' | 'completed' | 'overdue';

export interface Meeting {
  id: string;
  title: string;
  date: string;
  status: MeetingStatus;
  fileType?: FileType; // NEW: track if image, video, or audio
  audioUrl?: string;
  videoUrl?: string;
  userId: string;
  taskCount?: number;
  errorMessage?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Transcript {
  meetingId: string;
  userId: string;
  text: string;
  wordCount: number;
  createdAt?: string;
}

export interface Task {
  id: string;
  meetingId: string;
  userId: string;
  title: string;
  description: string;
  owner: string;
  deadline: string;
  priority: TaskPriority;
  status: TaskStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface DashboardStats {
  totalMeetings: number;
  pendingTasks: number;
  completedTasks: number;
  overdueTasks: number;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  details?: string;
}

export interface CreateMeetingResponse {
  success: boolean;
  meeting: Meeting;
}

export interface TranscribeResponse {
  success: boolean;
  meetingId: string;
  transcript: string;
  wordCount: number;
}

export interface ExtractTasksResponse {
  success: boolean;
  meetingId: string;
  taskCount: number;
  tasks: Task[];
}
