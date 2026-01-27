
import React, { useState } from 'react';

const TasksPage: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState('all');

  const tasks = [
    { id: 't1', title: 'Update project documentation', meeting: 'Weekly Sync', owner: 'You', deadline: 'Today', priority: 'high', status: 'pending' },
    { id: 't2', title: 'Research competitor API prices', meeting: 'Product Strategy', owner: 'You', deadline: 'Tomorrow', priority: 'medium', status: 'pending' },
    { id: 't3', title: 'Setup staging environment', meeting: 'Dev Standup', owner: 'You', deadline: 'Oct 30', priority: 'high', status: 'completed' },
    { id: 't4', title: 'Draft social media copy', meeting: 'Marketing Sync', owner: 'Jane Doe', deadline: 'Oct 28', priority: 'low', status: 'pending' },
  ];

  const filteredTasks = statusFilter === 'all' 
    ? tasks 
    : tasks.filter(t => t.status === statusFilter);

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
              className="pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm w-full outline-none focus:ring-2 focus:ring-indigo-500"
             />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Status</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Task Name</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Meeting</th>
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
                <td className="px-6 py-4 text-sm text-slate-600">{t.meeting}</td>
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
          <div className="p-12 text-center text-slate-500 font-medium">
            No tasks found. Everything is on track!
          </div>
        )}
      </div>
    </div>
  );
};

export default TasksPage;
