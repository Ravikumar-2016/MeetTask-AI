
export interface User {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified?: boolean;
  // Human-readable ID (MTAI001, MTAI002, etc.)
  mtaiId?: string;
  // Track all auth methods used
  authProviders?: ('google' | 'password')[];
}

// Firestore user document (stored by email for deduplication)
export interface FirestoreUser {
  uid: string;
  mtaiId: string;              // MTAI001, MTAI002, etc.
  email: string;
  displayName: string;
  photoURL?: string | null;
  authProviders: ('google' | 'password')[];
  createdAt?: any;
  updatedAt?: any;
}

export type MeetingStatus = 'uploaded' | 'processing' | 'transcribing' | 'needs_mapping' | 'analyzing' | 'completed' | 'error';
export type FileType = 'image' | 'video' | 'audio';
export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskStatus = 'pending' | 'completed' | 'overdue';

// Speaker mapping: { "A": "MTAI001", "B": "MTAI002" }
export interface SpeakerMapping {
  [speakerId: string]: string; // speakerId → mtaiId
}

export interface Meeting {
  id: string;
  title: string;
  date: string;
  status: MeetingStatus;
  fileType?: FileType;
  fileUrl?: string;
  audioUrl?: string;
  videoUrl?: string;
  userId: string;
  taskCount?: number;
  errorMessage?: string;
  transcriptId?: string; // AssemblyAI transcript ID
  createdAt?: string;
  updatedAt?: string;
  // Speaker diarization fields
  speakerCount?: number;
  speakers?: string[];           // ["A", "B", "C"] - from diarization
  speakerMapping?: SpeakerMapping; // Manual mapping: A → email
  speakerMappingComplete?: boolean;
  summary?: string;
  duration?: number;
}

// Speaker diarization types
export interface SpeakerUtterance {
  speaker: string;       // "A", "B", "C", etc.
  text: string;
  start: number;         // milliseconds
  end: number;
  confidence: number;
}

export interface SpeakerMapping {
  [speakerId: string]: string;  // "A" -> "John" or "Speaker A"
}

export interface Transcript {
  meetingId: string;
  userId: string;
  text: string;
  formattedTranscript?: string;  // Transcript with real speaker names
  wordCount: number;
  summary?: string;
  confidence?: number;
  duration?: number;
  // Speaker diarization data
  utterances?: SpeakerUtterance[];
  speakerMapping?: SpeakerMapping;
  speakerCount?: number;
  speakers?: string[];
  // Multi-modal analysis
  videoAnalysisUsed?: boolean;
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
  // Speaker assignment fields
  assignedTo?: string;
  confidence?: number;        // 0.0 - 1.0 confidence in assignment
  sourceSentence?: string;    // Original quote from transcript
  completed?: boolean;
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
