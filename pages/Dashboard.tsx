
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useMeetings, getStatusBadgeClass } from '../hooks/useMeetings';
import { DashboardStats } from '../types';

const StatCard: React.FC<{ title: string; value: string | number; icon: string; color: string; loading?: boolean }> = ({ 
  title, value, icon, color, loading 
}) => (
  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
    <div className="flex items-center justify-between mb-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        <span className="material-icons text-white">{icon}</span>
      </div>
    </div>
    <p className="text-slate-500 text-sm font-medium">{title}</p>
    {loading ? (
      <div className="h-9 w-16 bg-slate-100 rounded animate-pulse mt-1"></div>
    ) : (
      <h3 className="text-3xl font-bold text-slate-900 mt-1">{value}</h3>
    )}
  </div>
);

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  
  // Use the shared hook for real-time meetings data
  // state can be: 'loading' | 'empty' | 'success' | 'error'
  const { meetings, loading, error, state } = useMeetings();

  // Calculate stats from meetings (dynamic, not hardcoded)
  const stats: DashboardStats = {
    totalMeetings: meetings.length,
    pendingTasks: meetings.filter(m => m.status === 'processing').length,
    completedTasks: meetings.filter(m => m.status === 'completed').length,
    overdueTasks: meetings.filter(m => m.status === 'error').length
  };

  // Get only the 5 most recent meetings for the table
  const recentMeetings = meetings.slice(0, 5);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Welcome back, {user?.displayName?.split(' ')[0] || 'there'}!</h1>
          <p className="text-slate-500">Here's what happened in your meetings this week.</p>
        </div>
        <Link 
          to="/upload" 
          className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition shadow-lg shadow-indigo-100 flex items-center justify-center space-x-2"
        >
          <span className="material-icons text-[20px]">add</span>
          <span>Upload Meeting</span>
        </Link>
      </div>

      {/* Error Banner - only show for real errors, not empty state */}
      {state === 'error' && error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl flex items-center space-x-2">
          <span className="material-icons">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Total Meetings" 
          value={stats.totalMeetings} 
          icon="video_call" 
          color="bg-blue-500" 
          loading={loading}
        />
        <StatCard 
          title="Processing" 
          value={stats.pendingTasks} 
          icon="hourglass_empty" 
          color="bg-amber-500" 
          loading={loading}
        />
        <StatCard 
          title="Completed" 
          value={stats.completedTasks} 
          icon="check_circle" 
          color="bg-emerald-500" 
          loading={loading}
        />
        <StatCard 
          title="Errors" 
          value={stats.overdueTasks} 
          icon="warning" 
          color="bg-rose-500" 
          loading={loading}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Recent Meetings */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Recent Meetings</h2>
            <Link to="/meetings" className="text-sm font-bold text-indigo-600 hover:underline">View All</Link>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            {loading ? (
              // Loading skeleton
              <div className="p-6 space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center space-x-4">
                    <div className="h-4 bg-slate-100 rounded w-1/3 animate-pulse"></div>
                    <div className="h-4 bg-slate-100 rounded w-1/4 animate-pulse"></div>
                    <div className="h-4 bg-slate-100 rounded w-16 animate-pulse"></div>
                  </div>
                ))}
              </div>
            ) : recentMeetings.length === 0 ? (
              // Empty state
              <div className="p-12 text-center">
                <span className="material-icons text-slate-300 text-5xl mb-4">video_library</span>
                <h3 className="font-bold text-slate-900 mb-2">No meetings yet</h3>
                <p className="text-slate-500 mb-4">Upload your first meeting to get started</p>
                <Link 
                  to="/upload" 
                  className="inline-flex items-center space-x-2 text-indigo-600 font-bold hover:underline"
                >
                  <span className="material-icons text-[18px]">add</span>
                  <span>Upload Meeting</span>
                </Link>
              </div>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Title</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Date</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-wider"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentMeetings.map((meeting) => (
                    <tr 
                      key={meeting.id} 
                      className="hover:bg-slate-50 transition cursor-pointer" 
                      onClick={() => navigate(`/meetings/${meeting.id}`)}
                    >
                      <td className="px-6 py-4">
                        <p className="font-semibold text-slate-900">{meeting.title}</p>
                      </td>
                      <td className="px-6 py-4 text-slate-600 text-sm">{meeting.date}</td>
                      <td className="px-6 py-4">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusBadgeClass(meeting.status)}`}>
                          {meeting.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="material-icons text-slate-400">chevron_right</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Quick Actions / Tips */}
        <div className="space-y-6">
          <h2 className="text-lg font-bold text-slate-900">Intelligence Insights</h2>
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-2xl p-6 text-white shadow-xl shadow-indigo-100">
            <h3 className="font-bold mb-2">Pro Tip: Deadlines</h3>
            <p className="text-indigo-100 text-sm leading-relaxed mb-4">
              AI automatically extracts deadlines. You can sync them to your calendar from the profile settings.
            </p>
            <button className="bg-white/10 hover:bg-white/20 transition px-4 py-2 rounded-lg text-sm font-bold w-full text-center">
              Explore Integrations
            </button>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200">
            <h3 className="font-bold mb-4">Meeting Status</h3>
            <div className="space-y-4">
              {[
                { label: 'Completed', val: stats.completedTasks, total: stats.totalMeetings, color: 'bg-emerald-500' },
                { label: 'Processing', val: stats.pendingTasks, total: stats.totalMeetings, color: 'bg-amber-500' },
                { label: 'Errors', val: stats.overdueTasks, total: stats.totalMeetings, color: 'bg-rose-500' },
              ].map((p, i) => {
                const percentage = stats.totalMeetings > 0 
                  ? Math.round((p.val / stats.totalMeetings) * 100) 
                  : 0;
                return (
                  <div key={i}>
                    <div className="flex justify-between text-xs font-bold mb-1">
                      <span>{p.label}</span>
                      <span>{p.val} ({percentage}%)</span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`${p.color} h-full transition-all duration-500`} style={{ width: `${percentage}%` }}></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
