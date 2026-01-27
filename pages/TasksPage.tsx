
import React, { useState, useEffect } from 'react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  Timestamp 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { Task, TaskPriority, TaskStatus } from '../types';

/**
 * Format deadline for display
 */
const formatDeadline = (deadline: string | Timestamp | undefined): string => {
  if (!deadline) return 'No deadline';
  
  try {
    const date = deadline instanceof Timestamp 
      ? deadline.toDate() 
      : new Date(deadline);
    
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return deadline.toString();
  }
};

const TasksPage: React.FC = () => {
  const { user, loading: authLoading } = useAuth();
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch tasks for current user
  useEffect(() => {
    // ============================================
    // CRITICAL: Wait for auth to finish loading
    // On page reload, Firebase restores auth session asynchronously.
    // We MUST wait for this to complete before querying Firestore.
    // ============================================
    if (authLoading) {
      console.log('[TasksPage] Auth loading, waiting...');
      setLoading(true);
      return;
    }

    // No user after auth finished = show empty state
    if (!user?.uid) {
      console.log('[TasksPage] No authenticated user, showing empty state');
      setTasks([]);
      setLoading(false);
      setError(null);
      return;
    }

    console.log('[TasksPage] Auth ready, setting up tasks listener for user:', user.uid);
    setLoading(true);
    setError(null);

    // Query tasks for current user
    // IMPORTANT: Always filter by userId for security
    // NOTE: No orderBy to avoid requiring composite index - we sort in JS
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('userId', '==', user.uid)
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
            userId: data.userId,
            title: data.title || 'Untitled Task',
            description: data.description || '',
            owner: data.owner || 'Unassigned',
            deadline: formatDeadline(data.deadline),
            priority: (data.priority as TaskPriority) || 'medium',
            status: (data.status as TaskStatus) || 'pending',
            createdAt: data.createdAt?.toDate?.()?.toISOString(),
          });
        });

        // Sort by createdAt descending (newest first) in JS
        tasksData.sort((a, b) => {
          const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return dateB - dateA;
        });

        console.log('[TasksPage] Received tasks:', tasksData.length);
        setTasks(tasksData);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('[TasksPage] Error fetching tasks:', err.code, err.message);
        // Treat permission-denied as empty state
        if (err.code === 'permission-denied') {
          setTasks([]);
          setLoading(false);
          return;
        }
        setError('Failed to load tasks');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [user?.uid, authLoading]);

  // Filter tasks by status and search query
  const filteredTasks = tasks
    .filter(t => statusFilter === 'all' || t.status === statusFilter)
    .filter(t => 
      searchQuery === '' || 
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.owner.toLowerCase().includes(searchQuery.toLowerCase())
    );

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">All Tasks</h1>
        <p className="text-slate-500">Track and manage action items across all your meetings.</p>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex space-x-1 bg-slate-100 p-1 rounded-xl">
          {['all', 'pending', 'completed'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold capitalize transition-all ${
                statusFilter === s ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex space-x-2 w-full sm:w-auto">
          <div className="relative flex-1 sm:flex-initial">
             <span className="material-icons absolute left-3 top-2.5 text-slate-400 text-[18px]">search</span>
             <input 
              type="text" 
              placeholder="Search tasks..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm w-full outline-none focus:ring-2 focus:ring-indigo-500"
             />
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl flex items-center space-x-2">
          <span className="material-icons">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center space-x-4 animate-pulse">
                <div className="w-6 h-6 bg-slate-100 rounded-full"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-100 rounded w-1/3"></div>
                  <div className="h-3 bg-slate-100 rounded w-1/4"></div>
                </div>
                <div className="h-4 bg-slate-100 rounded w-16"></div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Status</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Task Name</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Deadline</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Priority</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTasks.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50 transition">
                  <td className="px-6 py-4">
                    <button className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition ${
                      t.status === 'completed' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 hover:border-indigo-400'
                    }`}>
                      {t.status === 'completed' && <span className="material-icons text-xs">check</span>}
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    <p className={`font-semibold ${t.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{t.title}</p>
                    <p className="text-xs text-slate-500 mt-0.5">Assigned to {t.owner}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600 font-medium">{t.deadline}</td>
                  <td className="px-6 py-4">
                    <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-md border ${
                      t.priority === 'high' ? 'bg-rose-50 text-rose-600 border-rose-100' : 
                      t.priority === 'medium' ? 'bg-amber-50 text-amber-600 border-amber-100' : 
                      'bg-slate-50 text-slate-600 border-slate-100'
                    }`}>
                      {t.priority}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredTasks.length === 0 && (
            <div className="p-12 text-center">
              <span className="material-icons text-slate-300 text-5xl mb-4">assignment</span>
              <h3 className="font-bold text-slate-900 mb-2">No tasks found</h3>
              <p className="text-slate-500">
                {tasks.length === 0 
                  ? 'Tasks will appear here after processing meetings'
                  : 'No tasks match your current filters'}
              </p>
            </div>
          )}
        </div>
      )}
      </div>
  );
};

export default TasksPage;
