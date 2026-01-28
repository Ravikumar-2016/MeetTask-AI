/**
 * ManagerDashboard - Meeting Owner's Task Tracking View
 * 
 * Shows all tasks from all meetings created by the current user.
 * Allows the meeting owner to track progress of all assigned tasks.
 * 
 * Features:
 * - Overview stats (total, by status, overdue)
 * - Filter by meeting, status, priority
 * - Sort by priority (Critical → Low), due date, status
 * - Real-time updates from Firestore
 * - Click to view task details
 */

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  Timestamp 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';

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
  assignedToEmail: string;
  priority: TaskPriority;
  status: TaskStatus;
  dueDate?: string;
  createdAt?: string;
  updatedAt?: string;
  lastUpdateAt?: string;
}

// ============================================
// HELPERS
// ============================================
const formatDate = (dateStr: string | Timestamp | undefined): string => {
  if (!dateStr) return '-';
  try {
    const date = dateStr instanceof Timestamp 
      ? dateStr.toDate() 
      : new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '-';
  }
};

const isOverdue = (dueDate: string | undefined, status: TaskStatus): boolean => {
  if (!dueDate || status === 'completed') return false;
  return new Date(dueDate) < new Date();
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
// STAT CARD COMPONENT
// ============================================
interface StatCardProps {
  title: string;
  value: number;
  icon: string;
  color: string;
  onClick?: () => void;
  active?: boolean;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon, color, onClick, active }) => (
  <div 
    className={`bg-white p-5 rounded-xl border shadow-sm cursor-pointer transition-all ${
      active ? 'ring-2 ring-indigo-500 border-indigo-300' : 'border-slate-200 hover:border-slate-300'
    }`}
    onClick={onClick}
  >
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-slate-500 font-medium">{title}</p>
        <p className="text-3xl font-bold text-slate-900 mt-1">{value}</p>
      </div>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        <span className="material-icons text-white">{icon}</span>
      </div>
    </div>
  </div>
);

