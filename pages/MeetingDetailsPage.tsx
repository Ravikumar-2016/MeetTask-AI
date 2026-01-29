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
    });

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
      <div className="space-y-8">
        {/* Debug Info - Remove in production */}
        {process.env.NODE_ENV === 'development' && (
          <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-lg text-xs font-mono">
            <p><strong>Debug:</strong> Meeting ID: {id} | Tasks loaded: {tasks.length}</p>
            <p>User UID: {user?.uid} | Manager: {isManager ? 'Yes' : 'No'}</p>
          </div>
        )}
        {/* Header - Clean, no Share/Export */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link 
            to="/meetings" 
            className="w-10 h-10 bg-white border border-slate-200 rounded-xl flex items-center justify-center text-slate-600 hover:bg-slate-50 transition"
          >
            <span className="material-icons">arrow_back</span>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{meeting.title}</h1>
            <p className="text-slate-500">{meeting.date}</p>
          </div>
        </div>
        
        {/* Only show Assign Task button for completed meetings and managers */}
        {meeting.status === 'completed' && isManager && (
          <button
            onClick={() => setShowTaskModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-md shadow-indigo-200 transition"
          >
            <span className="material-icons text-sm">add_task</span>
            Assign New Task
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* Tabs for Tasks and Transcript */}
          <div className="flex space-x-1 bg-slate-100 p-1 rounded-xl w-fit">
            <button
              onClick={() => setActiveTab('tasks')}
              className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
                activeTab === 'tasks' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Tasks ({tasks.length})
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
              {tasks.length === 0 ? (
                <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center">
                  <span className="material-icons text-slate-300 text-5xl mb-4">assignment</span>
                  <h3 className="font-bold text-slate-900 mb-2">No tasks yet</h3>
                  <p className="text-slate-500 mb-4">
                    {meeting.status === 'completed' 
                      ? 'Create tasks for the participants of this meeting'
                      : 'Tasks can be assigned after speaker mapping is complete'}
                  </p>
                  {meeting.status === 'completed' && isManager && (
                    <button
                      onClick={() => setShowTaskModal(true)}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition"
                    >
                      Assign First Task
                    </button>
                  )}
                </div>
              ) : (
                tasks.map((task) => (
                  <div key={task.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          task.status === 'completed' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300'
                        }`}>
                          {task.status === 'completed' && <span className="material-icons text-sm">check</span>}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded font-semibold">
                              {task.taskId}
                            </span>
                            <span className="text-sm font-medium text-slate-700">
                              Assigned to: {task.assignedToName || task.assignedTo}
                            </span>
                          </div>
                        </div>
                      </div>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${statusColors[task.status]}`}>
                        {statusLabels[task.status]}
                      </span>
                    </div>

                    {/* Show submission if exists */}
                    {task.submissionText && (
                      <div className="mt-3 p-3 bg-green-50 border border-green-100 rounded-lg">
                        <p className="text-xs font-semibold text-green-700 mb-1">
                          <span className="material-icons text-xs mr-1 align-middle">check_circle</span>
                          Submitted
                        </p>
                        {task.submissionFileUrl && (
                          <a
                            href={task.submissionFileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-green-700 hover:text-green-800 underline"
                          >
                            <span className="material-icons text-sm">attach_file</span>
                            {task.submissionFileName || 'View file'}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
              {transcript ? (
                <div>
                  {/* Toggle for speaker view */}
                  {utterances.length > 0 && (
                    <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-100">
                      <div className="flex items-center text-sm text-slate-500">
                        <span className="material-icons text-[16px] mr-2">people</span>
                        {Object.keys(speakerMapping).length} speaker{Object.keys(speakerMapping).length !== 1 ? 's' : ''} identified
                      </div>
                      <button
                        onClick={() => setShowSpeakerView(!showSpeakerView)}
                        className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                          showSpeakerView ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {showSpeakerView ? 'Speaker View' : 'Plain Text'}
                      </button>
                    </div>
                  )}
                  
                  {/* Transcript content */}
                  {showSpeakerView && utterances.length > 0 ? (
                    <div className="space-y-4 max-h-[600px] overflow-y-auto">
                      {utterances.map((utterance, idx) => {
                        const speakerMtaiId = speakerMapping[utterance.speaker];
                        const speakerUser = usersList.find(u => u.mtaiId === speakerMtaiId);
                        const speakerName = speakerUser?.name || speakerUser?.displayName || speakerMtaiId || `Speaker ${utterance.speaker}`;
                        
                        const speakerColors: { [key: string]: string } = {
                          'A': 'bg-blue-50 border-blue-200 text-blue-700',
                          'B': 'bg-emerald-50 border-emerald-200 text-emerald-700',
                          'C': 'bg-purple-50 border-purple-200 text-purple-700',
                          'D': 'bg-amber-50 border-amber-200 text-amber-700',
                          'E': 'bg-rose-50 border-rose-200 text-rose-700',
                        };
                        const colorClass = speakerColors[utterance.speaker] || 'bg-slate-50 border-slate-200 text-slate-700';
                        
                        return (
                          <div key={idx} className={`p-4 rounded-lg border ${colorClass}`}>
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-bold text-sm">{speakerName}</span>
                              <span className="text-xs opacity-60">
                                {Math.floor(utterance.start / 60000)}:{String(Math.floor((utterance.start % 60000) / 1000)).padStart(2, '0')}
                              </span>
                            </div>
                            <p className="text-slate-700 leading-relaxed">{utterance.text}</p>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="leading-relaxed text-slate-700 whitespace-pre-wrap max-h-[600px] overflow-y-auto">{transcript}</p>
                  )}
                </div>
              ) : (
                <div className="text-center py-8">
                  <span className="material-icons text-slate-300 text-5xl mb-4">description</span>
                  <h3 className="font-bold text-slate-900 mb-2">No transcript yet</h3>
                  <p className="text-slate-500">
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
        <div className="space-y-6">
          {/* Status Badge */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">Status</h3>
              <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase ${getStatusBadgeClass(meeting.status)}`}>
                {getStatusLabel(meeting.status)}
              </span>
            </div>
            {meeting.status === 'error' && meeting.errorMessage && (
              <p className="text-rose-600 text-sm">{meeting.errorMessage}</p>
            )}
            {meeting.status === 'processing' && (
              <p className="text-blue-600 text-sm">Your meeting is being processed...</p>
            )}
            {meeting.status === 'transcribing' && (
              <p className="text-blue-600 text-sm">Audio is being transcribed...</p>
            )}
            {meeting.status === 'needs_mapping' && (
              <p className="text-amber-600 text-sm">Please map speakers to employees below.</p>
            )}
            {meeting.status === 'completed' && (
              <p className="text-green-600 text-sm">Meeting processed. Ready for task assignment.</p>
            )}
          </div>

          {/* Speaker Mapping UI - ONLY shown when status is needs_mapping */}
          {meeting.status === 'needs_mapping' && speakers.length > 0 && isManager && (
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-2xl border border-amber-200 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <span className="material-icons text-amber-600">people_alt</span>
                <h3 className="font-bold text-lg text-amber-900">Map Speakers to Employees</h3>
              </div>
              <p className="text-sm text-amber-800 mb-4">
                We detected {speakers.length} speaker{speakers.length !== 1 ? 's' : ''} in this meeting. 
                Map each speaker to an employee.
              </p>
              
              <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <p className="text-xs text-blue-700">
                  <span className="font-semibold">Note:</span> Only employees are shown. Each employee can only be assigned to one speaker.
                </p>
              </div>
              
              {usersList.length === 0 && (
                <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg">
                  <p className="text-sm text-red-700">
                    <span className="font-semibold">No employees found!</span> Employees need to sign up first.
                  </p>
                </div>
              )}
              
              <div className="space-y-3">
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
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                <h3 className="font-bold text-lg mb-4">Meeting Info</h3>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                    <span className="text-slate-500">Date</span>
                    <span className="font-bold">{meeting.date}</span>
                  </div>
                  <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                    <span className="text-slate-500">Tasks</span>
                    <span className="font-bold">{tasks.length}</span>
                  </div>
                  <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                    <span className="text-slate-500">Participants</span>
                    <span className="font-bold">{Object.keys(speakerMapping).length}</span>
                  </div>
                  {meeting.duration && meeting.duration > 0 && (
                    <div className="flex justify-between text-sm py-2">
                      <span className="text-slate-500">Duration</span>
                      <span className="font-bold">{Math.floor(meeting.duration / 60)}:{String(Math.floor(meeting.duration % 60)).padStart(2, '0')}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Participants List */}
              {Object.keys(speakerMapping).length > 0 && (
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                  <h3 className="font-bold text-lg mb-4">Participants</h3>
                  <div className="space-y-2">
                    {Object.entries(speakerMapping).map(([speakerId, mtaiId]) => {
                      const employee = usersList.find(u => u.mtaiId === mtaiId);
                      const speakerColorMap: { [key: string]: string } = {
                        'A': 'bg-blue-100 text-blue-700',
                        'B': 'bg-emerald-100 text-emerald-700',
                        'C': 'bg-purple-100 text-purple-700',
                        'D': 'bg-amber-100 text-amber-700',
                        'E': 'bg-rose-100 text-rose-700',
                      };
                      const colorClass = speakerColorMap[speakerId] || 'bg-slate-100 text-slate-700';
                      const taskCount = tasks.filter(t => t.assignedTo === mtaiId).length;
                      
                      return (
                        <div key={speakerId} className="flex items-center justify-between py-2">
                          <div className="flex items-center">
                            <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold mr-3 ${colorClass}`}>
                              {speakerId}
                            </span>
                            <div>
                              <span className="font-medium text-slate-700">{employee?.name || employee?.displayName || mtaiId}</span>
                              <span className="text-xs text-slate-400 ml-2">{mtaiId}</span>
                            </div>
                          </div>
                          {taskCount > 0 && (
                            <span className="text-xs bg-indigo-100 text-indigo-600 px-2 py-1 rounded-full">
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
