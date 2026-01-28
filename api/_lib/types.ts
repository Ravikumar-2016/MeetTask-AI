/**
 * Shared types for API services
 */

// ============================================
// SPEAKER TYPES
// ============================================

export interface SpeakerUtterance {
  speaker: string;       // "A", "B", "C", or real name after mapping
  text: string;
  start: number;         // milliseconds
  end: number;
  confidence: number;
}

export interface SpeakerMapping {
  [speakerId: string]: string;  // "A" -> "Eric Johnson" or "Speaker A"
}

// ============================================
// TRANSCRIPTION TYPES
// ============================================

export interface TranscriptionResult {
  text: string;
  confidence: number;
  duration: number;
  transcriptId: string;
  utterances: SpeakerUtterance[];
  speakerMapping: SpeakerMapping;
}

// ============================================
// TASK TYPES
// ============================================

export interface ExtractedTask {
  title: string;
  description: string;
  assignedTo: string;
  dueDate: string;
  priority: 'high' | 'medium' | 'low';
  confidence?: number;
  sourceSentence?: string;
}

// ============================================
// MEETING TYPES
// ============================================

export type FileType = 'audio' | 'video' | 'image';

export interface MeetingDoc {
  userId: string;
  title: string;
  fileUrl?: string;
  audioUrl?: string;
  fileType?: FileType;
  status: string;
}

// ============================================
// PIPELINE TYPES
// ============================================

export interface PipelineResult {
  transcript: string;
  formattedTranscript: string;
  confidence: number;
  duration: number;
  summary: string;
  tasks: ExtractedTask[];
  utterances: SpeakerUtterance[];
  speakerMapping: SpeakerMapping;
  speakers: string[];
  speakerCount: number;
  videoAnalysisUsed: boolean;
}
