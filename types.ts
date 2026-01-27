
export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified?: boolean;
}

export type MeetingStatus = 'uploaded' | 'processing' | 'completed' | 'error';
export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskStatus = 'pending' | 'completed' | 'overdue';

export interface Meeting {
  id: string;
  title: string;
  date: string;
  status: MeetingStatus;
  transcript?: string;
  videoUrl?: string;
  audioUrl?: string;
  userId: string;
}

export interface Task {
  id: string;
  meetingId: string;
  title: string;
  description: string;
  owner: string;
  deadline: string;
  priority: TaskPriority;
  status: TaskStatus;
}

export interface DashboardStats {
  totalMeetings: number;
  pendingTasks: number;
  completedTasks: number;
  overdueTasks: number;
}
