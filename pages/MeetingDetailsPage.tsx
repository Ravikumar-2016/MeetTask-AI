
import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';

const MeetingDetailsPage: React.FC = () => {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState<'tasks' | 'transcript'>('tasks');

  // Mock data for details
  const meeting = {
    id,
    title: 'Q4 Product Roadmap Strategy',
    date: 'October 24, 2023',
    status: 'completed',
    transcript: `
      Sarah: Okay, let's kick things off for the Q4 product planning.
      Mike: I've looked at the current back-log and we need to prioritize the API improvements.
      Sarah: Agreed. Mike, can you have a proposal for the API refactoring by Friday?
      Mike: Sure, I'll take that.
      David: We also need to update the marketing landing page before November 15th.
      Sarah: Right. David, that's yours. 
      ...
    `
  };

  const tasks = [
    { id: 't1', title: 'API Refactoring Proposal', owner: 'Mike Chen', deadline: 'Oct 27, 2023', priority: 'high', status: 'pending' },
    { id: 't2', title: 'Landing Page Update', owner: 'David Smith', deadline: 'Nov 15, 2023', priority: 'medium', status: 'pending' },
    { id: 't3', title: 'Security Audit Prep', owner: 'Sarah Wilson', deadline: 'Nov 01, 2023', priority: 'high', status: 'completed' },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link to="/meetings" className="w-10 h-10 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-slate-600 hover:bg-slate-50 transition">
            <span className="material-icons">arrow_back</span>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{meeting.title}</h1>
            <p className="text-slate-500">{meeting.date}</p>
          </div>
        </div>
        <div className="flex space-x-2">
          <button className="px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50 transition flex items-center">
            <span className="material-icons text-sm mr-2">download</span> Export
          </button>
          <button className="px-4 py-2 bg-indigo-600 rounded-lg text-sm font-bold text-white hover:bg-indigo-700 transition flex items-center">
             <span className="material-icons text-sm mr-2">share</span> Share
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <div className="flex space-x-1 bg-slate-100 p-1 rounded-xl w-fit">
            <button
              onClick={() => setActiveTab('tasks')}
              className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
                activeTab === 'tasks' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Action Items
            </button>
            <button
              onClick={() => setActiveTab('transcript')}
              className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
                activeTab === 'transcript' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Transcript
            </button>
          </div>

          {activeTab === 'tasks' ? (
            <div className="space-y-4">
              {tasks.map((task) => (
                <div key={task.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex items-start justify-between">
                  <div className="flex items-start space-x-4">
                    <button className={`mt-1 w-6 h-6 rounded-full border-2 flex items-center justify-center transition ${
                      task.status === 'completed' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 hover:border-indigo-400'
                    }`}>
                      {task.status === 'completed' && <span className="material-icons text-xs">check</span>}
                    </button>
                    <div>
                      <h4 className={`font-bold text-lg ${task.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{task.title}</h4>
                      <div className="flex flex-wrap gap-4 mt-2">
                        <div className="flex items-center text-sm text-slate-500">
                          <span className="material-icons text-[14px] mr-1">person</span> {task.owner}
                        </div>
                        <div className="flex items-center text-sm text-slate-500">
                          <span className="material-icons text-[14px] mr-1">event</span> {task.deadline}
                        </div>
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md ${
                          task.priority === 'high' ? 'bg-rose-50 text-rose-600 border border-rose-100' : 'bg-slate-50 text-slate-600 border border-slate-100'
                        }`}>
                          {task.priority} Priority
                        </span>
                      </div>
                    </div>
                  </div>
                  <button className="text-slate-400 hover:text-indigo-600 p-2 rounded-lg hover:bg-slate-50">
                    <span className="material-icons">more_vert</span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm leading-relaxed text-slate-700 whitespace-pre-wrap">
              {meeting.transcript}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-lg mb-4">Meeting Summary</h3>
            <p className="text-slate-600 text-sm leading-relaxed mb-4">
              The team discussed the Q4 roadmap focusing heavily on technical debt and marketing alignment. 
              API refactoring was identified as a critical bottleneck for the upcoming feature releases.
            </p>
            <div className="space-y-2">
              <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                <span className="text-slate-500">Duration</span>
                <span className="font-bold">45m 12s</span>
              </div>
              <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                <span className="text-slate-500">Speakers</span>
                <span className="font-bold">3 Identified</span>
              </div>
              <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                <span className="text-slate-500">Key Themes</span>
                <span className="font-bold">Architecture, Marketing</span>
              </div>
            </div>
          </div>

          <div className="bg-indigo-50 border border-indigo-100 p-6 rounded-2xl">
             <h3 className="font-bold text-indigo-900 mb-2">Automated Next Steps</h3>
             <ul className="space-y-2 text-sm text-indigo-800">
               <li className="flex items-start">
                 <span className="material-icons text-sm mr-2 mt-0.5">auto_awesome</span>
                 Draft email recap generated
               </li>
               <li className="flex items-start">
                 <span className="material-icons text-sm mr-2 mt-0.5">auto_awesome</span>
                 Jira tickets synced (2/3)
               </li>
             </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MeetingDetailsPage;