// ============================================
// MAIN COMPONENT
// ============================================
const ManagerDashboard: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Filters
  const [statusFilter, setStatusFilter] = useState<'all' | TaskStatus | 'overdue'>('all');
  const [meetingFilter, setMeetingFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'priority' | 'dueDate' | 'status' | 'assignee'>('priority');

  // Fetch tasks for meetings created by current user
  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }

    if (!user?.uid) {
      setTasks([]);
      setLoading(false);
      return;
    }

    console.log('[ManagerDashboard] Setting up listener for creator:', user.uid);
    setLoading(true);

    // Query tasks where current user is the creator (meeting owner)
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('creatorId', '==', user.uid)
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
            meetingTitle: data.meetingTitle || 'Untitled Meeting',
            title: data.title || 'Untitled Task',
            description: data.description || '',
            assignedTo: data.assignedTo,
            assignedToName: data.assignedToName || 'Unassigned',
            assignedToEmail: data.assignedToEmail || '',
            priority: data.priority || 'medium',
            status: data.status || 'pending',
            dueDate: data.dueDate,
            createdAt: data.createdAt?.toDate?.()?.toISOString(),
            updatedAt: data.updatedAt?.toDate?.()?.toISOString(),
            lastUpdateAt: data.lastUpdateAt?.toDate?.()?.toISOString(),
          });
        });

        console.log('[ManagerDashboard] Tasks loaded:', tasksData.length);
        setTasks(tasksData);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('[ManagerDashboard] Error:', err);
        if (err.code === 'permission-denied') {
          setTasks([]);
        } else {
          setError('Failed to load tasks');
        }
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid, authLoading]);

  // Calculate stats
  const stats = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    blocked: tasks.filter(t => t.status === 'blocked').length,
    overdue: tasks.filter(t => isOverdue(t.dueDate, t.status)).length,
  };

  // Get unique meetings for filter
  const meetings = Array.from(new Set(tasks.map(t => t.meetingId)))
    .map(id => ({
      id,
      title: tasks.find(t => t.meetingId === id)?.meetingTitle || 'Untitled',
    }));

  // Filter and sort tasks
  const filteredTasks = tasks
    .filter(t => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'overdue') return isOverdue(t.dueDate, t.status);
      return t.status === statusFilter;
    })
    .filter(t => meetingFilter === 'all' || t.meetingId === meetingFilter)
    .filter(t => 
      !searchQuery || 
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.assignedToName.toLowerCase().includes(searchQuery.toLowerCase())
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
      if (sortBy === 'status') {
        const statusOrder = { blocked: 0, pending: 1, in_progress: 2, completed: 3 };
        return statusOrder[a.status] - statusOrder[b.status];
      }
      if (sortBy === 'assignee') {
        return a.assignedToName.localeCompare(b.assignedToName);
      }
      return 0;
    });

  // Group tasks by meeting for grouped view
  const tasksByMeeting = meetings.map(meeting => ({
    ...meeting,
    tasks: filteredTasks.filter(t => t.meetingId === meeting.id),
  })).filter(m => m.tasks.length > 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Task Manager</h1>
          <p className="text-slate-500">Track progress of tasks from your meetings</p>
        </div>
        <Link 
          to="/upload" 
          className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition shadow-lg shadow-indigo-100 flex items-center justify-center space-x-2 w-fit"
        >
          <span className="material-icons text-[20px]">add</span>
          <span>New Meeting</span>
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard 
          title="Total Tasks" 
          value={stats.total} 
          icon="assignment" 
          color="bg-slate-500"
          onClick={() => setStatusFilter('all')}
          active={statusFilter === 'all'}
        />
        <StatCard 
          title="Pending" 
          value={stats.pending} 
          icon="pending" 
          color="bg-slate-500"
          onClick={() => setStatusFilter('pending')}
          active={statusFilter === 'pending'}
        />
        <StatCard 
          title="In Progress" 
          value={stats.inProgress} 
          icon="autorenew" 
          color="bg-blue-500"
          onClick={() => setStatusFilter('in_progress')}
          active={statusFilter === 'in_progress'}
        />
        <StatCard 
          title="Completed" 
          value={stats.completed} 
          icon="check_circle" 
          color="bg-emerald-500"
          onClick={() => setStatusFilter('completed')}
          active={statusFilter === 'completed'}
        />
        <StatCard 
          title="Blocked" 
          value={stats.blocked} 
          icon="block" 
          color="bg-rose-500"
          onClick={() => setStatusFilter('blocked')}
          active={statusFilter === 'blocked'}
        />
        <StatCard 
          title="Overdue" 
          value={stats.overdue} 
          icon="warning" 
          color="bg-orange-500"
          onClick={() => setStatusFilter('overdue')}
          active={statusFilter === 'overdue'}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-4 items-center bg-white p-4 rounded-xl border border-slate-200">
        {/* Meeting filter */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Meeting:</label>
          <select
            value={meetingFilter}
            onChange={(e) => setMeetingFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="all">All Meetings</option>
            {meetings.map(m => (
              <option key={m.id} value={m.id}>{m.title}</option>
            ))}
          </select>
        </div>

        {/* Sort */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Sort by:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            <option value="priority">Priority</option>
            <option value="dueDate">Due Date</option>
            <option value="status">Status</option>
            <option value="assignee">Assignee</option>
          </select>
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <span className="material-icons absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[18px]">search</span>
          <input
            type="text"
            placeholder="Search tasks or assignees..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Clear filters */}
        {(statusFilter !== 'all' || meetingFilter !== 'all' || searchQuery) && (
          <button
            onClick={() => {
              setStatusFilter('all');
              setMeetingFilter('all');
              setSearchQuery('');
            }}
            className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1"
          >
            <span className="material-icons text-[16px]">clear</span>
            Clear filters
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl flex items-center gap-2">
          <span className="material-icons">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Tasks Table */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="space-y-4 animate-pulse">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center gap-4">
                <div className="w-24 h-6 bg-slate-100 rounded"></div>
                <div className="flex-1 h-6 bg-slate-100 rounded"></div>
                <div className="w-32 h-6 bg-slate-100 rounded"></div>
                <div className="w-24 h-6 bg-slate-100 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center">
          <span className="material-icons text-slate-300 text-5xl mb-4">assignment</span>
          <h3 className="font-bold text-slate-900 mb-2">
            {tasks.length === 0 ? 'No tasks yet' : 'No matching tasks'}
          </h3>
          <p className="text-slate-500 mb-6">
            {tasks.length === 0 
              ? 'Tasks will appear here when you complete speaker mapping on your meetings'
              : 'Try adjusting your filters'}
          </p>
          {tasks.length === 0 && (
            <Link 
              to="/meetings" 
              className="inline-flex items-center gap-2 text-indigo-600 font-semibold hover:underline"
            >
              <span className="material-icons text-[18px]">video_library</span>
              Go to Meetings
            </Link>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Task</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Assigned To</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Meeting</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Priority</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTasks.map((task) => {
                const overdue = isOverdue(task.dueDate, task.status);
                return (
                  <tr 
                    key={task.id} 
                    className={`hover:bg-slate-50 transition ${overdue ? 'bg-rose-50/50' : ''}`}
                  >
                    <td className="px-6 py-4">
                      <p className={`font-semibold ${task.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                        {task.title}
                      </p>
                      {task.description && (
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{task.description}</p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                          <span className="text-xs font-bold text-indigo-600">
                            {task.assignedToName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-900">{task.assignedToName}</p>
                          {task.assignedToEmail && (
                            <p className="text-xs text-slate-500">{task.assignedToEmail}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <Link 
                        to={`/meetings/${task.meetingId}`}
                        className="text-sm text-slate-600 hover:text-indigo-600 flex items-center gap-1"
                      >
                        <span className="material-icons text-[14px]">video_call</span>
                        {task.meetingTitle}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${statusColors[task.status]}`}>
                        {statusLabels[task.status]}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-md border ${priorityColors[task.priority]}`}>
                        {task.priority}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {task.dueDate ? (
                        <span className={`text-sm font-medium flex items-center gap-1 ${
                          overdue ? 'text-rose-600' : 'text-slate-600'
                        }`}>
                          {overdue && <span className="material-icons text-[14px]">warning</span>}
                          {formatDate(task.dueDate)}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-400">-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary by Meeting (collapsed by default) */}
      {!loading && tasksByMeeting.length > 1 && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-slate-900">Summary by Meeting</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {tasksByMeeting.map(meeting => {
              const completed = meeting.tasks.filter(t => t.status === 'completed').length;
              const total = meeting.tasks.length;
              const progress = Math.round((completed / total) * 100);
              
              return (
                <Link 
                  key={meeting.id}
                  to={`/meetings/${meeting.id}`}
                  className="bg-white p-5 rounded-xl border border-slate-200 hover:border-indigo-300 transition"
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-semibold text-slate-900 line-clamp-1">{meeting.title}</h3>
                    <span className="text-sm text-slate-500">{completed}/{total}</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div 
                      className="bg-indigo-600 h-2 rounded-full transition-all"
                      style={{ width: `${progress}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-slate-500 mt-2">{progress}% complete</p>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ManagerDashboard;
