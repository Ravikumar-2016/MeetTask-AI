/**
 * TasksPage.tsx - Employee Task View
 * 
 * EMPLOYEES ONLY - Shows tasks assigned to the current employee.
 * Allows employees to:
 * - View assigned tasks
 * - Update task status
 * - Submit work (text response + Google Drive link)
 * 
 * Managers should use TaskManagerPage instead.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  Timestamp 
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';

// ============================================
// TYPES
// ============================================
type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';
type TaskPriority = 'critical' | 'high' | 'medium' | 'low';
type SubmissionStep = 'idle' | 'validating' | 'saving' | 'attaching' | 'updating' | 'notifying' | 'complete' | 'error';

interface Task {
  id: string;
  meetingId: string;
  meetingTitle?: string;
  title: string;
  description: string;
  assignedTo: string;
  assignedToName: string;
  creatorName?: string;
  priority: TaskPriority;
  status: TaskStatus;
  requiresFile?: boolean;
  dueDate?: string;
  submissionText?: string;
  submissionFileUrl?: string;
  submissionFileName?: string;
  submittedAt?: string;
  createdAt?: string;
}

interface FileInfo {
  url: string;
  name: string;
  size: number;
  type: string;
}

// ============================================
// HELPERS
// ============================================
const formatDate = (dateStr: string | Timestamp | undefined): string => {
  if (!dateStr) return '';
  try {
    const date = dateStr instanceof Timestamp 
      ? dateStr.toDate() 
      : new Date(dateStr);
    
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    
    if (date < today) {
      const daysAgo = Math.floor((today.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
      return `${daysAgo} days overdue`;
    }
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
};

// Check if link has content (no regex validation - accept any link)
const hasLinkContent = (url: string): boolean => {
  return url.trim().length > 0;
};

// Validate Google Drive link format
const isValidDriveLink = (url: string): boolean => {
  const trimmed = url.trim();
  if (!trimmed) return false;
  
  // Accept various Google Drive URL formats
  const validPatterns = [
    'drive.google.com',
    'docs.google.com',
  ];
  
  return validPatterns.some(pattern => trimmed.includes(pattern));
};

// Get user-friendly error message for invalid links
const getDriveLinkError = (url: string): string | null => {
  const trimmed = url.trim();
  if (!trimmed) return null;
  
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return 'Link must start with https://';
  }
  
  if (!isValidDriveLink(trimmed)) {
    return 'Please paste a valid Google Drive or Google Docs link (drive.google.com or docs.google.com)';
  }
  
  return null;
};

// Get file type from Drive link
const getDriveFileType = (url: string): string => {
  if (url.includes('docs.google.com/document')) return 'Google Doc';
  if (url.includes('docs.google.com/spreadsheets')) return 'Google Sheets';
  if (url.includes('docs.google.com/presentation')) return 'Google Slides';
  if (url.includes('drive.google.com/drive/folders')) return 'Google Drive Folder';
  return 'Google Drive File';
};

// Get icon for file type
const getDriveFileIcon = (url: string): string => {
  if (url.includes('docs.google.com/document')) return 'description';
  if (url.includes('docs.google.com/spreadsheets')) return 'table_chart';
  if (url.includes('docs.google.com/presentation')) return 'slideshow';
  if (url.includes('drive.google.com/drive/folders')) return 'folder';
  return 'insert_drive_file';
};

const priorityOrder: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const priorityColors: Record<TaskPriority, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  medium: 'bg-blue-100 text-blue-700 border-blue-200',
  low: 'bg-slate-100 text-slate-600 border-slate-200',
};

const statusColors: Record<TaskStatus, string> = {
  pending: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  blocked: 'bg-red-100 text-red-700',
};

const statusLabels: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  blocked: 'Blocked',
};

// Submission progress steps
const submissionSteps: { step: SubmissionStep; label: string; icon: string }[] = [
  { step: 'validating', label: 'Validating submission...', icon: 'check_circle' },
  { step: 'saving', label: 'Saving your response...', icon: 'save' },
  { step: 'attaching', label: 'Attaching file link...', icon: 'attach_file' },
  { step: 'updating', label: 'Updating task status...', icon: 'sync' },
  { step: 'notifying', label: 'Notifying manager...', icon: 'notifications' },
];

// ============================================
// SKELETON LOADER COMPONENT
// ============================================
const TaskCardSkeleton: React.FC = () => (
  <div className="bg-white rounded-2xl border border-slate-200 p-5 animate-pulse">
    <div className="flex items-start gap-4">
      <div className="w-24 h-8 bg-slate-200 rounded-lg"></div>
      <div className="flex-1 space-y-3">
        <div className="h-5 bg-slate-200 rounded w-3/4"></div>
        <div className="h-4 bg-slate-100 rounded w-1/2"></div>
        <div className="flex gap-2">
          <div className="h-5 w-16 bg-slate-100 rounded"></div>
          <div className="h-5 w-20 bg-slate-100 rounded"></div>
        </div>
      </div>
    </div>
  </div>
);

// ============================================
// SUCCESS ANIMATION COMPONENT
// ============================================
interface SuccessOverlayProps {
  show: boolean;
  onComplete: () => void;
  taskTitle: string;
}

const SuccessOverlay: React.FC<SuccessOverlayProps> = ({ show, onComplete, taskTitle }) => {
  useEffect(() => {
    if (show) {
      const timer = setTimeout(onComplete, 2500);
      return () => clearTimeout(timer);
    }
  }, [show, onComplete]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fadeIn">
      <div className="bg-white rounded-3xl p-8 max-w-sm mx-4 text-center shadow-2xl animate-scaleIn">
        <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
          <span className="material-icons text-green-600 text-4xl">check_circle</span>
        </div>
        <h2 className="text-xl font-bold text-slate-900 mb-2">Submission Successful!</h2>
        <p className="text-slate-600 mb-1">Your work for</p>
        <p className="text-indigo-600 font-semibold mb-4 truncate">"{taskTitle}"</p>
        <p className="text-sm text-slate-500">has been submitted to your manager.</p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            onClick={onComplete}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition"
          >
            Back to Tasks
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================
// SUBMISSION PROGRESS OVERLAY
// ============================================
interface ProgressOverlayProps {
  show: boolean;
  currentStep: SubmissionStep;
}

const ProgressOverlay: React.FC<ProgressOverlayProps> = ({ show, currentStep }) => {
  if (!show || currentStep === 'idle' || currentStep === 'complete' || currentStep === 'error') return null;

  const currentIndex = submissionSteps.findIndex(s => s.step === currentStep);
  
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-6 max-w-sm mx-4 shadow-2xl">
        <div className="flex items-center justify-center mb-4">
          <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
        </div>
        <h3 className="text-lg font-semibold text-slate-900 text-center mb-4">Submitting Your Work</h3>
        <div className="space-y-3">
          {submissionSteps.map((step, index) => {
            const isActive = index === currentIndex;
            const isComplete = index < currentIndex;
            return (
              <div key={step.step} className={`flex items-center gap-3 transition-all duration-300 ${
                isActive ? 'opacity-100' : isComplete ? 'opacity-60' : 'opacity-30'
              }`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                  isComplete ? 'bg-green-100' : isActive ? 'bg-indigo-100' : 'bg-slate-100'
                }`}>
                  {isComplete ? (
                    <span className="material-icons text-green-600 text-sm">check</span>
                  ) : isActive ? (
                    <span className="material-icons text-indigo-600 text-sm animate-pulse">{step.icon}</span>
                  ) : (
                    <span className="material-icons text-slate-400 text-sm">{step.icon}</span>
                  )}
                </div>
                <span className={`text-sm ${isActive ? 'text-indigo-700 font-medium' : 'text-slate-600'}`}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-slate-400 text-center mt-4">Please don't close this window...</p>
      </div>
    </div>
  );
};

// ============================================
// TASK CARD COMPONENT
// ============================================
interface TaskCardProps {
  task: Task;
  onStatusChange: (taskId: string, newStatus: TaskStatus) => void;
  onSubmit: (taskId: string, text: string, file?: FileInfo) => Promise<boolean>;
  updating: boolean;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, onStatusChange, onSubmit, updating }) => {
  const [expanded, setExpanded] = useState(false);
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [submissionText, setSubmissionText] = useState('');
  const [driveLink, setDriveLink] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [currentStep, setCurrentStep] = useState<SubmissionStep>('idle');
  const [showSuccess, setShowSuccess] = useState(false);
  const [viewerConfirmed, setViewerConfirmed] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  
  const linkInputRef = useRef<HTMLInputElement>(null);

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed';
  const hasSubmission = task.submissionText || task.submissionFileUrl;
  
  // Computed: check if link has content
  const hasLink = hasLinkContent(driveLink);

  // Clear error when user types link or checks box
  useEffect(() => {
    if (driveLink.trim() || viewerConfirmed) {
      setSubmitError('');
    }
  }, [driveLink, viewerConfirmed]);

  // Handle submission with progress animation
  const handleSubmit = useCallback(async () => {
    // Reset error
    setSubmitError('');

    // Validate text
    if (!submissionText.trim()) {
      setSubmitError('Please provide a text response describing your work');
      return;
    }

    // Validate file link if required
    if (task.requiresFile && !driveLink.trim()) {
      setSubmitError('Please paste a Google Drive link');
      return;
    }

    // Validate Drive link format if provided
    if (driveLink.trim()) {
      const linkError = getDriveLinkError(driveLink);
      if (linkError) {
        setSubmitError(linkError);
        return;
      }
    }

    // Validate viewer confirmation if file link is provided
    if (driveLink.trim() && !viewerConfirmed) {
      setSubmitError('Please confirm you have shared the file as Viewer');
      return;
    }

    // Start submission progress
    setCurrentStep('validating');
    
    // Simulate progress steps
    const progressSteps: SubmissionStep[] = ['validating', 'saving', 'attaching', 'updating', 'notifying'];
    
    for (let i = 0; i < progressSteps.length; i++) {
      setCurrentStep(progressSteps[i]);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Build file info - just use the link if provided
    const fileInfo = driveLink.trim() ? {
      url: driveLink.trim(),
      name: getDriveFileType(driveLink),
      size: 0,
      type: 'link/drive',
    } : undefined;

    // Submit
    const success = await onSubmit(task.id, submissionText.trim(), fileInfo);

    if (success) {
      setCurrentStep('complete');
      setShowSuccess(true);
    } else {
      setCurrentStep('error');
      setSubmitError('Submission failed. Please try again.');
    }
  }, [task.id, task.requiresFile, submissionText, driveLink, viewerConfirmed, onSubmit]);

  // Handle success completion
  const handleSuccessComplete = useCallback(() => {
    setShowSuccess(false);
    setCurrentStep('idle');
    setSubmissionText('');
    setDriveLink('');
    setShowSubmitForm(false);
    setViewerConfirmed(false);
  }, []);

  // Remove linked file
  const removeLinkedFile = useCallback(() => {
    setDriveLink('');
    setViewerConfirmed(false);
  }, []);

  return (
    <>
      <SuccessOverlay show={showSuccess} onComplete={handleSuccessComplete} taskTitle={task.title} />
      <ProgressOverlay show={currentStep !== 'idle' && currentStep !== 'complete' && currentStep !== 'error'} currentStep={currentStep} />
      
      <div className={`bg-white rounded-2xl border transition-all duration-300 ${
        isOverdue ? 'border-rose-200 shadow-rose-100/50' : hasSubmission ? 'border-emerald-200 shadow-emerald-100/50' : 'border-slate-200/80'
      } ${expanded ? 'ring-2 ring-indigo-100 shadow-lg' : 'shadow-sm hover:shadow-md'}`}>
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 flex-1 min-w-0">
              {/* Status dropdown */}
              <select
                value={task.status}
                onChange={(e) => onStatusChange(task.id, e.target.value as TaskStatus)}
                disabled={updating || task.status === 'completed'}
                className={`appearance-none px-4 py-2 rounded-xl text-xs font-bold cursor-pointer transition-all shadow-sm ${
                  task.status === 'pending' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
                  task.status === 'in_progress' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                  task.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                  'bg-red-50 text-red-700 border border-red-200'
                } ${
                  updating ? 'opacity-50 cursor-wait' : 'hover:shadow-md'
                }`}
              >
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="blocked">Blocked</option>
              </select>

              {/* Task content */}
              <div className="flex-1 min-w-0">
                <h3 className={`font-semibold text-slate-800 text-[15px] leading-snug ${task.status === 'completed' ? 'line-through text-slate-400' : ''}`}>
                  {task.title}
                </h3>
                
                {task.description && (
                  <p className="text-sm text-slate-500 mt-1.5 line-clamp-2 leading-relaxed">{task.description}</p>
                )}

                <div className="flex flex-wrap items-center gap-2.5 mt-3">
                  <span className={`text-[10px] font-bold uppercase px-2.5 py-1 rounded-lg ${
                    task.priority === 'critical' ? 'bg-red-100 text-red-700' :
                    task.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                    task.priority === 'medium' ? 'bg-blue-100 text-blue-700' :
                    'bg-slate-100 text-slate-600'
                  }`}>
                    {task.priority}
                  </span>

                  {task.dueDate && (
                    <span className={`text-xs flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${
                      isOverdue ? 'bg-rose-50 text-rose-600 font-medium' : 'bg-slate-50 text-slate-600'
                    }`}>
                      <span className="material-icons text-[14px]">{isOverdue ? 'warning' : 'calendar_today'}</span>
                      {formatDate(task.dueDate)}
                    </span>
                  )}

                  {task.requiresFile && (
                    <span className="text-xs flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-orange-50 text-orange-600">
                      <span className="material-icons text-[14px]">attach_file</span>
                      File required
                    </span>
                  )}

                  {task.creatorName && (
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <span className="material-icons text-[12px]">person</span>
                      {task.creatorName}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {!hasSubmission && task.status !== 'completed' && (
                <button
                  onClick={() => setShowSubmitForm(!showSubmitForm)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-sm ${
                    showSubmitForm 
                      ? 'bg-indigo-600 text-white shadow-indigo-200' 
                      : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 hover:shadow-md'
                  }`}
                >
                  Submit Work
                </button>
              )}
              <button
                onClick={() => setExpanded(!expanded)}
                className="w-9 h-9 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              >
                <span className="material-icons text-[20px] transition-transform duration-300" style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                  expand_more
                </span>
              </button>
            </div>
          </div>

          {/* Existing submission display - Locked state */}
          {hasSubmission && (
            <div className="mt-5 mx-5 mb-5 p-5 bg-gradient-to-br from-emerald-50 via-green-50 to-teal-50 border border-emerald-200/60 rounded-2xl shadow-sm">
              {/* Header with status badge */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center shadow-sm">
                    <span className="material-icons text-emerald-600">task_alt</span>
                  </div>
                  <div>
                    <span className="text-sm font-bold text-emerald-800">Submitted Successfully</span>
                    <div className="flex items-center gap-1.5 text-xs text-emerald-600 mt-0.5">
                      <span className="material-icons text-[11px]">lock</span>
                      Submission locked
                    </div>
                  </div>
                </div>
                {task.submittedAt && (
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-100 text-emerald-700 text-xs font-semibold rounded-lg shadow-sm">
                      <span className="material-icons text-[12px]">check_circle</span>
                      Submitted
                    </span>
                    <p className="text-xs text-emerald-600 mt-1.5">{formatDate(task.submittedAt)}</p>
                  </div>
                )}
              </div>

              {/* Submitted text - read only */}
              {task.submissionText && (
                <div className="p-4 bg-white/70 backdrop-blur-sm border border-emerald-100 rounded-xl mb-4">
                  <p className="text-xs text-emerald-600 font-semibold mb-2 flex items-center gap-1.5">
                    <span className="material-icons text-[12px]">description</span>
                    Your Response
                  </p>
                  <p className="text-sm text-slate-700 leading-relaxed">{task.submissionText}</p>
                </div>
              )}

              {/* Attached file - with preview option */}
              {task.submissionFileUrl && (
                <div className="p-4 bg-white border border-emerald-200/60 rounded-xl shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-emerald-100 to-green-100 rounded-xl flex items-center justify-center shadow-sm">
                      <span className="material-icons text-emerald-600 text-xl">{getDriveFileIcon(task.submissionFileUrl)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">
                        {task.submissionFileName || getDriveFileType(task.submissionFileUrl)}
                      </p>
                      <p className="text-xs text-emerald-600 mt-0.5 flex items-center gap-1">
                        <span className="material-icons text-[11px]">visibility</span>
                        Shared as Viewer
                      </p>
                    </div>
                    <a
                      href={task.submissionFileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl transition-all shadow-sm hover:shadow-md"
                    >
                      <span className="material-icons text-[16px]">open_in_new</span>
                      View File
                    </a>
                  </div>
                </div>
              )}

              {/* Awaiting review notice */}
              <div className="mt-3 flex items-center gap-2 text-xs text-green-700">
                <span className="material-icons text-sm">schedule</span>
                Awaiting manager review
              </div>
            </div>
          )}

          {/* Submit form - Guided flow */}
          {showSubmitForm && !hasSubmission && (
            <div className="mt-5 mx-5 mb-5 p-6 bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 rounded-2xl border border-slate-200/80 shadow-sm animate-slideDown">
              <div className="flex items-center gap-3 mb-5 pb-4 border-b border-slate-100">
                <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-sm">
                  <span className="material-icons text-white">assignment_turned_in</span>
                </div>
                <div>
                  <h4 className="text-base font-bold text-slate-800">Submit Your Work</h4>
                  <p className="text-xs text-slate-500">Complete the fields below and submit</p>
                </div>
              </div>
              
              {/* Error message */}
              {submitError && (
                <div className="mb-5 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 animate-shake">
                  <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center shrink-0">
                    <span className="material-icons text-red-500 text-sm">error</span>
                  </div>
                  <p className="text-sm text-red-700 pt-1">{submitError}</p>
                </div>
              )}

              {/* Step 1: Text response */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 bg-indigo-600 text-white text-xs font-bold rounded-lg flex items-center justify-center shadow-sm">1</div>
                  <label className="text-sm font-semibold text-slate-700">
                    Describe your work <span className="text-red-500">*</span>
                  </label>
                </div>
                <textarea
                  value={submissionText}
                  onChange={(e) => setSubmissionText(e.target.value)}
                  placeholder="Explain what you've done, share relevant details, or describe your solution..."
                  rows={4}
                  disabled={currentStep !== 'idle' && currentStep !== 'error'}
                  className="w-full px-4 py-3.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-white shadow-sm"
                />
              </div>

              {/* Step 2: Google Drive link - Clean UI */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 text-xs font-bold rounded-lg flex items-center justify-center shadow-sm ${
                      task.requiresFile ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'
                    }`}>2</div>
                    <label className="text-sm font-semibold text-slate-700">
                      Attach file (Google Drive) {task.requiresFile ? <span className="text-red-500">*</span> : <span className="text-slate-400 font-normal">(optional)</span>}
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowHelpModal(true)}
                    className="flex items-center gap-1.5 text-xs text-indigo-600 hover:text-indigo-700 font-medium transition"
                  >
                    <span className="material-icons text-[14px]">help_outline</span>
                    How to share
                  </button>
                </div>

                {!hasLink ? (
                  <div className="space-y-3">
                    {/* Single clean input */}
                    <div className="relative">
                      <span className="material-icons absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">link</span>
                      <input
                        ref={linkInputRef}
                        type="url"
                        value={driveLink}
                        onChange={(e) => setDriveLink(e.target.value)}
                        placeholder="Paste Google Drive file link here"
                        disabled={currentStep !== 'idle' && currentStep !== 'error'}
                        className="w-full pl-12 pr-4 py-3.5 border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 rounded-xl text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed bg-white shadow-sm"
                      />
                    </div>

                    {/* Helper text */}
                    <p className="text-xs text-slate-500">
                      Upload your file to Google Drive and share it as <span className="font-medium">Viewer</span>, then paste the link here.
                    </p>
                  </div>
                ) : (
                  /* Link validated - show file preview and viewer confirmation */
                  <div className="space-y-3 animate-fadeIn">
                    {/* File preview card */}
                    <div className="p-3 bg-green-50 border border-green-200 rounded-xl">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 bg-green-100 rounded-lg flex items-center justify-center">
                          <span className="material-icons text-green-600 text-lg">{getDriveFileIcon(driveLink)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-green-800">{getDriveFileType(driveLink)}</p>
                          <p className="text-xs text-green-600 truncate">{driveLink}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <a
                            href={driveLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-green-600 hover:bg-green-100 rounded-lg transition"
                            title="Preview"
                          >
                            <span className="material-icons text-sm">open_in_new</span>
                          </a>
                          <button
                            onClick={removeLinkedFile}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition"
                            title="Remove"
                          >
                            <span className="material-icons text-sm">close</span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Viewer confirmation checkbox */}
                    <label className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                      viewerConfirmed 
                        ? 'bg-green-50 border-green-300' 
                        : 'bg-amber-50 border-amber-300 hover:border-amber-400'
                    }`}>
                      <input
                        type="checkbox"
                        checked={viewerConfirmed}
                        onChange={(e) => setViewerConfirmed(e.target.checked)}
                        className="mt-0.5 w-4 h-4 text-green-600 border-slate-300 rounded focus:ring-green-500"
                      />
                      <div>
                        <p className={`text-sm font-medium ${
                          viewerConfirmed ? 'text-green-700' : 'text-amber-700'
                        }`}>
                          {viewerConfirmed ? '✓ ' : ''}I have shared this file as "Viewer"
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Manager will have read-only access to view your file.
                        </p>
                      </div>
                    </label>
                  </div>
                )}
              </div>

              {/* Help Modal */}
              {showHelpModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowHelpModal(false)}>
                  <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-slate-900">How to Share from Google Drive</h3>
                      <button
                        onClick={() => setShowHelpModal(false)}
                        className="p-1 hover:bg-slate-100 rounded-lg transition"
                      >
                        <span className="material-icons text-slate-500">close</span>
                      </button>
                    </div>
                    
                    <div className="space-y-4">
                      <div className="flex gap-3">
                        <div className="w-7 h-7 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-sm font-bold shrink-0">1</div>
                        <div>
                          <p className="font-medium text-slate-800">Upload file to your Google Drive</p>
                          <p className="text-sm text-slate-500">Go to drive.google.com and upload your file</p>
                        </div>
                      </div>
                      
                      <div className="flex gap-3">
                        <div className="w-7 h-7 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-sm font-bold shrink-0">2</div>
                        <div>
                          <p className="font-medium text-slate-800">Right-click → Share</p>
                          <p className="text-sm text-slate-500">Open the sharing settings for your file</p>
                        </div>
                      </div>
                      
                      <div className="flex gap-3">
                        <div className="w-7 h-7 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-sm font-bold shrink-0">3</div>
                        <div>
                          <p className="font-medium text-slate-800">Change to "Anyone with the link"</p>
                          <p className="text-sm text-slate-500">Click on "Restricted" and change access</p>
                        </div>
                      </div>
                      
                      <div className="flex gap-3">
                        <div className="w-7 h-7 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-sm font-bold shrink-0">4</div>
                        <div>
                          <p className="font-medium text-slate-800">Set permission to "Viewer"</p>
                          <p className="text-sm text-slate-500 flex items-center gap-1">
                            <span className="material-icons text-amber-500 text-sm">warning</span>
                            Important: Must be Viewer (read-only)
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex gap-3">
                        <div className="w-7 h-7 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-sm font-bold shrink-0">5</div>
                        <div>
                          <p className="font-medium text-slate-800">Copy link and paste here</p>
                          <p className="text-sm text-slate-500">Click "Copy link" button and paste above</p>
                        </div>
                      </div>
                    </div>
                    
                    <button
                      onClick={() => setShowHelpModal(false)}
                      className="w-full mt-6 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-xl transition"
                    >
                      Got it
                    </button>
                  </div>
                </div>
              )}

              {/* Submit actions */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleSubmit}
                  disabled={(currentStep !== 'idle' && currentStep !== 'error') || !submissionText.trim() || (task.requiresFile && !hasLink) || (hasLink && !viewerConfirmed)}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 disabled:from-indigo-300 disabled:to-indigo-400 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-200 disabled:shadow-none"
                >
                  <span className="material-icons text-sm">send</span>
                  Submit Work
                </button>
                <button
                  onClick={() => {
                    setShowSubmitForm(false);
                    setSubmissionText('');
                    setDriveLink('');
                    setSubmitError('');
                    setViewerConfirmed(false);
                    setShowHelpModal(false);
                  }}
                  disabled={currentStep !== 'idle' && currentStep !== 'error'}
                  className="px-4 py-3 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 font-medium rounded-xl transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Expanded details */}
        {expanded && (
          <div className="px-5 pb-5 border-t border-slate-100 animate-fadeIn">
            <div className="mt-4 space-y-2">
              {task.meetingTitle && (
                <p className="text-sm text-slate-600">
                  <span className="font-medium">Meeting:</span> {task.meetingTitle}
                </p>
              )}
              {task.createdAt && (
                <p className="text-sm text-slate-500">
                  <span className="font-medium">Assigned:</span> {formatDate(task.createdAt)}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

// ============================================
// MAIN COMPONENT
// ============================================
const TasksPage: React.FC = () => {
  const { user, isManager, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  
  // Filters
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Redirect managers to TaskManager
  useEffect(() => {
    if (!authLoading && isManager) {
      navigate('/task-manager');
    }
  }, [authLoading, isManager, navigate]);

  // Fetch tasks assigned to current employee
  useEffect(() => {
    if (authLoading || !user) {
      return;
    }

    const mtaiId = user.mtaiId;
    
    if (!mtaiId) {
      setTasks([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const tasksQuery = query(
      collection(db, 'tasks'),
      where('assignedTo', '==', mtaiId)
    );

    const unsubscribe = onSnapshot(
      tasksQuery,
      (snapshot) => {
        const tasksData: Task[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          tasksData.push({
            id: doc.id,
            taskId: data.taskId || doc.id,
            meetingId: data.meetingId,
            meetingTitle: data.meetingTitle,
            title: data.title || 'Untitled Task',
            description: data.description || '',
            assignedTo: data.assignedTo,
            assignedToName: data.assignedToName,
            creatorName: data.creatorName,
            priority: data.priority || 'medium',
            status: data.status || 'pending',
            requiresFile: data.requiresFile || false,
            dueDate: data.dueDate,
            submissionText: data.submissionText,
            submissionFileUrl: data.submissionFileUrl,
            submissionFileName: data.submissionFileName,
            submittedAt: data.submittedAt?.toDate?.()?.toISOString(),
            createdAt: data.createdAt?.toDate?.()?.toISOString(),
          } as Task);
        });

        // Sort by priority
        tasksData.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

        setTasks(tasksData);
        setLoading(false);
      },
      (err) => {
        console.error('[TasksPage] Query error:', err);
        setError('Failed to load tasks');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.mtaiId, authLoading]);

  // Handle status change
  const handleStatusChange = useCallback(async (taskId: string, newStatus: TaskStatus) => {
    setUpdating(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch('/api/update-task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          taskId,
          action: 'status_change',
          status: newStatus,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to update status');
      }
    } catch (err: any) {
      console.error('[TasksPage] Status update error:', err);
      setError(err.message);
    } finally {
      setUpdating(false);
    }
  }, []);

  // Handle submission - returns success boolean
  const handleSubmit = useCallback(async (taskId: string, text: string, file?: FileInfo): Promise<boolean> => {
    setUpdating(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch('/api/submit-task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          taskId,
          submissionText: text,
          submissionFileUrl: file?.url,
          submissionFileName: file?.name,
          submissionFileSize: file?.size,
          submissionFileType: file?.type,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to submit');
      }
      
      return true;
    } catch (err: any) {
      console.error('[TasksPage] Submit error:', err);
      setError(err.message);
      return false;
    } finally {
      setUpdating(false);
    }
  }, []);

  // Filter tasks
  const filteredTasks = tasks
    .filter(t => statusFilter === 'all' || t.status === statusFilter)
    .filter(t => 
      !searchQuery || 
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase())
    );

  // Stats
  const stats = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
  };

  // Loading state with skeletons
  if (authLoading || loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Tasks</h1>
          <p className="text-slate-500 mt-1">Tasks assigned to you by managers</p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white p-4 rounded-xl border border-slate-200 animate-pulse">
              <div className="h-8 w-8 bg-slate-200 rounded mb-2"></div>
              <div className="h-4 w-16 bg-slate-100 rounded"></div>
            </div>
          ))}
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <TaskCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Tasks</h1>
        <p className="text-slate-500 mt-1">Tasks assigned to you by managers</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-5 rounded-2xl border border-amber-100 hover:shadow-lg hover:shadow-amber-100/50 transition-all duration-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold text-amber-600">{stats.pending}</p>
              <p className="text-sm font-medium text-amber-700/70 mt-1">Pending</p>
            </div>
            <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
              <span className="material-icons text-amber-600">pending_actions</span>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 p-5 rounded-2xl border border-blue-100 hover:shadow-lg hover:shadow-blue-100/50 transition-all duration-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold text-blue-600">{stats.inProgress}</p>
              <p className="text-sm font-medium text-blue-700/70 mt-1">In Progress</p>
            </div>
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
              <span className="material-icons text-blue-600">autorenew</span>
            </div>
          </div>
        </div>
        <div className="bg-gradient-to-br from-emerald-50 to-green-50 p-5 rounded-2xl border border-emerald-100 hover:shadow-lg hover:shadow-emerald-100/50 transition-all duration-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold text-emerald-600">{stats.completed}</p>
              <p className="text-sm font-medium text-emerald-700/70 mt-1">Completed</p>
            </div>
            <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
              <span className="material-icons text-emerald-600">task_alt</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 justify-between">
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
          {(['all', 'pending', 'in_progress', 'completed'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-4 py-1.5 rounded-lg text-sm font-semibold capitalize transition-all ${
                statusFilter === status 
                  ? 'bg-white text-indigo-600 shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {status === 'all' ? 'All' : statusLabels[status]}
            </button>
          ))}
        </div>
        
        <div className="relative">
          <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">search</span>
          <input
            type="text"
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm w-48 focus:ring-2 focus:ring-indigo-500 transition-all"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center justify-between animate-shake">
          <div className="flex items-center gap-2">
            <span className="material-icons text-red-500">error</span>
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="p-1 hover:bg-red-100 rounded-lg transition">
            <span className="material-icons">close</span>
          </button>
        </div>
      )}

      {/* Tasks List */}
      {filteredTasks.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <span className="material-icons text-5xl text-slate-300 mb-4">task_alt</span>
          <h3 className="text-lg font-semibold text-slate-700 mb-2">
            {tasks.length === 0 ? 'No tasks yet' : 'No matching tasks'}
          </h3>
          <p className="text-slate-500">
            {tasks.length === 0 
              ? 'Tasks will appear here when a manager assigns them to you.'
              : 'Try adjusting your filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTasks.map((task, index) => (
            <div 
              key={task.id} 
              className="animate-fadeIn"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <TaskCard
                task={task}
                onStatusChange={handleStatusChange}
                onSubmit={handleSubmit}
                updating={updating}
              />
            </div>
          ))}
        </div>
      )}

      {/* CSS Animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.9); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes slideDown {
          from { opacity: 0; max-height: 0; }
          to { opacity: 1; max-height: 1000px; }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-5px); }
          75% { transform: translateX(5px); }
        }
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out forwards;
        }
        .animate-scaleIn {
          animation: scaleIn 0.3s ease-out forwards;
        }
        .animate-slideDown {
          animation: slideDown 0.3s ease-out forwards;
        }
        .animate-shake {
          animation: shake 0.3s ease-out;
        }
      `}</style>
    </div>
  );
};

export default TasksPage;
