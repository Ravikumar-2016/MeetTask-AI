/**
 * TasksPage - Client Dashboard for Assigned Tasks
 * 
 * Shows all tasks assigned to the current user across all meetings.
 * Allows status updates, comments, and file uploads.
 * 
 * Features:
 * - Filter by status (All, Pending, In Progress, Completed, Blocked)
 * - Sort by priority (Critical → Low)
 * - Search tasks
 * - Update status inline
 * - Add comments/updates
 * - Real-time sync with Firestore
 */

import React, { useState, useEffect } from 'react';
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

interface TaskUpdate {
  id: string;
  type: string;
  content: string;
  userName: string;
  createdAt: string;
}

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
  dueDate?: string;
  updates?: TaskUpdate[];
  createdAt?: string;
  updatedAt?: string;
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
    
    // Check if overdue
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
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-slate-100 text-slate-600 border-slate-200',
};

const statusColors: Record<TaskStatus, string> = {
  pending: 'bg-slate-100 text-slate-600',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  blocked: 'bg-rose-100 text-rose-700',
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
  onAddComment: (taskId: string, comment: string) => void;
  updating: boolean;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, onStatusChange, onAddComment, updating }) => {
  const [expanded, setExpanded] = useState(false);
  const [comment, setComment] = useState('');
  const [showCommentInput, setShowCommentInput] = useState(false);

  const handleStatusChange = (newStatus: TaskStatus) => {
    if (newStatus !== task.status) {
      onStatusChange(task.id, newStatus);
    }
  };

  const handleSubmitComment = () => {
    if (comment.trim()) {
      onAddComment(task.id, comment.trim());
      setComment('');
      setShowCommentInput(false);
    }
  };

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'completed';

  return (
    <div className={`bg-white rounded-2xl border shadow-sm transition-all ${
      isOverdue ? 'border-rose-200' : 'border-slate-200'
    } ${expanded ? 'ring-2 ring-indigo-100' : ''}`}>
      {/* Main Card Content */}
      <div className="p-5">
        <div className="flex items-start justify-between gap-4">
          {/* Left side - Status + Content */}
          <div className="flex items-start gap-4 flex-1 min-w-0">
            {/* Status dropdown */}
            <div className="relative">
              <select
                value={task.status}
                onChange={(e) => handleStatusChange(e.target.value as TaskStatus)}
                disabled={updating}
                className={`appearance-none w-32 px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${statusColors[task.status]} ${
                  updating ? 'opacity-50 cursor-wait' : ''
                }`}
              >
                <option value="pending">Pending</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="blocked">Blocked</option>
              </select>
              <span className="material-icons absolute right-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none">
                expand_more
              </span>
            </div>

            {/* Task content */}
            <div className="flex-1 min-w-0">
              <h3 className={`font-semibold text-slate-900 ${task.status === 'completed' ? 'line-through text-slate-400' : ''}`}>
                {task.title}
              </h3>
              
              {task.description && (
                <p className="text-sm text-slate-500 mt-1 line-clamp-2">{task.description}</p>
              )}

              <div className="flex flex-wrap items-center gap-3 mt-3">
                {/* Priority badge */}
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${priorityColors[task.priority]}`}>
                  {task.priority}
                </span>

                {/* Due date */}
                {task.dueDate && (
                  <span className={`text-xs flex items-center gap-1 ${isOverdue ? 'text-rose-600 font-medium' : 'text-slate-500'}`}>
                    <span className="material-icons text-[14px]">{isOverdue ? 'warning' : 'event'}</span>
                    {formatDate(task.dueDate)}
                  </span>
                )}

                {/* Meeting source */}
                {task.meetingTitle && (
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <span className="material-icons text-[14px]">video_call</span>
                    {task.meetingTitle}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right side - Actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCommentInput(!showCommentInput)}
              className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded-lg transition"
              title="Add comment"
            >
              <span className="material-icons text-[20px]">comment</span>
            </button>
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

        {/* Comment input */}
        {showCommentInput && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex gap-2">
              <input
                type="text"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Add an update or comment..."
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitComment()}
              />
              <button
                onClick={handleSubmitComment}
                disabled={!comment.trim() || updating}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Expanded - Updates/Activity */}
      {expanded && task.updates && task.updates.length > 0 && (
        <div className="px-5 pb-5 border-t border-slate-100">
          <h4 className="text-xs font-semibold text-slate-500 uppercase mt-4 mb-3">Activity</h4>
          <div className="space-y-3">
            {task.updates.slice().reverse().slice(0, 5).map((update, idx) => (
              <div key={update.id || idx} className="flex items-start gap-3 text-sm">
                <div className="w-6 h-6 bg-slate-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <span className="material-icons text-[14px] text-slate-500">
                    {update.type === 'status_change' ? 'sync' : update.type === 'file_upload' ? 'attach_file' : 'chat'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-slate-700">
                    <span className="font-medium">{update.userName}</span>
                    {' '}{update.content}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {new Date(update.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            ))}
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
  const { user, loading: authLoading } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  
  // Filters
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'priority' | 'dueDate' | 'created'>('priority');

  // Fetch tasks assigned to current user
  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    // Get MTAI ID from user object (extended by AuthContext)
    const mtaiId = (user as any)?.mtaiId;
    
    if (!mtaiId) {
      console.log('[TasksPage] No MTAI ID, showing empty state');
      setTasks([]);
      setLoading(false);
      return;
    }

    console.log('[TasksPage] Setting up listener for MTAI ID:', mtaiId);
    setLoading(true);

    // Query tasks assigned to this user by MTAI ID
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
            meetingId: data.meetingId,
            meetingTitle: data.meetingTitle,
            title: data.title || 'Untitled Task',
            description: data.description || '',
            assignedTo: data.assignedTo,
            assignedToName: data.assignedToName,
            creatorName: data.creatorName,
            priority: data.priority || 'medium',
            status: data.status || 'pending',
            dueDate: data.dueDate,
            updates: data.updates || [],
            createdAt: data.createdAt?.toDate?.()?.toISOString(),
            updatedAt: data.updatedAt?.toDate?.()?.toISOString(),
          });
        });

        console.log('[TasksPage] Tasks loaded:', tasksData.length);
        setTasks(tasksData);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('[TasksPage] Error:', err);
        if (err.code === 'permission-denied') {
          setTasks([]);
        } else {
          setError('Failed to load tasks');
        }
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [(user as any)?.mtaiId, authLoading]);

  // Handle status change
  const handleStatusChange = async (taskId: string, newStatus: TaskStatus) => {
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

      console.log('[TasksPage] Status updated');
    } catch (err: any) {
      console.error('[TasksPage] Status update error:', err);
      setError(err.message);
    } finally {
      setUpdating(false);
    }
  };

  // Handle add comment
  const handleAddComment = async (taskId: string, comment: string) => {
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
          action: 'comment',
          comment,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to add comment');
      }

      console.log('[TasksPage] Comment added');
    } catch (err: any) {
      console.error('[TasksPage] Comment error:', err);
      setError(err.message);
    } finally {
      setUpdating(false);
    }
  };

  // Filter and sort tasks
  const filteredTasks = tasks
    .filter(t => statusFilter === 'all' || t.status === statusFilter)
    .filter(t => 
      !searchQuery || 
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.meetingTitle?.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'priority') {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      if (sortBy === 'dueDate') {
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }
      // Default: created date
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });

  // Stats
  const stats = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    blocked: tasks.filter(t => t.status === 'blocked').length,
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">My Tasks</h1>
        <p className="text-slate-500">Tasks assigned to you from meetings</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-sm text-slate-500">Pending</p>
          <p className="text-2xl font-bold text-slate-900">{stats.pending}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-sm text-slate-500">In Progress</p>
          <p className="text-2xl font-bold text-blue-600">{stats.inProgress}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-sm text-slate-500">Completed</p>
          <p className="text-2xl font-bold text-emerald-600">{stats.completed}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <p className="text-sm text-slate-500">Blocked</p>
          <p className="text-2xl font-bold text-rose-600">{stats.blocked}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        {/* Status tabs */}
        <div className="flex flex-wrap gap-1 bg-slate-100 p-1 rounded-xl">
          {(['all', 'pending', 'in_progress', 'completed', 'blocked'] as const).map((status) => (
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

        {/* Search and Sort */}
        <div className="flex gap-2">
          <div className="relative">
            <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">search</span>
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="priority">Sort by Priority</option>
            <option value="dueDate">Sort by Due Date</option>
            <option value="created">Sort by Created</option>
          </select>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-icons">error</span>
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-500 hover:text-rose-700">
            <span className="material-icons">close</span>
          </button>
        </div>
      )}

      {/* Tasks List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white p-6 rounded-2xl border border-slate-200 animate-pulse">
              <div className="flex gap-4">
                <div className="w-24 h-8 bg-slate-100 rounded-lg"></div>
                <div className="flex-1 space-y-3">
                  <div className="h-5 bg-slate-100 rounded w-2/3"></div>
                  <div className="h-4 bg-slate-100 rounded w-1/2"></div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center">
          <span className="material-icons text-slate-300 text-5xl mb-4">assignment</span>
          <h3 className="font-bold text-slate-900 mb-2">
            {tasks.length === 0 ? 'No tasks assigned to you' : 'No matching tasks'}
          </h3>
          <p className="text-slate-500">
            {tasks.length === 0 
              ? 'Tasks will appear here when someone assigns them to you from a meeting'
              : 'Try adjusting your filters'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onStatusChange={handleStatusChange}
              onAddComment={handleAddComment}
              updating={updating}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default TasksPage;