/**
 * Dashboard.tsx - Role-Aware Dashboard
 * 
 * Shows different content based on user role:
 * - Managers: Meetings overview, task creation stats
 * - Employees: Task overview, pending work
 */

import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { 
  collection, 
  query, 
  where, 
  onSnapshot,
  Timestamp 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useMeetings, getStatusBadgeClass, getFileTypeIcon } from '../hooks/useMeetings';

// ============================================
// STAT CARD COMPONENT
// ============================================
const StatCard: React.FC<{ 
  title: string; 
  value: string | number; 
  icon: string; 
  color: string; 
  loading?: boolean 
}> = ({ title, value, icon, color, loading }) => (
  <div className="bg-white p-4 sm:p-6 rounded-xl sm:rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200">
    <div className="flex items-center gap-3 sm:gap-0 sm:flex-col sm:items-start">
      <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl flex items-center justify-center ${color} shrink-0 sm:mb-4`}>
        <span className="material-icons text-white text-lg sm:text-xl">{icon}</span>
      </div>
      <div className="flex-1 sm:w-full">
        <p className="text-slate-500 text-xs sm:text-sm font-medium">{title}</p>
        {loading ? (
          <div className="h-7 sm:h-9 w-12 sm:w-16 bg-slate-100 rounded animate-pulse mt-1"></div>
        ) : (
          <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 mt-0.5 sm:mt-1">{value}</h3>
        )}
      </div>
    </div>
  </div>
);

// ============================================
// MANAGER DASHBOARD
// ============================================
const ManagerDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { meetings, loading: meetingsLoading } = useMeetings();
  const [taskCount, setTaskCount] = useState(0);
  const [tasksLoading, setTasksLoading] = useState(true);

  // Load task count for manager
  useEffect(() => {
    if (!user?.uid) return;

    const tasksQuery = query(
      collection(db, 'tasks'),
      where('creatorId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(tasksQuery, (snapshot) => {
      setTaskCount(snapshot.size);
      setTasksLoading(false);
    });

    return () => unsubscribe();
  }, [user?.uid]);

  const stats = {
    totalMeetings: meetings.length,
    processing: meetings.filter(m => m.status === 'processing' || m.status === 'needs_mapping').length,
    completed: meetings.filter(m => m.status === 'completed').length,
    tasks: taskCount,
  };

  const recentMeetings = meetings.slice(0, 5);
  const displayName = user?.name || user?.displayName || 'there';

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
            Welcome back, {displayName.split(' ')[0]}!
          </h1>
          <p className="text-sm sm:text-base text-slate-500">Manage your meetings and assign tasks to your team.</p>
        </div>
        <Link 
          to="/upload" 
          className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl font-bold hover:opacity-90 transition shadow-lg shadow-indigo-200 flex items-center justify-center gap-2"
        >
          <span className="material-icons text-lg">add</span>
          <span>Upload Meeting</span>
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        <StatCard 
          title="Total Meetings" 
          value={stats.totalMeetings} 
          icon="video_call" 
          color="bg-blue-500" 
          loading={meetingsLoading}
        />
        <StatCard 
          title="Processing" 
          value={stats.processing} 
          icon="hourglass_empty" 
          color="bg-amber-500" 
          loading={meetingsLoading}
        />
        <StatCard 
          title="Completed" 
          value={stats.completed} 
          icon="check_circle" 
          color="bg-emerald-500" 
          loading={meetingsLoading}
        />
        <StatCard 
          title="Tasks Created" 
          value={stats.tasks} 
          icon="assignment" 
          color="bg-purple-500" 
          loading={tasksLoading}
        />
      </div>

      {/* Content Grid */}
      <div className="grid lg:grid-cols-3 gap-6 sm:gap-8">
        {/* Recent Meetings */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base sm:text-lg font-bold text-slate-900">Recent Meetings</h2>
            <Link to="/meetings" className="text-sm font-bold text-indigo-600 hover:underline">View All</Link>
          </div>
          <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
            {meetingsLoading ? (
              <div className="p-4 sm:p-6 space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 sm:gap-4">
                    <div className="h-10 w-10 bg-slate-100 rounded-lg animate-pulse shrink-0"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-slate-100 rounded w-3/4 animate-pulse"></div>
                      <div className="h-3 bg-slate-100 rounded w-1/2 animate-pulse"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : recentMeetings.length === 0 ? (
              <div className="p-8 sm:p-12 text-center">
                <div className="w-14 h-14 sm:w-16 sm:h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <span className="material-icons text-slate-300 text-3xl sm:text-4xl">video_library</span>
                </div>
                <h3 className="font-bold text-slate-900 mb-2 text-sm sm:text-base">No meetings yet</h3>
                <p className="text-slate-500 mb-4 text-sm">Upload your first meeting to get started</p>
                <Link 
                  to="/upload" 
                  className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-600 px-4 py-2 rounded-lg font-bold hover:bg-indigo-100 transition text-sm"
                >
                  <span className="material-icons text-[18px]">add</span>
                  <span>Upload Meeting</span>
                </Link>
              </div>
            ) : (
              /* Mobile-friendly meeting cards instead of table */
              <div className="divide-y divide-slate-100">
                {recentMeetings.map((meeting) => (
                  <div 
                    key={meeting.id} 
                    className="p-4 hover:bg-slate-50 transition cursor-pointer flex items-center gap-3" 
                    onClick={() => navigate(`/meetings/${meeting.id}`)}
                  >
                    <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center shrink-0">
                      <span className="material-icons text-slate-400 text-lg">
                        {getFileTypeIcon(meeting.fileType)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 truncate text-sm sm:text-base">{meeting.title}</p>
                      <p className="text-slate-500 text-xs sm:text-sm">{meeting.date}</p>
                    </div>
                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase whitespace-nowrap ${getStatusBadgeClass(meeting.status)}`}>
                      {meeting.status}
                    </span>
                    <span className="material-icons text-slate-300 hidden sm:block">chevron_right</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="space-y-4 sm:space-y-6">
          <h2 className="text-base sm:text-lg font-bold text-slate-900">Quick Actions</h2>
          <div className="bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl sm:rounded-2xl p-5 sm:p-6 text-white shadow-xl">
            <h3 className="font-bold mb-2 text-sm sm:text-base">Create Tasks</h3>
            <p className="text-indigo-100 text-xs sm:text-sm leading-relaxed mb-4">
              After processing a meeting, create and assign tasks to your team members.
            </p>
            <Link 
              to="/task-manager"
              className="block bg-white/10 hover:bg-white/20 transition px-4 py-2 rounded-lg text-sm font-bold text-center"
            >
              Open Task Manager
            </Link>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200">
            <h3 className="font-bold mb-4">Workflow</h3>
            <ol className="space-y-3 text-sm text-slate-600">
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                <span className="text-xs sm:text-sm">Upload meeting recording</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                <span className="text-xs sm:text-sm">Map speakers to employees</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">3</span>
                <span className="text-xs sm:text-sm">Create and assign tasks</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold shrink-0">4</span>
                <span className="text-xs sm:text-sm">Employees complete work</span>
              </li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================
