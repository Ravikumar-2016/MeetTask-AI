/**
 * TasksPage.tsx - Employee Task View
 * 
 * EMPLOYEES ONLY - Shows tasks assigned to the current employee.
 * Allows employees to:
 * - View assigned tasks
 * - Update task status
 * - Submit work (text response + optional file upload)
 * 
 * Managers should use TaskManagerPage instead.
 */

import React, { useState, useEffect, useCallback } from 'react';
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
import { 
  formatFileSize, 
  getFileIcon,
  canPreviewFile,
  openFile
} from '../lib/fileUpload';

// ============================================
// TYPES
// ============================================
type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';
type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

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

// ============================================
// TASK CARD COMPONENT
// ============================================
interface TaskCardProps {
  task: Task;
  onStatusChange: (taskId: string, newStatus: TaskStatus) => void;
  onSubmit: (taskId: string, text: string, file?: FileInfo) => void;
  updating: boolean;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, onStatusChange, onSubmit, updating }) => {
  const [expanded, setExpanded] = useState(false);
  const [submissionText, setSubmissionText] = useState('');
  const [showSubmitForm, setShowSubmitForm] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [driveLink, setDriveLink] = useState('');

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed';
  const hasSubmission = task.submissionText || task.submissionFileUrl;

  // Handle submission
  const handleSubmit = useCallback(() => {
    // Text is always required
    if (!submissionText.trim()) {
      setSubmitError('Please provide a text response describing your work');
      return;
    }

    // Check if file is required
    if (task.requiresFile && !driveLink.trim()) {
      setSubmitError('This task requires a file link. Please provide your Google Drive link.');
      return;
    }

    // Build file info from drive link if provided
    const fileInfo = driveLink.trim() ? {
      url: driveLink.trim(),
      name: 'Google Drive File',
      size: 0,
      type: 'link/drive',
    } : undefined;

    onSubmit(task.id, submissionText.trim(), fileInfo);

    // Reset form
    setSubmissionText('');
    setDriveLink('');
    setShowSubmitForm(false);
    setSubmitError('');
  }, [task.id, task.requiresFile, submissionText, driveLink, onSubmit]);

  return (
    <div className={`bg-white rounded-2xl border shadow-sm transition-all ${
      isOverdue ? 'border-rose-200' : hasSubmission ? 'border-green-200' : 'border-slate-200'
    } ${expanded ? 'ring-2 ring-indigo-100' : ''}`}>
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            {/* Status dropdown */}
            <select
              value={task.status}
              onChange={(e) => onStatusChange(task.id, e.target.value as TaskStatus)}
              disabled={updating || task.status === 'completed'}
              className={`appearance-none w-32 px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${statusColors[task.status]} ${
                updating ? 'opacity-50 cursor-wait' : ''
              }`}
            >
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="blocked">Blocked</option>
            </select>

            {/* Task content */}
            <div className="flex-1 min-w-0">
              <h3 className={`font-semibold text-slate-900 ${task.status === 'completed' ? 'line-through text-slate-400' : ''}`}>
                {task.title}
              </h3>
              
              {task.description && (
                <p className="text-sm text-slate-500 mt-1 line-clamp-2">{task.description}</p>
              )}

              <div className="flex flex-wrap items-center gap-3 mt-3">
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${priorityColors[task.priority]}`}>
                  {task.priority}
                </span>

                {task.dueDate && (
                  <span className={`text-xs flex items-center gap-1 ${isOverdue ? 'text-rose-600 font-medium' : 'text-slate-500'}`}>
                    <span className="material-icons text-[14px]">{isOverdue ? 'warning' : 'event'}</span>
                    {formatDate(task.dueDate)}
                  </span>
                )}

                {task.requiresFile && (
                  <span className="text-xs flex items-center gap-1 text-orange-600">
                    <span className="material-icons text-[14px]">attach_file</span>
                    File required
                  </span>
                )}

                {task.creatorName && (
                  <span className="text-xs text-slate-400">
                    From: {task.creatorName}
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
                className="px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-lg text-sm font-medium transition"
              >
                Submit Work
              </button>
            )}
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-lg transition"
            >
              <span className="material-icons text-[20px]">
                {expanded ? 'expand_less' : 'expand_more'}
              </span>
            </button>
          </div>
        </div>

        {/* Existing submission */}
        {hasSubmission && (
          <div className="mt-4 p-4 bg-green-50 border border-green-100 rounded-xl">
            <div className="flex items-center gap-2 mb-2">
              <span className="material-icons text-green-600 text-sm">check_circle</span>
              <span className="text-sm font-semibold text-green-700">Your Submission</span>
            </div>
            {task.submissionText && (
              <p className="text-sm text-green-800">{task.submissionText}</p>
            )}
            {task.submissionFileUrl && (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <span className="material-icons text-green-600">{getFileIcon(task.submissionFileName || '')}</span>
                <span className="text-sm text-green-700 flex-1 truncate">{task.submissionFileName || 'Attachment'}</span>
                
                {/* Preview button for PDF/TXT */}
                {canPreviewFile(task.submissionFileName || '') && task.submissionFileUrl && (
                  <button
                    onClick={() => openFile(task.submissionFileUrl!, task.submissionFileName || 'file', false)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-100 hover:bg-blue-200 text-blue-700 text-sm font-medium rounded-lg transition"
                  >
                    <span className="material-icons text-sm">visibility</span>
                    Preview
                  </button>
                )}
                
                {/* Download button for all files */}
                {task.submissionFileUrl && (
                  <button
                    onClick={() => openFile(task.submissionFileUrl!, task.submissionFileName || 'file', true)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 text-sm font-medium rounded-lg transition"
                  >
                    <span className="material-icons text-sm">download</span>
                    Download
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Submit form */}
        {showSubmitForm && !hasSubmission && (
          <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
            <h4 className="text-sm font-semibold text-slate-700 mb-3">Submit Your Work</h4>
            
            {submitError && (
              <div className="mb-3 p-3 bg-red-50 border border-red-100 rounded-lg">
                <p className="text-sm text-red-700">{submitError}</p>
              </div>
            )}

            {/* Text response - always required */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Response <span className="text-red-500">*</span>
              </label>
              <textarea
                value={submissionText}
                onChange={(e) => setSubmissionText(e.target.value)}
                placeholder="Describe what you've done, provide links, or explain your solution..."
                rows={3}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
              />
            </div>

            {/* File/Link section */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Google Drive Link {task.requiresFile ? <span className="text-red-500">*</span> : '(optional)'}
              </label>
              
              <div className="space-y-2">
                <input
                  type="url"
                  value={driveLink}
                  onChange={(e) => setDriveLink(e.target.value)}
                  placeholder="Paste your Google Drive file link here..."
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <div className="flex items-center gap-2">
                  <a
                    href="https://drive.google.com/drive/folders/13lIjU4zmd8rolBJd036UIiwUEDN253TY"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-600 hover:text-indigo-800 hover:underline flex items-center gap-1"
                  >
                    <span className="material-icons text-sm">open_in_new</span>
                    Upload to Google Drive
                  </a>
                  <span className="text-xs text-slate-400">• Then paste the share link above</span>
                </div>
              </div>
            </div>

            {/* Submit button */}
            <div className="flex gap-2">
              <button
                onClick={handleSubmit}
                disabled={updating || !submissionText.trim() || (task.requiresFile && !driveLink.trim())}
                className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
              >
                {updating ? (
                  <>
                    <span className="animate-spin material-icons text-sm">hourglass_empty</span>
                    Submitting...
                  </>
                ) : (
                  <>
                    <span className="material-icons text-sm">send</span>
                    Submit
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setShowSubmitForm(false);
                  setSubmissionText('');
                  setDriveLink('');
                  setSubmitError('');
                }}
                className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-5 pb-5 border-t border-slate-100">
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
  );
};

// ============================================
// MAIN COMPONENT
// ============================================
const TasksPage: React.FC = () => {
  const { user, isEmployee, isManager, loading: authLoading } = useAuth();
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
      console.log('[TasksPage] Skipping - authLoading:', authLoading, 'user:', !!user);
      return;
    }

    const mtaiId = user.mtaiId;
    
    if (!mtaiId) {
      console.log('[TasksPage] No MTAI ID found for user');
      setTasks([]);
      setLoading(false);
      return;
    }

    console.log('[TasksPage] Setting up task listener for assignedTo:', mtaiId);
    setLoading(true);

    const tasksQuery = query(
      collection(db, 'tasks'),
      where('assignedTo', '==', mtaiId)
    );

    const unsubscribe = onSnapshot(
      tasksQuery,
      (snapshot) => {
        console.log('[TasksPage] Tasks snapshot received, count:', snapshot.size);
        const tasksData: Task[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          console.log('[TasksPage] Task found:', doc.id, 'assignedTo:', data.assignedTo);
          tasksData.push({
            id: doc.id,
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
          });
        });

        // Sort by priority
        tasksData.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

        console.log('[TasksPage] Setting tasks state, count:', tasksData.length);
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

  // Handle submission
  const handleSubmit = useCallback(async (taskId: string, text: string, file?: FileInfo) => {
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
      
      // Show success (task list will update via real-time listener)
      console.log('[TasksPage] Task submitted successfully');
    } catch (err: any) {
      console.error('[TasksPage] Submit error:', err);
      setError(err.message);
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

  // Loading state
  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
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
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-2xl font-bold text-amber-600">{stats.pending}</p>
          <p className="text-sm text-slate-500">Pending</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-2xl font-bold text-blue-600">{stats.inProgress}</p>
          <p className="text-sm text-slate-500">In Progress</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
          <p className="text-sm text-slate-500">Completed</p>
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
            className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm w-48 focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)}>
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
          {filteredTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onStatusChange={handleStatusChange}
              onSubmit={handleSubmit}
              updating={updating}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default TasksPage;
