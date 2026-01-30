
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMeetings, getStatusBadgeClass, getFileTypeIcon, getStatusLabel } from '../hooks/useMeetings';
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
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Meetings</h1>
          <p className="text-sm sm:text-base text-slate-500">A collection of all your recorded sessions.</p>
        </div>
        <Link 
          to="/upload" 
          className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-5 sm:px-6 py-2.5 sm:py-3 rounded-xl font-bold hover:opacity-90 transition flex items-center justify-center space-x-2 shadow-lg shadow-indigo-200"
        >
          <span className="material-icons text-lg">add</span>
          <span>New Upload</span>
        </Link>
      </div>

      {/* Filter Tabs - Scrollable on mobile */}
      <div className="flex space-x-1 border-b border-slate-200 overflow-x-auto pb-px -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-none">
        {['all', 'completed', 'processing', 'uploaded'].map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3 sm:px-4 py-2.5 text-sm font-bold capitalize transition-all border-b-2 -mb-[2px] whitespace-nowrap ${
              filter === tab 
                ? 'border-indigo-600 text-indigo-600' 
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Error state - only show for real errors, not empty/permission-denied */}
      {state === 'error' && error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl flex items-center space-x-2 text-sm sm:text-base">
          <span className="material-icons text-lg">error</span>
          <span>{error}</span>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div className="grid gap-3 sm:gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white p-4 sm:p-5 rounded-xl sm:rounded-2xl border border-slate-200 animate-pulse">
              <div className="flex items-center space-x-3 sm:space-x-4">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-100 rounded-lg sm:rounded-xl"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-slate-100 rounded w-3/4 sm:w-1/3"></div>
                  <div className="h-3 bg-slate-100 rounded w-1/2 sm:w-1/4"></div>
                </div>
                <div className="h-6 bg-slate-100 rounded w-16 sm:w-20 hidden sm:block"></div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredMeetings.length === 0 ? (
        /* Empty state */
        <div className="bg-white p-8 sm:p-12 rounded-xl sm:rounded-2xl border border-slate-200 text-center">
          <div className="w-16 h-16 sm:w-20 sm:h-20 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="material-icons text-slate-300 text-3xl sm:text-4xl">video_library</span>
          </div>
          <h3 className="font-bold text-slate-900 mb-2 text-base sm:text-lg">
            {filter === 'all' ? 'No meetings yet' : `No ${filter} meetings`}
          </h3>
          <p className="text-slate-500 mb-4 text-sm sm:text-base">
            {filter === 'all' 
              ? 'Upload your first meeting to get started' 
              : 'Meetings with this status will appear here'}
          </p>
          {filter === 'all' && (
            <Link 
              to="/upload" 
              className="inline-flex items-center space-x-2 bg-indigo-50 text-indigo-600 px-4 py-2 rounded-lg font-bold hover:bg-indigo-100 transition"
            >
              <span className="material-icons text-[18px]">add</span>
              <span>Upload Meeting</span>
            </Link>
          )}
        </div>
      ) : (
        /* Meetings list */
        <div className="grid gap-3 sm:gap-4">
          {filteredMeetings.map((meeting) => (
            <Link
              key={meeting.id}
              to={`/meetings/${meeting.id}`}
              className="bg-white p-4 sm:p-5 rounded-xl sm:rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between group hover:border-indigo-400 hover:shadow-lg transition-all duration-200 gap-3 sm:gap-4"
            >
              <div className="flex items-center space-x-3 sm:space-x-4 flex-1 min-w-0">
                <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-100 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0 group-hover:bg-indigo-50 transition-colors">
                  <span className="material-icons text-slate-400 group-hover:text-indigo-600 text-lg sm:text-xl">
                    {getFileTypeIcon(meeting.fileType)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold text-slate-900 group-hover:text-indigo-700 transition-colors truncate text-sm sm:text-base">
                    {meeting.title}
                  </h3>
                  <div className="flex items-center text-xs sm:text-sm text-slate-500 mt-0.5">
                    <span className="material-icons text-[14px] mr-1">calendar_today</span>
                    <span>{meeting.date}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 pl-13 sm:pl-0">
                {/* Task count - visible on all sizes */}
                <div className="flex items-center gap-1.5 text-slate-500">
                  <span className="material-icons text-sm">assignment</span>
                  <span className="text-xs font-medium">{meeting.taskCount || 0} tasks</span>
                </div>
                
                <div className="flex items-center gap-2 sm:gap-3">
                  {/* Retry button for stuck meetings */}
                  {(meeting.status === 'uploaded' || meeting.status === 'error') && (
                    <button
                      onClick={(e) => handleRetryProcessing(e, meeting.id)}
                      disabled={retryingId === meeting.id}
                      className="px-2.5 sm:px-3 py-1.5 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold hover:bg-indigo-200 transition disabled:opacity-50 flex items-center gap-1"
                    >
                      {retryingId === meeting.id ? (
                        <>
                          <span className="animate-spin material-icons text-sm">refresh</span>
                          <span className="hidden sm:inline">Processing...</span>
                        </>
                      ) : (
                        <>
                          <span className="material-icons text-sm">play_arrow</span>
                          <span>Process</span>
                        </>
                      )}
                    </button>
                  )}
                  <span className={`px-2.5 sm:px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${getStatusBadgeClass(meeting.status)}`}>
                    {getStatusLabel(meeting.status)}
                  </span>
                  <span className="material-icons text-slate-300 hidden sm:block">chevron_right</span>
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