// EMPLOYEE DASHBOARD
// ============================================
const EmployeeDashboard: React.FC = () => {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.mtaiId) {
      setLoading(false);
      return;
    }

    const tasksQuery = query(
      collection(db, 'tasks'),
      where('assignedTo', '==', user.mtaiId)
    );

    const unsubscribe = onSnapshot(tasksQuery, (snapshot) => {
      const tasksData: any[] = [];
      snapshot.forEach((doc) => {
        tasksData.push({ id: doc.id, ...doc.data() });
      });
      setTasks(tasksData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user?.mtaiId]);

  const stats = {
    total: tasks.length,
    pending: tasks.filter(t => t.status === 'pending').length,
    inProgress: tasks.filter(t => t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
  };

  const pendingTasks = tasks.filter(t => t.status !== 'completed').slice(0, 5);
  const displayName = user?.name || user?.displayName || 'there';

  const priorityColors: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    high: 'bg-orange-100 text-orange-700',
    medium: 'bg-blue-100 text-blue-700',
    low: 'bg-slate-100 text-slate-600',
  };

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
          Welcome back, {displayName.split(' ')[0]}!
        </h1>
        <p className="text-sm sm:text-base text-slate-500">Here's your task overview.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-6">
        <StatCard 
          title="Total Tasks" 
          value={stats.total} 
          icon="assignment" 
          color="bg-blue-500" 
          loading={loading}
        />
        <StatCard 
          title="Pending" 
          value={stats.pending} 
          icon="pending_actions" 
          color="bg-amber-500" 
          loading={loading}
        />
        <StatCard 
          title="In Progress" 
          value={stats.inProgress} 
          icon="sync" 
          color="bg-purple-500" 
          loading={loading}
        />
        <StatCard 
          title="Completed" 
          value={stats.completed} 
          icon="check_circle" 
          color="bg-emerald-500" 
          loading={loading}
        />
      </div>

      {/* Tasks Section */}
      <div className="grid lg:grid-cols-3 gap-6 sm:gap-8">
        {/* Pending Tasks */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base sm:text-lg font-bold text-slate-900">Pending Tasks</h2>
            <Link to="/tasks" className="text-sm font-bold text-indigo-600 hover:underline">View All</Link>
          </div>
          <div className="bg-white rounded-xl sm:rounded-2xl border border-slate-200 overflow-hidden">
            {loading ? (
              <div className="p-4 sm:p-6 space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center gap-3 sm:gap-4">
                    <div className="h-10 w-10 bg-slate-100 rounded-lg animate-pulse shrink-0"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-slate-100 rounded w-3/4 animate-pulse"></div>
                      <div className="h-3 bg-slate-100 rounded w-1/2 animate-pulse"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : pendingTasks.length === 0 ? (
              <div className="p-8 sm:p-12 text-center">
                <div className="w-14 h-14 sm:w-16 sm:h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <span className="material-icons text-emerald-500 text-3xl sm:text-4xl">task_alt</span>
                </div>
                <h3 className="font-bold text-slate-900 mb-2 text-sm sm:text-base">All caught up!</h3>
                <p className="text-slate-500 text-sm">You don't have any pending tasks.</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {pendingTasks.map((task) => (
                  <Link 
                    key={task.id}
                    to="/tasks"
                    className="flex items-center justify-between p-4 hover:bg-slate-50 transition gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900 truncate text-sm sm:text-base">{task.title}</p>
                      <p className="text-xs sm:text-sm text-slate-500">From: {task.creatorName || 'Manager'}</p>
                    </div>
                    <span className={`px-2 py-1 rounded text-xs font-bold whitespace-nowrap ${priorityColors[task.priority] || priorityColors.medium}`}>
                      {task.priority}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Info Card */}
        <div className="space-y-4 sm:space-y-6">
          <h2 className="text-base sm:text-lg font-bold text-slate-900">Your Progress</h2>
          <div className="bg-white p-5 sm:p-6 rounded-xl sm:rounded-2xl border border-slate-200">
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="font-medium text-slate-700">Completion Rate</span>
                  <span className="font-bold text-emerald-600">
                    {stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}%
                  </span>
                </div>
                <div className="w-full h-2 sm:h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-emerald-500 to-emerald-400 h-full transition-all duration-500"
                    style={{ width: `${stats.total > 0 ? (stats.completed / stats.total) * 100 : 0}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl sm:rounded-2xl p-5 sm:p-6 text-white shadow-xl">
            <h3 className="font-bold mb-2 text-sm sm:text-base">Need Help?</h3>
            <p className="text-indigo-100 text-xs sm:text-sm leading-relaxed">
              Click on any task to view details and submit your work via Google Drive link.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// ============================================
// MAIN DASHBOARD COMPONENT
// ============================================
const Dashboard: React.FC = () => {
  const { isManager, isEmployee, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (isManager) {
    return <ManagerDashboard />;
  }

  if (isEmployee) {
    return <EmployeeDashboard />;
  }

  // Fallback for users without role (shouldn't happen normally)
  return (
    <div className="text-center py-20">
      <span className="material-icons text-slate-300 text-5xl mb-4">error_outline</span>
      <h2 className="text-xl font-bold text-slate-700 mb-2">Account Setup Required</h2>
      <p className="text-slate-500">Please contact support to set up your account role.</p>
    </div>
  );
};

export default Dashboard;
