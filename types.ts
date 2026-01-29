/**
 * types.ts - Core type definitions for MeetTask AI
 * 
 * SIMPLIFIED ARCHITECTURE (v2):
 * - Two roles: Manager and Employee
 * - Manager: Creates meetings, uploads, assigns tasks manually
 * - Employee: Views tasks, submits work, views transcripts
 * - NO AI task extraction - manual task creation only
 * - AssemblyAI for transcription only
 */

// ============================================
// USER TYPES
// ============================================

/**
 * User roles - strictly enforced
 */
export type UserRole = 'manager' | 'employee';

/**
 * Auth provider types
 */
export type AuthProvider = 'google' | 'password';

/**
 * Firestore user document (stored at users/{mtaiId})
 * This is the source of truth for user data
 */
export interface FirestoreUser {
  uid: string;                     // Firebase Auth UID (for auth verification)
  mtaiId: string;                  // Human-readable ID: MTAI001, MTAI002, etc.
  name?: string;                   // User's full name
  displayName?: string;            // Alias for backward compatibility
  email: string;                   // Email address (unique, used for deduplication)
  role?: UserRole;                 // 'manager' or 'employee'
  authProviders?: AuthProvider[];  // ['google'], ['password'], or ['google', 'password']
  photoURL?: string | null;        // Profile photo URL
  createdAt?: any;                 // Firestore Timestamp
  updatedAt?: any;                 // Firestore Timestamp
}

/**
 * Frontend user object (used in React components)
 * Mapped from FirestoreUser + Firebase Auth state
 */
export interface User {
  uid: string;
  mtaiId: string;
  email: string;
  name: string;
  displayName: string;            // Alias for name (backward compatibility)
  role: UserRole;
  photoURL: string | null;
  emailVerified: boolean;
  authProviders: AuthProvider[];
}

// ============================================
// MEETING TYPES
// ============================================

export type MeetingStatus = 'uploaded' | 'processing' | 'transcribing' | 'needs_mapping' | 'completed' | 'error';
export type FileType = 'video' | 'audio';

/**
 * Speaker mapping: { "A": "MTAI001", "B": "MTAI002" }
 * Maps diarization speaker labels to employee MTAI IDs
 */
export interface SpeakerMapping {
  [speakerId: string]: string; // speakerId → mtaiId (employees only)
}

/**
 * Meeting participant (employee)
 */
export interface MeetingParticipant {
  mtaiId: string;
  name: string;
  email: string;
  speakerId: string;              // A, B, C, etc.
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
  
  // Owner (Manager who created)
  userId: string;                  // Manager's Firebase UID
  creatorMtaiId?: string;          // Manager's MTAI ID
  creatorName?: string;            // Manager's name
  
  // Participants (Employees)
  participants?: MeetingParticipant[];
  
  // Transcription
  transcriptId?: string;           // AssemblyAI transcript ID
  duration?: number;
  
  // Speaker diarization
  speakerCount?: number;
  speakers?: string[];             // ["A", "B", "C"] - from diarization
  speakerMapping?: SpeakerMapping; // Manual mapping: A → MTAI001
  speakerMappingComplete?: boolean;
  
  // Metadata
  taskCount?: number;              // Manual task count
  errorMessage?: string;
  createdAt?: any;
  updatedAt?: any;
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
  formattedTranscript?: string;    // Transcript with speaker labels
  wordCount?: number;
  confidence?: number;
  duration?: number;
  
  // Speaker diarization data
  utterances?: SpeakerUtterance[];
  speakerMapping?: SpeakerMapping;
  speakerCount?: number;
  speakers?: string[];
  
  createdAt?: any;
  updatedAt?: any;
}

// ============================================
// TASK TYPES (Manual Creation by Manager)
// ============================================

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type TaskPriorityExtended = TaskPriority;  // Alias for backward compatibility
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';
export type TaskStatusExtended = TaskStatus;       // Alias for backward compatibility

/**
 * Task submission by employee
 */
export interface TaskSubmission {
  id: string;
  taskId: string;
  submittedBy: string;             // Employee MTAI ID
  submittedByName: string;
  type: 'text' | 'file' | 'status_change';
  content?: string;                // Text response
  fileUrl?: string;                // Cloudinary URL
  fileName?: string;
  fileType?: string;               // mime type
  previousStatus?: TaskStatus;
  newStatus?: TaskStatus;
  createdAt?: any;
}

/**
 * Task - manually created by manager
 */
export interface Task {
  id: string;                      // Firestore document ID
  taskId: string;                  // Sequential ID like TASK001, TASK002
  meetingId: string;
  meetingTitle?: string;
  
  // Creator (Manager) - optional for queries that don't need it
  creatorId?: string;              // Manager's Firebase UID
  creatorMtaiId?: string;          // Manager's MTAI ID
  creatorName?: string;            // Manager's name
  
  // Assignee (Employee)
  assignedTo: string;              // Employee's MTAI ID
  assignedToName?: string;         // Employee's name
  assignedToEmail?: string;        // Employee's email
  
  // Task details
  title: string;
  description?: string;
  requiresFile: boolean;           // Whether file upload is required (text response always required)
  priority: TaskPriority;
  status: TaskStatus;
  dueDate?: string | null;         // YYYY-MM-DD format
  
  // Employee Submission
  submissionText?: string | null;
  submissionFileUrl?: string | null;
  submissionFileName?: string | null;
  submittedAt?: any;
  
  // Timestamps
  createdAt?: any;
  updatedAt?: any;
  completedAt?: any;
}

// ============================================
// TASK FILE TYPES (Cloudinary Storage)
// ============================================

/**
 * Allowed file extensions for task uploads
 */
export const ALLOWED_FILE_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'zip', 'txt'] as const;
export type AllowedFileExtension = typeof ALLOWED_FILE_EXTENSIONS[number];

/**
 * Max file size in bytes (20MB)
 */
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * Task file metadata - stored in taskFiles collection
 */
export interface TaskFile {
  id: string;                      // Firestore document ID
  fileId: string;                  // Unique file ID (Cloudinary public_id)
  taskId: string;                  // Reference to task
  meetingId: string;               // Reference to meeting
  uploaderId: string;              // Firebase UID of uploader
  uploaderMtaiId: string;          // MTAI ID of uploader
  uploaderName: string;            // Name of uploader
  fileName: string;                // Original file name
  fileExtension: string;           // File extension (pdf, docx, etc.)
  fileType: string;                // MIME type
  fileSize: number;                // File size in bytes
  fileUrl: string;                 // Cloudinary secure URL
  cloudinaryPublicId: string;      // For potential deletion
  folder: string;                  // Cloudinary folder path
  uploadedAt: any;                 // Firestore Timestamp
}

/**
 * Cloudinary upload signature response
 */
export interface CloudinarySignResponse {
  success: boolean;
  signature: string;
  timestamp: number;
  cloudName: string;
  apiKey: string;
  folder: string;
  publicId: string;
  allowedFormats: string[];
  maxFileSize: number;
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface CreateMeetingResponse {
  success: boolean;
  meeting: Meeting;
}

export interface CreateTaskResponse {
  success: boolean;
  task: Task;
}

// ============================================
// DASHBOARD TYPES
// ============================================

export interface ManagerDashboardStats {
  totalMeetings: number;
  completedMeetings: number;
  totalTasks: number;
  pendingTasks: number;
  completedTasks: number;
}

export interface EmployeeDashboardStats {
  assignedTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  meetingsParticipated: number;
}
