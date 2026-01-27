
import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const StatCard: React.FC<{ title: string; value: string | number; icon: string; color: string }> = ({ title, value, icon, color }) => (
  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
    <div className="flex items-center justify-between mb-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        <span className="material-icons text-white">{icon}</span>
      </div>
    </div>
    <p className="text-slate-500 text-sm font-medium">{title}</p>
    <h3 className="text-3xl font-bold text-slate-900 mt-1">{value}</h3>
  </div>
);

const Dashboard: React.FC = () => {
  const { user } = useAuth();

  // Mock data - in a real app, this would be fetched from Firestore/API
  const stats = {
    totalMeetings: 12,
    pendingTasks: 8,
    completedTasks: 42,
    overdueTasks: 2
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Welcome back, {user?.displayName?.split(' ')[0]}!</h1>
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

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard title="Total Meetings" value={stats.totalMeetings} icon="video_call" color="bg-blue-500" />
        <StatCard title="Pending Tasks" value={stats.pendingTasks} icon="assignment" color="bg-amber-500" />
        <StatCard title="Completed Tasks" value={stats.completedTasks} icon="check_circle" color="bg-emerald-500" />
        <StatCard title="Overdue Tasks" value={stats.overdueTasks} icon="warning" color="bg-rose-500" />
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Recent Meetings */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-900">Recent Meetings</h2>
            <Link to="/meetings" className="text-sm font-bold text-indigo-600 hover:underline">View All</Link>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
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
                {[
                  { id: '1', title: 'Weekly Product Sync', date: 'Oct 24, 2023', status: 'completed' },
                  { id: '2', title: 'Q4 Strategy Planning', date: 'Oct 23, 2023', status: 'completed' },
                  { id: '3', title: 'Frontend Team Interview', date: 'Oct 22, 2023', status: 'processing' },
                ].map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50 transition cursor-pointer" onClick={() => {}}>
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-900">{m.title}</p>
                    </td>
                    <td className="px-6 py-4 text-slate-600 text-sm">{m.date}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        m.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700 animate-pulse'
                      }`}>
                        {m.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="material-icons text-slate-400">chevron_right</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            <h3 className="font-bold mb-4">Task Breakdown</h3>
            <div className="space-y-4">
              {[
                { label: 'High Priority', val: 40, color: 'bg-rose-500' },
                { label: 'Medium Priority', val: 35, color: 'bg-amber-500' },
                { label: 'Low Priority', val: 25, color: 'bg-slate-400' },
              ].map((p, i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs font-bold mb-1">
                    <span>{p.label}</span>
                    <span>{p.val}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`${p.color} h-full`} style={{ width: `${p.val}%` }}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
