/**
 * types.ts - Core type definitions for MeetTask AI
 * 
 * USER SYSTEM:
 * - Firebase Auth = authentication only
 * - Firestore users/{mtaiId} = user database
 * - Human-readable IDs: MTAI001, MTAI002, etc.
 */

// ============================================
// USER TYPES
// ============================================

/**
 * Auth provider types
 */
export type AuthProvider = 'google' | 'password';

/**
 * Firestore user document (stored at users/{mtaiId})
 * This is the source of truth for user data
 */
export interface FirestoreUser {
  uid: string;                    // Firebase Auth UID (for auth verification)
  mtaiId: string;                 // Human-readable ID: MTAI001, MTAI002, etc.
  displayName: string;            // User's display name
  email: string;                  // Email address (unique, used for deduplication)
  authProviders: AuthProvider[];  // ['google'], ['password'], or ['google', 'password']
  photoURL?: string | null;       // Profile photo URL
  createdAt?: any;                // Firestore Timestamp (optional - set on creation)
  updatedAt?: any;                // Firestore Timestamp
}

/**
 * Frontend user object (used in React components)
 * Mapped from FirestoreUser + Firebase Auth state
 */
export interface User {
  uid: string;
  mtaiId: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  emailVerified: boolean;
  authProviders: AuthProvider[];
}

// ============================================
// MEETING TYPES
// ============================================

export type MeetingStatus = 'uploaded' | 'processing' | 'transcribing' | 'needs_mapping' | 'analyzing' | 'completed' | 'error';
export type FileType = 'video' | 'audio';
export type TaskPriority = 'high' | 'medium' | 'low';
export type TaskStatus = 'pending' | 'completed' | 'overdue';

/**
 * Speaker mapping: { "A": "MTAI001", "B": "MTAI002" }
 * Maps diarization speaker labels to MTAI IDs
 */
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
  userId: string;                  // Owner's Firebase UID
  ownerMtaiId?: string;            // Owner's MTAI ID
  taskCount?: number;
  errorMessage?: string;
  transcriptId?: string;           // AssemblyAI transcript ID
  createdAt?: string;
  updatedAt?: string;
  // Speaker diarization fields
  speakerCount?: number;
  speakers?: string[];             // ["A", "B", "C"] - from diarization
  speakerMapping?: SpeakerMapping; // Manual mapping: A → MTAI001
  speakerMappingComplete?: boolean;
  summary?: string;
  duration?: number;
}

// ============================================
// TRANSCRIPT TYPES
// ============================================

export interface SpeakerUtterance {
  speaker: string;       // "A", "B", "C", etc.
  text: string;
  start: number;         // milliseconds
  end: number;
  confidence: number;
}

export interface Transcript {
  meetingId: string;
  userId: string;
  text: string;
  formattedTranscript?: string;    // Transcript with real speaker names
  wordCount?: number;
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
  ocrSource?: boolean;             // True if from image OCR
  createdAt?: string;
}

// ============================================
// TASK TYPES
// ============================================

/**
 * Task priority levels - for sorting and visual indicators
 */
export type TaskPriorityExtended = 'critical' | 'high' | 'medium' | 'low';

/**
 * Task status for tracking progress
 */
export type TaskStatusExtended = 'pending' | 'in_progress' | 'completed' | 'blocked';

/**
 * Task update entry - for progress tracking
 */
export interface TaskUpdate {
  id: string;
  taskId: string;
  userId: string;              // Who made the update (MTAI ID)
  userName: string;
  type: 'status_change' | 'comment' | 'file_upload';
  content: string;             // Comment text or status change description
  previousStatus?: TaskStatusExtended;
  newStatus?: TaskStatusExtended;
  fileUrl?: string;            // For file uploads
  fileName?: string;
  createdAt?: string;
}

/**
 * Full Task interface for enterprise task tracking
 */
export interface Task {
  id: string;
  meetingId: string;
  meetingTitle?: string;       // Denormalized for easy display
  
  // Ownership
  creatorId: string;           // Meeting owner's Firebase UID
  creatorMtaiId?: string;      // Meeting owner's MTAI ID
  
  // Assignment
  assignedTo: string;          // Assigned user's MTAI ID
  assignedToName: string;      // Display name
  assignedToEmail: string;     // Email for notifications
  speakerId?: string;          // Speaker label from diarization (A, B, C)
  
  // Task details
  title: string;
  description: string;
  priority: TaskPriorityExtended;
  status: TaskStatusExtended;
  dueDate?: string;            // ISO date string
  
  // Progress tracking
  updates?: TaskUpdate[];      // Array of updates/comments
  lastUpdateAt?: string;
  
  // AI extraction metadata
  confidence?: number;         // 0.0 - 1.0 confidence in assignment
  sourceSentence?: string;     // Original quote from transcript
  
  // Notification tracking
  emailSent?: boolean;
  emailSentAt?: string;
  
  // Timestamps
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  
  // Legacy fields (for backward compatibility)
  userId?: string;             // Alias for creatorId
  owner?: string;              // Alias for assignedToName
  deadline?: string;           // Alias for dueDate
  completed?: boolean;         // Derived from status
}

// ============================================
// DASHBOARD TYPES
// ============================================

export interface DashboardStats {
  totalMeetings: number;
  pendingTasks: number;
  completedTasks: number;
  overdueTasks: number;
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
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
