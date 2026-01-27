
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMeetings, getStatusBadgeClass, getFileTypeIcon } from '../hooks/useMeetings';
import { processMeeting } from '../services/api';

const MeetingsPage: React.FC = () => {
  const [filter, setFilter] = useState('all');
  const [retryingId, setRetryingId] = useState<string | null>(null);
  
  // Fetch real meetings from Firestore
  // state can be: 'loading' | 'empty' | 'success' | 'error'
  const { meetings, loading, error, state } = useMeetings();

  // Filter meetings based on selected tab
  const filteredMeetings = filter === 'all' 
    ? meetings 
    : meetings.filter(m => m.status === filter);

  // Handle retry processing for stuck meetings
  const handleRetryProcessing = async (e: React.MouseEvent, meetingId: string) => {
    e.preventDefault(); // Prevent navigation
    e.stopPropagation();
    
    setRetryingId(meetingId);
    try {
      console.log('[Meetings] Retrying processing for:', meetingId);
      const result = await processMeeting(meetingId);
      console.log('[Meetings] Retry result:', result);
      if (!result.success) {
        const errorMsg = typeof result.error === 'object' 
          ? JSON.stringify(result.error) 
          : result.error || 'Unknown error';
        alert(`Processing failed: ${errorMsg}`);
      }
    } catch (err: any) {
      console.error('[Meetings] Retry error:', err);
      const errorMsg = err?.response?.data?.error || err?.message || JSON.stringify(err);
      alert(`Error: ${errorMsg}`);
    } finally {
      setRetryingId(null);
    }
  };

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
        {['all', 'completed', 'processing', 'uploaded'].map((tab) => (
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

      {/* Error state - only show for real errors, not empty/permission-denied */}
      {state === 'error' && error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl flex items-center space-x-2">
          <span className="material-icons">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white p-5 rounded-2xl border border-slate-200 animate-pulse">
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-slate-100 rounded-xl"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-100 rounded w-1/3"></div>
                  <div className="h-3 bg-slate-100 rounded w-1/4"></div>
                </div>
                <div className="h-6 bg-slate-100 rounded w-20"></div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredMeetings.length === 0 ? (
        /* Empty state */
        <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center">
          <span className="material-icons text-slate-300 text-5xl mb-4">video_library</span>
          <h3 className="font-bold text-slate-900 mb-2">
            {filter === 'all' ? 'No meetings yet' : `No ${filter} meetings`}
          </h3>
          <p className="text-slate-500 mb-4">
            {filter === 'all' 
              ? 'Upload your first meeting to get started' 
              : 'Meetings with this status will appear here'}
          </p>
          {filter === 'all' && (
            <Link 
              to="/upload" 
              className="inline-flex items-center space-x-2 text-indigo-600 font-bold hover:underline"
            >
              <span className="material-icons text-[18px]">add</span>
              <span>Upload Meeting</span>
            </Link>
          )}
        </div>
      ) : (
        /* Meetings list */
        <div className="grid gap-4">
          {filteredMeetings.map((meeting) => (
            <Link
              key={meeting.id}
              to={`/meetings/${meeting.id}`}
              className="bg-white p-5 rounded-2xl border border-slate-200 flex items-center justify-between group hover:border-indigo-400 hover:shadow-md transition-all"
            >
              <div className="flex items-center space-x-4">
                <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center group-hover:bg-indigo-50 transition-colors">
                  <span className="material-icons text-slate-400 group-hover:text-indigo-600">
                    {getFileTypeIcon(meeting.fileType)}
                  </span>
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 group-hover:text-indigo-700 transition-colors">{meeting.title}</h3>
                  <div className="flex items-center space-x-3 text-sm text-slate-500 mt-1">
                    <span className="flex items-center"><span className="material-icons text-xs mr-1">calendar_today</span> {meeting.date}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-6">
                <div className="hidden sm:flex flex-col items-end">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-tighter">Action Items</span>
                  <span className="text-lg font-bold text-slate-900">{meeting.taskCount || 0}</span>
                </div>
                <div className="flex items-center space-x-3">
                  {/* Retry button for stuck meetings */}
                  {(meeting.status === 'uploaded' || meeting.status === 'error') && (
                    <button
                      onClick={(e) => handleRetryProcessing(e, meeting.id)}
                      disabled={retryingId === meeting.id}
                      className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold hover:bg-indigo-200 transition disabled:opacity-50 flex items-center space-x-1"
                    >
                      {retryingId === meeting.id ? (
                        <>
                          <span className="animate-spin material-icons text-sm">refresh</span>
                          <span>Processing...</span>
                        </>
                      ) : (
                        <>
                          <span className="material-icons text-sm">play_arrow</span>
                          <span>Process</span>
                        </>
                      )}
                    </button>
                  )}
                  <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getStatusBadgeClass(meeting.status)}`}>
                    {meeting.status}
                  </span>
                  <span className="material-icons text-slate-300">chevron_right</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default MeetingsPage;
