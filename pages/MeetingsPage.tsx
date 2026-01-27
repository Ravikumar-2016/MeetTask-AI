
import React, { useState } from 'react';
import { Link } from 'react-router-dom';

const MeetingsPage: React.FC = () => {
  const [filter, setFilter] = useState('all');

  const meetings = [
    { id: '1', title: 'Q4 Product Roadmap', date: 'Oct 24, 2023', duration: '45m', tasks: 12, status: 'completed' },
    { id: '2', title: 'Marketing Sync', date: 'Oct 23, 2023', duration: '30m', tasks: 5, status: 'completed' },
    { id: '3', title: 'New Hire Interview', date: 'Oct 22, 2023', duration: '60m', tasks: 0, status: 'processing' },
    { id: '4', title: 'Budget Review', date: 'Oct 20, 2023', duration: '15m', tasks: 3, status: 'completed' },
    { id: '5', title: 'Customer Feedback Session', date: 'Oct 18, 2023', duration: '40m', tasks: 8, status: 'completed' },
  ];

  const filteredMeetings = filter === 'all' 
    ? meetings 
    : meetings.filter(m => m.status === filter);

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Meetings</h1>
          <p className="text-slate-500">A collection of all your recorded sessions.</p>
        </div>
        <Link to="/upload" className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-bold hover:bg-indigo-700 transition">
          New Upload
        </Link>
      </div>

      <div className="flex space-x-2 border-b border-slate-200">
        {['all', 'completed', 'processing'].map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-4 py-2 text-sm font-bold capitalize transition-all border-b-2 -mb-[2px] ${
              filter === tab ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="grid gap-4">
        {filteredMeetings.map((meeting) => (
          <Link
            key={meeting.id}
            to={`/meetings/${meeting.id}`}
            className="bg-white p-5 rounded-2xl border border-slate-200 flex items-center justify-between group hover:border-indigo-400 hover:shadow-md transition-all"
          >
            <div className="flex items-center space-x-4">
              <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center group-hover:bg-indigo-50 transition-colors">
                <span className="material-icons text-slate-400 group-hover:text-indigo-600">video_library</span>
              </div>
              <div>
                <h3 className="font-bold text-slate-900 group-hover:text-indigo-700 transition-colors">{meeting.title}</h3>
                <div className="flex items-center space-x-3 text-sm text-slate-500 mt-1">
                  <span className="flex items-center"><span className="material-icons text-xs mr-1">calendar_today</span> {meeting.date}</span>
                  <span className="flex items-center"><span className="material-icons text-xs mr-1">schedule</span> {meeting.duration}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-6">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-tighter">Action Items</span>
                <span className="text-lg font-bold text-slate-900">{meeting.tasks}</span>
              </div>
              <div className="flex items-center space-x-3">
                <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  meeting.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
                }`}>
                  {meeting.status}
                </span>
                <span className="material-icons text-slate-300">chevron_right</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default MeetingsPage;
