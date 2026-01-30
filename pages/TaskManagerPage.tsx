/**
 * TaskManagerPage.tsx - Manager Task Creation & Management
 * 
 * MANAGERS ONLY - This page allows managers to:
 * - View all tasks they've created
 * - Create new tasks manually
 * - Assign tasks to employees
 * - View task submissions from employees
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  getDocs,
  Timestamp 
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { Task, Meeting, FirestoreUser } from '../types';
import { useToast } from '../hooks/useToast';
import ToastContainer from '../components/ToastContainer';
import { getFileIcon, canPreviewFile, openFile } from '../lib/fileUpload';

// Priority colors
const priorityColors: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  medium: 'bg-blue-100 text-blue-700 border-blue-200',
  low: 'bg-slate-100 text-slate-600 border-slate-200',
};

// Status colors
const statusColors: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  blocked: 'bg-red-100 text-red-700',
};

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  blocked: 'Blocked',
};

// Get Drive file icon from URL
const getDriveFileIcon = (url: string): string => {
  if (url.includes('docs.google.com/document')) return 'description';
  if (url.includes('docs.google.com/spreadsheets')) return 'table_chart';
  if (url.includes('docs.google.com/presentation')) return 'slideshow';
  if (url.includes('drive.google.com/drive/folders')) return 'folder';
  return 'insert_drive_file';
};

// Get Drive file type from URL
const getDriveFileType = (url: string): string => {
  if (url.includes('docs.google.com/document')) return 'Google Doc';
  if (url.includes('docs.google.com/spreadsheets')) return 'Google Sheets';
  if (url.includes('docs.google.com/presentation')) return 'Google Slides';
  if (url.includes('drive.google.com/drive/folders')) return 'Google Drive Folder';
  return 'Google Drive File';
};

// Check if submission is recent (within last hour)
const isRecentSubmission = (submittedAt: Timestamp | string | null | undefined): boolean => {
  if (!submittedAt) return false;
  try {
    const date = submittedAt instanceof Timestamp ? submittedAt.toDate() : new Date(submittedAt);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return date > hourAgo;
  } catch {
    return false;
  }
};

// Task Card Skeleton
const TaskCardSkeleton: React.FC = () => (
  <div className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse">
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 space-y-3">
        <div className="flex items-center gap-2">
          <div className="h-5 w-16 bg-slate-200 rounded"></div>
          <div className="h-5 w-48 bg-slate-200 rounded"></div>
          <div className="h-5 w-16 bg-slate-100 rounded"></div>
        </div>
        <div className="h-4 w-64 bg-slate-100 rounded"></div>
        <div className="h-4 w-full bg-slate-50 rounded"></div>
      </div>
      <div className="space-y-2 text-right">
        <div className="h-3 w-12 bg-slate-100 rounded"></div>
        <div className="h-4 w-20 bg-slate-200 rounded"></div>
      </div>
    </div>
  </div>
);

const TaskManagerPage: React.FC = () => {
  const { user, isManager, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toasts, success, error: showError, removeToast } = useToast();
  
  // Data state
  const [tasks, setTasks] = useState<Task[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [employees, setEmployees] = useState<FirestoreUser[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Create task form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [selectedMeetingId, setSelectedMeetingId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [requiresFile, setRequiresFile] = useState(false);
  const [assignedEmployee, setAssignedEmployee] = useState('');
  const [priority, setPriority] = useState<'medium' | 'high' | 'low' | 'critical'>('medium');
  const [dueDate, setDueDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  
  // Filter state
  const [filterMeeting, setFilterMeeting] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  // Redirect non-managers
  useEffect(() => {
    if (!authLoading && !isManager) {
      console.log('[TaskManager] Non-manager trying to access, redirecting...');
      navigate('/tasks');
    }
  }, [authLoading, isManager, navigate]);

  // Load manager's meetings
  useEffect(() => {
    if (authLoading || !user?.uid || !isManager) return;

    // Simple query without compound index requirement
    const loadMeetings = async () => {
      try {
        const meetingsQuery = query(
          collection(db, 'meetings'),
          where('userId', '==', user.uid)
        );
        
        const snapshot = await getDocs(meetingsQuery);
        const meetingsData: Meeting[] = [];
        
        snapshot.forEach((doc) => {
          const data = doc.data();
          // Only include completed meetings
          if (data.status === 'completed') {
            meetingsData.push({
              id: doc.id,
              title: data.title || 'Untitled Meeting',
              status: data.status,
              createdAt: data.createdAt,
              userId: data.userId,
            } as Meeting);
          }
        });
        
        // Sort by createdAt descending
        meetingsData.sort((a, b) => {
          const aTime = (a.createdAt as any)?.toDate?.()?.getTime() || 0;
          const bTime = (b.createdAt as any)?.toDate?.()?.getTime() || 0;
          return bTime - aTime;
        });
        
        setMeetings(meetingsData);
        console.log('[TaskManager] Meetings loaded:', meetingsData.length);
      } catch (err) {
        console.error('[TaskManager] Error loading meetings:', err);
      }
    };
    
    loadMeetings();
  }, [user?.uid, authLoading, isManager]);

  // Load tasks created by this manager - Real-time listener
  useEffect(() => {
    if (authLoading || !user?.uid || !isManager) {
      console.log('[TaskManager] Skipping task query - auth:', authLoading, 'uid:', user?.uid, 'isManager:', isManager);
      return;
    }

    console.log('[TaskManager] Setting up task listener for creatorId:', user.uid);

    // First, let's fetch ALL tasks to debug
    const fetchAllTasks = async () => {
      try {
        const allTasksSnapshot = await getDocs(collection(db, 'tasks'));
        console.log('[TaskManager] ALL tasks in Firestore:', allTasksSnapshot.size);
        allTasksSnapshot.forEach((doc) => {
          const data = doc.data();
          console.log('[TaskManager] Task:', doc.id, {
            taskId: data.taskId,
            meetingId: data.meetingId,
            creatorId: data.creatorId,
            assignedTo: data.assignedTo,
            title: data.title
          });
        });
      } catch (err) {
        console.error('[TaskManager] Error fetching all tasks:', err);
      }
    };
    fetchAllTasks();

    const tasksQuery = query(
      collection(db, 'tasks'),
      where('creatorId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(
      tasksQuery,
      (snapshot) => {
        console.log('[TaskManager] Tasks snapshot received, count:', snapshot.size);
        const tasksData: Task[] = [];
        
        snapshot.forEach((doc) => {
          const data = doc.data();
          console.log('[TaskManager] Task found:', doc.id, data.taskId, 'creatorId:', data.creatorId);
          tasksData.push({
            id: doc.id,
            taskId: data.taskId || doc.id,
            meetingId: data.meetingId,
            meetingTitle: data.meetingTitle,
            title: data.title,
            description: data.description,
            requiresFile: data.requiresFile || false,
            assignedTo: data.assignedTo,
            assignedToName: data.assignedToName,
            assignedToEmail: data.assignedToEmail,
            priority: data.priority,
            status: data.status,
            dueDate: data.dueDate,
            submissionText: data.submissionText,
            submissionFileUrl: data.submissionFileUrl,
            submissionFileName: data.submissionFileName,
            submittedAt: data.submittedAt,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
          } as Task);
        });
        
        // Sort by createdAt descending
        tasksData.sort((a, b) => {
          const aTime = (a.createdAt as any)?.toDate?.()?.getTime() || 0;
          const bTime = (b.createdAt as any)?.toDate?.()?.getTime() || 0;
          return bTime - aTime;
        });
        
        console.log('[TaskManager] Setting tasks state, count:', tasksData.length);
        setTasks(tasksData);
        setLoading(false);
      },
      (error) => {
        console.error('[TaskManager] Task query error:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid, authLoading, isManager]);

  // Load employees for assignment dropdown
  useEffect(() => {
    if (authLoading || !isManager) return;

    const loadEmployees = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'users'));
        const employeesList: FirestoreUser[] = [];
        
        snapshot.forEach((doc) => {
          const data = doc.data();
          // Only include employees
          if (data.role === 'employee') {
            employeesList.push({
              uid: data.uid || doc.id,
              mtaiId: data.mtaiId,
              email: data.email,
              name: data.name || data.displayName || data.email?.split('@')[0],
              displayName: data.displayName || data.name,
              role: 'employee',
            } as FirestoreUser);
          }
        });
        
        // Sort by name
        employeesList.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setEmployees(employeesList);
        console.log('[TaskManager] Employees loaded:', employeesList.length);
      } catch (err) {
        console.error('[TaskManager] Error loading employees:', err);
      }
    };

    loadEmployees();
  }, [authLoading, isManager]);

  // Create task handler
  const handleCreateTask = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');

    if (!selectedMeetingId) {
      setCreateError('Please select a meeting');
      return;
    }
    if (!taskTitle.trim()) {
      setCreateError('Please enter a task title');
      return;
    }
    if (!assignedEmployee) {
      setCreateError('Please select an employee to assign');
      return;
    }

    setCreating(true);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      const res = await fetch('/api/create-task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          meetingId: selectedMeetingId,
          title: taskTitle.trim(),
          description: taskDescription.trim(),
          requiresFile,
          assignedToMtaiId: assignedEmployee,
          priority,
          dueDate: dueDate || null,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to create task');
      }

      const result = await res.json();
      console.log('[TaskManager] Task created:', result);

      // Show success message
      success(`Task ${result.task?.taskId || 'created'} assigned to ${result.task?.assignedToName || 'employee'}`);

      // Reset form
      setTaskTitle('');
      setTaskDescription('');
      setRequiresFile(false);
      setAssignedEmployee('');
      setPriority('medium');
      setDueDate('');
      setShowCreateForm(false);
    } catch (err: any) {
      console.error('[TaskManager] Error creating task:', err);
      setCreateError(err.message);
      showError(err.message || 'Failed to create task');
    } finally {
      setCreating(false);
    }
  }, [selectedMeetingId, taskTitle, taskDescription, requiresFile, assignedEmployee, priority, dueDate, success, showError]);

  // Format date helper
  const formatDate = (timestamp: Timestamp | string | null | undefined): string => {
    if (!timestamp) return 'No date';
    try {
      const date = timestamp instanceof Timestamp 
        ? timestamp.toDate() 
        : new Date(timestamp);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return 'Invalid date';
    }
  };

  // Filter tasks
  const filteredTasks = tasks.filter((task) => {
    if (filterMeeting !== 'all' && task.meetingId !== filterMeeting) return false;
    if (filterStatus !== 'all' && task.status !== filterStatus) return false;
    return true;
  });

  // Loading state with skeletons
  if (authLoading || loading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Task Manager</h1>
            <p className="text-slate-500 mt-1">Create and manage tasks for your team</p>
          </div>
          <div className="h-10 w-32 bg-slate-200 rounded-xl animate-pulse"></div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white p-4 rounded-xl border border-slate-200 animate-pulse">
              <div className="h-8 w-12 bg-slate-200 rounded mb-2"></div>
              <div className="h-4 w-16 bg-slate-100 rounded"></div>
            </div>
          ))}
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <TaskCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  // Non-manager state (shouldn't see this due to redirect)
  if (!isManager) {
    return null;
  }

  return (
    <>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="space-y-6">
        
        {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Task Manager</h1>
          <p className="text-slate-500 mt-1">Create and manage tasks for your team</p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-md shadow-indigo-200 transition"
        >
          <span className="material-icons text-sm">add</span>
          Create Task
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-2xl font-bold text-slate-900">{tasks.length}</p>
          <p className="text-sm text-slate-500">Total Tasks</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-2xl font-bold text-amber-600">{tasks.filter(t => t.status === 'pending').length}</p>
          <p className="text-sm text-slate-500">Pending</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-2xl font-bold text-blue-600">{tasks.filter(t => t.status === 'in_progress').length}</p>
          <p className="text-sm text-slate-500">In Progress</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <p className="text-2xl font-bold text-green-600">{tasks.filter(t => t.status === 'completed').length}</p>
          <p className="text-sm text-slate-500">Completed</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={filterMeeting}
          onChange={(e) => setFilterMeeting(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
        >
          <option value="all">All Meetings</option>
          {meetings.map((m) => (
            <option key={m.id} value={m.id}>{m.title}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="blocked">Blocked</option>
        </select>
      </div>

      {/* Create Task Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900">Create New Task</h2>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="p-2 hover:bg-slate-100 rounded-lg transition"
                >
                  <span className="material-icons">close</span>
                </button>
              </div>
            </div>

            <form onSubmit={handleCreateTask} className="p-6 space-y-4">
              {createError && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-lg">
                  <p className="text-sm text-red-700">{createError}</p>
                </div>
              )}

              {/* Meeting Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Meeting *
                </label>
                <select
                  value={selectedMeetingId}
                  onChange={(e) => setSelectedMeetingId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  required
                >
                  <option value="">Select a meeting...</option>
                  {meetings.map((m) => (
                    <option key={m.id} value={m.id}>{m.title}</option>
                  ))}
                </select>
                {meetings.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">
                    No completed meetings yet. <Link to="/upload" className="underline">Upload a meeting</Link> first.
                  </p>
                )}
              </div>

              {/* Task Title */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Task Title *
                </label>
                <input
                  type="text"
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="e.g., Prepare quarterly report"
                  required
                />
              </div>

              {/* Task Description */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Description
                </label>
                <textarea
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-none"
                  placeholder="Describe what needs to be done..."
                />
              </div>

              {/* Assign To */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Assign To *
                </label>
                <select
                  value={assignedEmployee}
                  onChange={(e) => setAssignedEmployee(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  required
                >
                  <option value="">Select an employee...</option>
                  {employees.map((emp) => (
                    <option key={emp.mtaiId} value={emp.mtaiId}>
                      [{emp.mtaiId}] {emp.name || emp.displayName} ({emp.email})
                    </option>
                  ))}
                </select>
                {employees.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">
                    No employees found. Employees need to sign up first.
                  </p>
                )}
              </div>

              {/* File Upload Requirement */}
              <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={requiresFile}
                    onChange={(e) => setRequiresFile(e.target.checked)}
                    className="mt-1 w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                  />
                  <div>
                    <p className="font-medium text-slate-700 text-sm">Require file upload</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Text response is always required. Check this if employee should also upload a file (PDF, ZIP, images, etc.)
                    </p>
                  </div>
                </label>
              </div>

              {/* Priority */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Priority
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(['low', 'medium', 'high', 'critical'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium capitalize transition ${
                        priority === p
                          ? priorityColors[p]
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      } ${priority === p ? 'ring-2 ring-offset-1 ring-slate-300' : ''}`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Due Date */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Due Date (optional)
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              {/* Submit Button */}
              <div className="pt-4">
                <button
                  type="submit"
                  disabled={creating || !selectedMeetingId || !taskTitle.trim() || !assignedEmployee}
                  className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition flex items-center justify-center gap-2"
                >
                  {creating ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      Creating Task...
                    </>
                  ) : (
                    <>
                      <span className="material-icons text-sm">add_task</span>
                      Create Task
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Tasks List */}
      {filteredTasks.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
          <span className="material-icons text-5xl text-slate-300 mb-4">task_alt</span>
          <h3 className="text-lg font-semibold text-slate-700 mb-2">No tasks yet</h3>
          <p className="text-slate-500 mb-4">
            Create your first task to start managing your team's work.
          </p>
          <button
            onClick={() => setShowCreateForm(true)}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition"
          >
            Create Task
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTasks.map((task, index) => (
            <div
              key={task.id}
              className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-all duration-300 animate-fadeIn"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{task.taskId}</span>
                    <h3 className="font-semibold text-slate-900 truncate">{task.title}</h3>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${priorityColors[task.priority]}`}>
                      {task.priority}
                    </span>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[task.status]}`}>
                      {statusLabels[task.status]}
                    </span>
                    {task.submissionText && isRecentSubmission(task.submittedAt) && (
                      <span className="px-2 py-0.5 bg-green-600 text-white text-[10px] font-bold rounded-full animate-pulse">
                        NEW SUBMISSION
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500 mb-2">
                    {task.meetingTitle} • Assigned to: <span className="font-medium">{task.assignedToName}</span>
                    {task.requiresFile && (
                      <span className="inline-flex items-center ml-2 text-amber-600">
                        <span className="material-icons text-[12px] mr-0.5">attach_file</span>
                        File required
                      </span>
                    )}
                  </p>
                  {task.description && (
                    <p className="text-sm text-slate-600 line-clamp-2">{task.description}</p>
                  )}
                  
                  {/* Enhanced submission display */}
                  {task.submissionText && (
                    <div className={`mt-3 p-4 rounded-xl border transition-all ${
                      isRecentSubmission(task.submittedAt) 
                        ? 'bg-green-50 border-green-200 ring-2 ring-green-100' 
                        : 'bg-slate-50 border-slate-200'
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`material-icons text-sm ${isRecentSubmission(task.submittedAt) ? 'text-green-600' : 'text-slate-500'}`}>
                            assignment_turned_in
                          </span>
                          <span className={`text-xs font-semibold ${isRecentSubmission(task.submittedAt) ? 'text-green-700' : 'text-slate-600'}`}>
                            Employee Submission
                          </span>
                        </div>
                        {task.submittedAt && (
                          <span className="text-xs text-slate-400">
                            {formatDate(task.submittedAt)}
                          </span>
                        )}
                      </div>
                      <p className={`text-sm ${isRecentSubmission(task.submittedAt) ? 'text-green-800' : 'text-slate-700'}`}>
                        {task.submissionText}
                      </p>
                      
                      {/* Enhanced file attachment display */}
                      {task.submissionFileUrl && (
                        <div className="mt-3 p-3 bg-white rounded-lg border border-slate-200">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                              isRecentSubmission(task.submittedAt) ? 'bg-green-100' : 'bg-blue-100'
                            }`}>
                              <span className={`material-icons ${
                                isRecentSubmission(task.submittedAt) ? 'text-green-600' : 'text-blue-600'
                              }`}>
                                {getDriveFileIcon(task.submissionFileUrl)}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-slate-800 truncate">
                                {task.submissionFileName || getDriveFileType(task.submissionFileUrl)}
                              </p>
                              <p className="text-xs text-slate-500">Google Drive</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <a
                                href={task.submissionFileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg transition"
                                title="Open in Google Drive"
                              >
                                <span className="material-icons text-sm">open_in_new</span>
                                Open
                              </a>
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(task.submissionFileUrl!);
                                  success('Link copied to clipboard!');
                                }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-lg transition"
                                title="Copy link"
                              >
                                <span className="material-icons text-sm">content_copy</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-slate-400">Created</p>
                  <p className="text-sm text-slate-600">{formatDate(task.createdAt)}</p>
                  {task.dueDate && (
                    <>
                      <p className="text-xs text-slate-400 mt-2">Due</p>
                      <p className="text-sm text-slate-600">{formatDate(task.dueDate)}</p>
                    </>
                  )}
                </div>
              </div>
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
        .animate-fadeIn {
          animation: fadeIn 0.3s ease-out forwards;
        }
      `}</style>
      </div>
    </>
  );
};

export default TaskManagerPage;
