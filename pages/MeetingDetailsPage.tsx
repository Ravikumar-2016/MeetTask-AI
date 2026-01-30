/**
 * MeetingDetailsPage.tsx - Meeting Details with Task Assignment
 * 
 * MANAGER WORKFLOW:
 * 1. View meeting transcript (read-only after mapping)
 * 2. See mapped participants
 * 3. Assign tasks directly from this page
 * 4. View all tasks for this meeting
 */

import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { 
  doc, 
  getDoc, 
  collection, 
  query, 
  where, 
  onSnapshot,
  getDocs,
  Timestamp 
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { Meeting, Task, SpeakerUtterance, SpeakerMapping, FirestoreUser, TaskPriority } from '../types';
import { getStatusBadgeClass, getStatusLabel } from '../hooks/useMeetings';
import { useToast } from '../hooks/useToast';
import ToastContainer from '../components/ToastContainer';

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

/**
 * Format Firestore timestamp to readable date string
 */
const formatDate = (timestamp: Timestamp | string | undefined): string => {
  if (!timestamp) return 'Unknown date';
  try {
    const date = timestamp instanceof Timestamp 
      ? timestamp.toDate() 
      : new Date(timestamp);
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return 'Invalid date';
  }
};

const MeetingDetailsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user, isManager, loading: authLoading } = useAuth();
  const { toasts, success, error: showError, removeToast } = useToast();
  const [activeTab, setActiveTab] = useState<'tasks' | 'transcript'>('tasks');
  
  // State for meeting data
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Speaker diarization state
  const [utterances, setUtterances] = useState<SpeakerUtterance[]>([]);
  const [speakerMapping, setSpeakerMapping] = useState<SpeakerMapping>({});
  const [showSpeakerView, setShowSpeakerView] = useState(true);
  
  // Speaker mapping UI state (for needs_mapping status)
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [usersList, setUsersList] = useState<FirestoreUser[]>([]);
  const [pendingMapping, setPendingMapping] = useState<SpeakerMapping>({});
  const [savingMapping, setSavingMapping] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);

  // Task creation state
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [requiresFile, setRequiresFile] = useState(false);
  const [assignedEmployee, setAssignedEmployee] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskError, setTaskError] = useState('');

  // Get list of mapped employees (participants)
  const mappedEmployees = usersList.filter(u => 
    Object.values(speakerMapping).includes(u.mtaiId)
  );

  // Load meeting data
  useEffect(() => {
    if (authLoading || !id) return;

    const loadMeeting = async () => {
      try {
        // Load meeting document
        const meetingDoc = await getDoc(doc(db, 'meetings', id));
        
        if (!meetingDoc.exists()) {
          setError('Meeting not found');
          setLoading(false);
          return;
        }

        const data = meetingDoc.data();
        
        setMeeting({
          id: meetingDoc.id,
          title: data.title || 'Untitled Meeting',
          date: formatDate(data.createdAt),
          status: data.status,
          fileType: data.fileType,
          fileUrl: data.fileUrl,
          userId: data.userId,
          creatorMtaiId: data.creatorMtaiId,
          creatorName: data.creatorName,
          speakerCount: data.speakerCount,
          speakers: data.speakers || [],
          speakerMapping: data.speakerMapping || {},
          taskCount: data.taskCount || 0,
          errorMessage: data.errorMessage,
          duration: data.duration,
        } as Meeting);

        // Set speakers for mapping UI
        if (data.speakers?.length > 0) {
          setSpeakers(data.speakers);
        }
        
        // Set speaker mapping
        if (data.speakerMapping) {
          setSpeakerMapping(data.speakerMapping);
        }

        // Load transcript
        const transcriptDoc = await getDoc(doc(db, 'transcripts', id));
        if (transcriptDoc.exists()) {
          const transcriptData = transcriptDoc.data();
          setTranscript(transcriptData.text || '');
          
          if (transcriptData.utterances) {
            setUtterances(transcriptData.utterances);
          }
          
          if (transcriptData.speakerMapping) {
            setSpeakerMapping(transcriptData.speakerMapping);
          }
        }

        setLoading(false);
      } catch (err: any) {
        console.error('[MeetingDetails] Error loading meeting:', err);
        setError(err.message || 'Failed to load meeting');
        setLoading(false);
      }
    };

    loadMeeting();
  }, [id, authLoading]);

  // Listen for task updates for this meeting
  useEffect(() => {
    if (!id) {
      console.log('[MeetingDetails] No meeting ID, skipping task query');
      return;
    }

    console.log('[MeetingDetails] Setting up task listener for meetingId:', id);

    const tasksQuery = query(
      collection(db, 'tasks'),
      where('meetingId', '==', id)
    );

    const unsubscribe = onSnapshot(
      tasksQuery, 
      (snapshot) => {
        console.log('[MeetingDetails] Tasks snapshot received, count:', snapshot.size);
        const tasksData: Task[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          console.log('[MeetingDetails] Task found:', doc.id, data.taskId, 'meetingId:', data.meetingId);
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
            creatorId: data.creatorId,
            creatorName: data.creatorName,
          } as Task);
        });
        
        // Sort by creation date
        tasksData.sort((a, b) => {
          const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
          const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
          return bTime - aTime;
        });
        
        console.log('[MeetingDetails] Setting tasks state, count:', tasksData.length);
        setTasks(tasksData);
      },
      (error) => {
        console.error('[MeetingDetails] Task query error:', error);
      }
    );

    return () => unsubscribe();
  }, [id]);

  // Load employees for mapping/assignment
  useEffect(() => {
    if (authLoading) return;

    const loadEmployees = async () => {
      try {
        const snapshot = await getDocs(collection(db, 'users'));
        const employeesList: FirestoreUser[] = [];
        
        snapshot.forEach((doc) => {
          const data = doc.data();
          if (data.role === 'employee') {
            employeesList.push({
              uid: data.uid || doc.id,
              mtaiId: data.mtaiId,
              email: data.email,
              name: data.name || data.displayName,
              displayName: data.displayName || data.name,
              role: 'employee',
            } as FirestoreUser);
          }
        });
        
        setUsersList(employeesList);
      } catch (err) {
        console.error('[MeetingDetails] Error loading employees:', err);
      }
    };

    loadEmployees();
  }, [authLoading]);

  // Handle speaker mapping change
  const handleMappingChange = (speakerId: string, mtaiId: string) => {
    setPendingMapping(prev => ({
      ...prev,
      [speakerId]: mtaiId
    }));
  };

  // Save speaker mapping
  const saveSpeakerMapping = async () => {
    if (!id) return;
    setSavingMapping(true);
    setMappingError(null);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      // Filter out empty mappings
      const filteredMapping: SpeakerMapping = {};
      Object.entries(pendingMapping).forEach(([speakerId, mtaiId]: [string, string]) => {
        if (mtaiId) filteredMapping[speakerId] = mtaiId;
      });

      if (Object.keys(filteredMapping).length === 0) {
        throw new Error('Please map at least one speaker');
      }

      const res = await fetch('/api/save-speaker-mapping', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          meetingId: id,
          speakerMapping: filteredMapping,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save mapping');
      }

      // Update local state
      setSpeakerMapping(filteredMapping);
      
      // Reload page to get updated status
      window.location.reload();
    } catch (err: any) {
      console.error('[MeetingDetails] Error saving mapping:', err);
      setMappingError(err.message);
    } finally {
      setSavingMapping(false);
    }
  };

  // Create task handler
  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setTaskError('');

    if (!taskTitle.trim()) {
      setTaskError('Please enter a task title');
      return;
    }
    if (!assignedEmployee) {
      setTaskError('Please select an employee');
      return;
    }

    setCreatingTask(true);

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
          meetingId: id,
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
      console.log('[MeetingDetails] Task created:', result);

      // Show success message
      success(`Task created successfully! Assigned to ${result.task?.assignedToName || 'employee'}`);

      // Reset form and close modal
      setTaskTitle('');
      setTaskDescription('');
      setRequiresFile(false);
      setAssignedEmployee('');
      setPriority('medium');
      setDueDate('');
      setShowTaskModal(false);
    } catch (err: any) {
      console.error('[MeetingDetails] Error creating task:', err);
      setTaskError(err.message);
      showError(err.message || 'Failed to create task');
    } finally {
      setCreatingTask(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Error state
  if (error || !meeting) {
    return (
      <div className="space-y-8">
        <Link 
          to="/meetings" 
          className="inline-flex items-center space-x-2 text-slate-600 hover:text-slate-900"
        >
          <span className="material-icons">arrow_back</span>
          <span>Back to Meetings</span>
        </Link>
        <div className="bg-rose-50 border border-rose-200 text-rose-700 p-8 rounded-2xl text-center">
          <span className="material-icons text-4xl mb-4">error_outline</span>
          <h2 className="font-bold text-xl mb-2">Unable to Load Meeting</h2>
          <p>{error || 'Meeting not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      <div className="space-y-4 sm:space-y-8">
        
        {/* Header - Clean, no Share/Export */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center space-x-3 sm:space-x-4">
          <Link 
            to="/meetings" 
            className="w-9 h-9 sm:w-10 sm:h-10 bg-white border border-slate-200 rounded-lg sm:rounded-xl flex items-center justify-center text-slate-600 hover:bg-slate-50 transition shrink-0"
          >
            <span className="material-icons text-lg sm:text-xl">arrow_back</span>
          </Link>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-2xl font-bold text-slate-900 truncate">{meeting.title}</h1>
            <p className="text-xs sm:text-base text-slate-500">{meeting.date}</p>
          </div>
        </div>
        
        {/* Only show Assign Task button for completed meetings and managers */}
        {meeting.status === 'completed' && isManager && (
          <button
            onClick={() => setShowTaskModal(true)}
            className="flex items-center justify-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl shadow-md shadow-indigo-200 transition w-full sm:w-auto"
          >
            <span className="material-icons text-sm">add_task</span>
            Assign Task
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-4 sm:gap-8">
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          {/* Tabs for Tasks and Transcript */}
          <div className="flex space-x-1 bg-slate-100 p-1 rounded-xl w-full sm:w-fit overflow-x-auto">
            <button
              onClick={() => setActiveTab('tasks')}
              className={`flex-1 sm:flex-initial px-4 sm:px-6 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
                activeTab === 'tasks' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Tasks ({tasks.length})
            </button>
            <button
              onClick={() => setActiveTab('transcript')}
              className={`flex-1 sm:flex-initial px-4 sm:px-6 py-2 rounded-lg text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
                activeTab === 'transcript' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Transcript
            </button>
          </div>

          {activeTab === 'tasks' ? (
            <div className="space-y-3 sm:space-y-4">
              {tasks.length === 0 ? (
                <div className="bg-white p-6 sm:p-12 rounded-xl sm:rounded-2xl border border-slate-200 text-center">
                  <span className="material-icons text-slate-300 text-4xl sm:text-5xl mb-3 sm:mb-4">assignment</span>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base mb-2">No tasks yet</h3>
                  <p className="text-xs sm:text-base text-slate-500 mb-4">
                    {meeting.status === 'completed' 
                      ? 'Create tasks for the participants of this meeting'
                      : 'Tasks can be assigned after speaker mapping is complete'}
                  </p>
                  {meeting.status === 'completed' && isManager && (
                    <button
                      onClick={() => setShowTaskModal(true)}
                      className="px-4 sm:px-5 py-2 sm:py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition"
                    >
                      Assign First Task
                    </button>
                  )}
                </div>
              ) : (
                tasks.map((task) => (
                  <div key={task.id} className="bg-white p-3 sm:p-5 rounded-xl sm:rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-300">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
                      <div className="flex items-center gap-2 sm:gap-4">
                        <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl border-2 flex items-center justify-center shrink-0 transition-all ${
                          task.status === 'completed' 
                            ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm shadow-emerald-200' 
                            : 'border-slate-200 bg-slate-50'
                        }`}>
                          {task.status === 'completed' && <span className="material-icons text-sm sm:text-lg">check</span>}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <span className="text-[10px] sm:text-xs font-mono bg-indigo-50 text-indigo-600 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md sm:rounded-lg font-bold">
                              {task.taskId}
                            </span>
                            <span className="text-xs sm:text-sm font-semibold text-slate-700 truncate">
                              To: {task.assignedToName || task.assignedTo}
                            </span>
                          </div>
                          {task.title && (
                            <p className="text-xs sm:text-sm text-slate-500 mt-0.5 sm:mt-1 truncate">{task.title}</p>
                          )}
                        </div>
                      </div>
                      <span className={`self-start sm:self-auto px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-[10px] sm:text-xs font-bold ${
                        task.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                        task.status === 'in_progress' ? 'bg-blue-50 text-blue-700' :
                        task.status === 'pending' ? 'bg-amber-50 text-amber-700' :
                        'bg-red-50 text-red-700'
                      }`}>
                        {statusLabels[task.status]}
                      </span>
                    </div>

                    {/* Show submission if exists */}
                    {task.submissionText && (
                      <div className="mt-3 sm:mt-4 p-3 sm:p-4 bg-gradient-to-br from-emerald-50 to-green-50 border border-emerald-200/60 rounded-lg sm:rounded-xl">
                        <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
                          <div className="w-5 h-5 sm:w-6 sm:h-6 bg-emerald-100 rounded-md sm:rounded-lg flex items-center justify-center">
                            <span className="material-icons text-emerald-600 text-xs sm:text-sm">check_circle</span>
                          </div>
                          <span className="text-[10px] sm:text-xs font-bold text-emerald-700">Submitted</span>
                        </div>
                        {task.submissionText && (
                          <p className="text-xs sm:text-sm text-slate-600 mb-2 sm:mb-3">{task.submissionText}</p>
                        )}
                        {task.submissionFileUrl && (
                          <a
                            href={task.submissionFileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 sm:py-2 bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50 rounded-md sm:rounded-lg text-xs sm:text-sm font-medium transition-all shadow-sm"
                          >
                            <span className="material-icons text-[14px] sm:text-[16px]">attach_file</span>
                            <span className="truncate max-w-[150px] sm:max-w-none">{task.submissionFileName || 'Google Drive File'}</span>
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="bg-white p-4 sm:p-8 rounded-xl sm:rounded-2xl border border-slate-200/80 shadow-sm">
              {transcript ? (
                <div>
                  {/* Toggle for speaker view */}
                  {utterances.length > 0 && (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-6 pb-3 sm:pb-4 border-b border-slate-100">
                      <div className="flex items-center text-xs sm:text-sm text-slate-500 bg-slate-50 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl">
                        <span className="material-icons text-slate-400 text-base sm:text-lg mr-1.5 sm:mr-2">people</span>
                        <span className="font-medium">{Object.keys(speakerMapping).length} speaker{Object.keys(speakerMapping).length !== 1 ? 's' : ''}</span>
                      </div>
                      <button
                        onClick={() => setShowSpeakerView(!showSpeakerView)}
                        className={`px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-bold rounded-lg sm:rounded-xl transition-all ${
                          showSpeakerView 
                            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-md shadow-indigo-200' 
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {showSpeakerView ? '✦ Speaker View' : 'Plain Text'}
                      </button>
                    </div>
                  )}
                  
                  {/* Transcript content */}
                  {showSpeakerView && utterances.length > 0 ? (
                    <div className="space-y-3 sm:space-y-4 max-h-[400px] sm:max-h-[600px] overflow-y-auto pr-1 sm:pr-2">
                      {utterances.map((utterance, idx) => {
                        const speakerMtaiId = speakerMapping[utterance.speaker];
                        const speakerUser = usersList.find(u => u.mtaiId === speakerMtaiId);
                        const speakerName = speakerUser?.name || speakerUser?.displayName || speakerMtaiId || `Speaker ${utterance.speaker}`;
                        
                        const speakerColors: { [key: string]: string } = {
                          'A': 'bg-gradient-to-br from-blue-50 to-blue-100/50 border-blue-200/60 text-blue-800',
                          'B': 'bg-gradient-to-br from-emerald-50 to-emerald-100/50 border-emerald-200/60 text-emerald-800',
                          'C': 'bg-gradient-to-br from-purple-50 to-purple-100/50 border-purple-200/60 text-purple-800',
                          'D': 'bg-gradient-to-br from-amber-50 to-amber-100/50 border-amber-200/60 text-amber-800',
                          'E': 'bg-gradient-to-br from-rose-50 to-rose-100/50 border-rose-200/60 text-rose-800',
                        };
                        const colorClass = speakerColors[utterance.speaker] || 'bg-gradient-to-br from-slate-50 to-slate-100/50 border-slate-200/60 text-slate-800';
                        
                        return (
                          <div key={idx} className={`p-3 sm:p-4 rounded-xl sm:rounded-2xl border ${colorClass}`}>
                            <div className="flex items-center justify-between mb-1.5 sm:mb-2">
                              <span className="font-bold text-xs sm:text-sm">{speakerName}</span>
                              <span className="text-[10px] sm:text-xs opacity-50 bg-white/50 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md sm:rounded-lg">
                                {Math.floor(utterance.start / 60000)}:{String(Math.floor((utterance.start % 60000) / 1000)).padStart(2, '0')}
                              </span>
                            </div>
                            <p className="text-xs sm:text-base text-slate-700 leading-relaxed">{utterance.text}</p>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="leading-relaxed text-xs sm:text-base text-slate-700 whitespace-pre-wrap max-h-[400px] sm:max-h-[600px] overflow-y-auto bg-slate-50 p-3 sm:p-5 rounded-lg sm:rounded-xl">{transcript}</p>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 sm:py-12">
                  <div className="w-12 h-12 sm:w-16 sm:h-16 bg-slate-100 rounded-xl sm:rounded-2xl flex items-center justify-center mx-auto mb-3 sm:mb-4">
                    <span className="material-icons text-slate-300 text-2xl sm:text-3xl">description</span>
                  </div>
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base mb-2">No transcript yet</h3>
                  <p className="text-xs sm:text-base text-slate-500">
                    {meeting.status === 'completed' 
                      ? 'Transcript not available for this meeting'
                      : 'Transcript will appear here after processing completes'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4 sm:space-y-6">
          {/* Status Badge */}
          <div className="bg-white p-4 sm:p-6 rounded-xl sm:rounded-2xl border border-slate-200/80 shadow-sm">
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <h3 className="font-bold text-base sm:text-lg text-slate-800">Status</h3>
              <span className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-md sm:rounded-lg text-[10px] sm:text-xs font-bold uppercase ${getStatusBadgeClass(meeting.status)}`}>
                {getStatusLabel(meeting.status)}
              </span>
            </div>
            {meeting.status === 'error' && meeting.errorMessage && (
              <div className="p-2.5 sm:p-3 bg-red-50 border border-red-100 rounded-lg sm:rounded-xl">
                <p className="text-rose-600 text-xs sm:text-sm">{meeting.errorMessage}</p>
              </div>
            )}
            {meeting.status === 'processing' && (
              <div className="p-2.5 sm:p-3 bg-blue-50 border border-blue-100 rounded-lg sm:rounded-xl">
                <p className="text-blue-600 text-xs sm:text-sm flex items-center gap-2">
                  <span className="material-icons text-xs sm:text-sm animate-spin">sync</span>
                  Processing...
                </p>
              </div>
            )}
            {meeting.status === 'transcribing' && (
              <div className="p-2.5 sm:p-3 bg-blue-50 border border-blue-100 rounded-lg sm:rounded-xl">
                <p className="text-blue-600 text-xs sm:text-sm flex items-center gap-2">
                  <span className="material-icons text-xs sm:text-sm animate-pulse">mic</span>
                  Transcribing...
                </p>
              </div>
            )}
            {meeting.status === 'needs_mapping' && (
              <div className="p-2.5 sm:p-3 bg-amber-50 border border-amber-100 rounded-lg sm:rounded-xl">
                <p className="text-amber-600 text-xs sm:text-sm flex items-center gap-2">
                  <span className="material-icons text-xs sm:text-sm">people</span>
                  Map speakers below
                </p>
              </div>
            )}
            {meeting.status === 'completed' && (
              <div className="p-2.5 sm:p-3 bg-emerald-50 border border-emerald-100 rounded-lg sm:rounded-xl">
                <p className="text-emerald-600 text-xs sm:text-sm flex items-center gap-2">
                  <span className="material-icons text-xs sm:text-sm">check_circle</span>
                  Ready for tasks
                </p>
              </div>
            )}
          </div>

          {/* Speaker Mapping UI - ONLY shown when status is needs_mapping */}
          {meeting.status === 'needs_mapping' && speakers.length > 0 && isManager && (
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-4 sm:p-6 rounded-xl sm:rounded-2xl border border-amber-200 shadow-sm">
              <div className="flex items-center gap-2 mb-3 sm:mb-4">
                <span className="material-icons text-amber-600 text-lg sm:text-xl">people_alt</span>
                <h3 className="font-bold text-sm sm:text-lg text-amber-900">Map Speakers</h3>
              </div>
              <p className="text-xs sm:text-sm text-amber-800 mb-3 sm:mb-4">
                {speakers.length} speaker{speakers.length !== 1 ? 's' : ''} detected. Map to employees.
              </p>
              
              <div className="mb-3 sm:mb-4 p-2.5 sm:p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <p className="text-[10px] sm:text-xs text-blue-700">
                  <span className="font-semibold">Note:</span> Only employees shown. One employee per speaker.
                </p>
              </div>
              
              {usersList.length === 0 && (
                <div className="mb-3 sm:mb-4 p-2.5 sm:p-3 bg-red-50 border border-red-100 rounded-lg">
                  <p className="text-xs sm:text-sm text-red-700">
                    <span className="font-semibold">No employees!</span> They need to sign up first.
                  </p>
                </div>
              )}
              
              <div className="space-y-2 sm:space-y-3">
                {speakers.map((speakerId) => {
                  const speakerColorMap: { [key: string]: string } = {
                    'A': 'bg-blue-100 text-blue-700 border-blue-200',
                    'B': 'bg-emerald-100 text-emerald-700 border-emerald-200',
                    'C': 'bg-purple-100 text-purple-700 border-purple-200',
                    'D': 'bg-pink-100 text-pink-700 border-pink-200',
                    'E': 'bg-cyan-100 text-cyan-700 border-cyan-200',
                  };
                  const colorClass = speakerColorMap[speakerId] || 'bg-slate-100 text-slate-700 border-slate-200';
                  
                  const selectedMtaiId = pendingMapping[speakerId];
                  const alreadyAssigned = Object.entries(pendingMapping)
                    .filter(([key, value]) => key !== speakerId && value)
                    .map(([_, value]) => value);
                  
                  const currentUserMtaiId = (user as any)?.mtaiId;
                  
                  const availableUsers = usersList.filter(u => {
                    if (u.mtaiId === currentUserMtaiId) return false;
                    if (alreadyAssigned.includes(u.mtaiId) && u.mtaiId !== selectedMtaiId) return false;
                    return true;
                  });
                  
                  return (
                    <div key={speakerId} className="flex items-center gap-3">
                      <span className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm border shrink-0 ${colorClass}`}>
                        {speakerId}
                      </span>
                      <span className="text-slate-400 shrink-0">→</span>
                      <select
                        value={pendingMapping[speakerId] || ''}
                        onChange={(e) => handleMappingChange(speakerId, e.target.value)}
                        className="flex-1 px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-amber-400 focus:border-amber-400 font-medium"
                      >
                        <option value="">Select employee...</option>
                        {availableUsers.map((u) => (
                          <option key={u.mtaiId} value={u.mtaiId}>
                            [{u.mtaiId}] {u.name || u.displayName} ({u.email})
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>

              {mappingError && (
                <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-lg">
                  <p className="text-sm text-rose-700">{mappingError}</p>
                </div>
              )}

              <button
                onClick={saveSpeakerMapping}
                disabled={savingMapping || !Object.values(pendingMapping).some(v => v)}
                className="mt-4 w-full px-4 py-3 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 disabled:cursor-not-allowed text-white font-bold rounded-xl transition flex items-center justify-center gap-2"
              >
                {savingMapping ? (
                  <>
                    <span className="animate-spin">⏳</span>
                    Saving...
                  </>
                ) : (
                  <>
                    <span className="material-icons text-sm">check</span>
                    Confirm Mapping
                  </>
                )}
              </button>
            </div>
          )}

          {/* Meeting Info - shown for completed meetings */}
          {meeting.status === 'completed' && (
            <>
              <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
                <h3 className="font-bold text-lg text-slate-800 mb-4 flex items-center gap-2">
                  <span className="material-icons text-slate-400">info</span>
                  Meeting Info
                </h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-sm py-2.5 px-3 bg-slate-50 rounded-xl">
                    <span className="text-slate-500 flex items-center gap-2">
                      <span className="material-icons text-slate-400 text-lg">calendar_today</span>
                      Date
                    </span>
                    <span className="font-bold text-slate-700">{meeting.date}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm py-2.5 px-3 bg-indigo-50 rounded-xl">
                    <span className="text-slate-500 flex items-center gap-2">
                      <span className="material-icons text-indigo-400 text-lg">assignment</span>
                      Tasks
                    </span>
                    <span className="font-bold text-indigo-700">{tasks.length}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm py-2.5 px-3 bg-blue-50 rounded-xl">
                    <span className="text-slate-500 flex items-center gap-2">
                      <span className="material-icons text-blue-400 text-lg">people</span>
                      Participants
                    </span>
                    <span className="font-bold text-blue-700">{Object.keys(speakerMapping).length}</span>
                  </div>
                  {meeting.duration && meeting.duration > 0 && (
                    <div className="flex justify-between items-center text-sm py-2.5 px-3 bg-amber-50 rounded-xl">
                      <span className="text-slate-500 flex items-center gap-2">
                        <span className="material-icons text-amber-400 text-lg">schedule</span>
                        Duration
                      </span>
                      <span className="font-bold text-amber-700">{Math.floor(meeting.duration / 60)}:{String(Math.floor(meeting.duration % 60)).padStart(2, '0')}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Participants List */}
              {Object.keys(speakerMapping).length > 0 && (
                <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
                  <h3 className="font-bold text-lg text-slate-800 mb-4 flex items-center gap-2">
                    <span className="material-icons text-slate-400">group</span>
                    Participants
                  </h3>
                  <div className="space-y-3">
                    {Object.entries(speakerMapping).map(([speakerId, mtaiId]) => {
                      const employee = usersList.find(u => u.mtaiId === mtaiId);
                      const speakerColorMap: { [key: string]: string } = {
                        'A': 'bg-gradient-to-br from-blue-100 to-blue-200 text-blue-700',
                        'B': 'bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-700',
                        'C': 'bg-gradient-to-br from-purple-100 to-purple-200 text-purple-700',
                        'D': 'bg-gradient-to-br from-amber-100 to-amber-200 text-amber-700',
                        'E': 'bg-gradient-to-br from-rose-100 to-rose-200 text-rose-700',
                      };
                      const colorClass = speakerColorMap[speakerId] || 'bg-gradient-to-br from-slate-100 to-slate-200 text-slate-700';
                      const taskCount = tasks.filter(t => t.assignedTo === mtaiId).length;
                      
                      return (
                        <div key={speakerId} className="flex items-center justify-between p-3 bg-slate-50/50 rounded-xl hover:bg-slate-100/50 transition">
                          <div className="flex items-center gap-3">
                            <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shadow-sm ${colorClass}`}>
                              {speakerId}
                            </span>
                            <div>
                              <span className="font-semibold text-slate-700 block">{employee?.name || employee?.displayName || mtaiId}</span>
                              <span className="text-xs text-slate-400">{mtaiId}</span>
                            </div>
                          </div>
                          {taskCount > 0 && (
                            <span className="text-xs bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-lg font-semibold">
                              {taskCount} task{taskCount !== 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Task Creation Modal */}
      {showTaskModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900">Assign New Task</h2>
                <button
                  onClick={() => setShowTaskModal(false)}
                  className="p-2 hover:bg-slate-100 rounded-lg transition"
                >
                  <span className="material-icons">close</span>
                </button>
              </div>
              <p className="text-sm text-slate-500 mt-1">
                For meeting: <span className="font-medium">{meeting.title}</span>
              </p>
            </div>

            <form onSubmit={handleCreateTask} className="p-6 space-y-4">
              {taskError && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-lg">
                  <p className="text-sm text-red-700">{taskError}</p>
                </div>
              )}

              {/* Assign To - Only mapped employees */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Assign To <span className="text-red-500">*</span>
                </label>
                <select
                  value={assignedEmployee}
                  onChange={(e) => setAssignedEmployee(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  required
                >
                  <option value="">Select a participant...</option>
                  {mappedEmployees.length > 0 ? (
                    mappedEmployees.map((emp) => (
                      <option key={emp.mtaiId} value={emp.mtaiId}>
                        {emp.name || emp.displayName} ({emp.mtaiId})
                      </option>
                    ))
                  ) : (
                    usersList.filter(u => u.role === 'employee').map((emp) => (
                      <option key={emp.mtaiId} value={emp.mtaiId}>
                        {emp.name || emp.displayName} ({emp.mtaiId})
                      </option>
                    ))
                  )}
                </select>
              </div>

              {/* Task Title */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Task Title <span className="text-red-500">*</span>
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
                <label className="block text-sm font-medium text-slate-700 mb-2">
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
                  Due Date
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              {/* Submit Button */}
              <div className="pt-4">
                <button
                  type="submit"
                  disabled={creatingTask || !taskTitle.trim() || !assignedEmployee}
                  className="w-full px-4 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl transition flex items-center justify-center gap-2"
                >
                  {creatingTask ? (
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
      </div>
    </>
  );
};

export default MeetingDetailsPage;
