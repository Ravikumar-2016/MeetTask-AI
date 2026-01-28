
import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
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
import { Meeting, Task, MeetingStatus, TaskPriorityExtended, TaskStatus, TaskStatusExtended, SpeakerUtterance, SpeakerMapping, FirestoreUser } from '../types';
import { getStatusBadgeClass, getStatusLabel } from '../hooks/useMeetings';

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
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'tasks' | 'transcript'>('tasks');
  
  // State for meeting data
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [formattedTranscript, setFormattedTranscript] = useState<string>('');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Speaker diarization state
  const [utterances, setUtterances] = useState<SpeakerUtterance[]>([]);
  const [speakerMapping, setSpeakerMapping] = useState<SpeakerMapping>({});
  const [showSpeakerView, setShowSpeakerView] = useState(true);
  const [videoOcrUsed, setVideoOcrUsed] = useState(false);
  
  // Speaker mapping UI state (for needs_mapping status)
  const [speakers, setSpeakers] = useState<string[]>([]);
  const [usersList, setUsersList] = useState<FirestoreUser[]>([]);
  const [pendingMapping, setPendingMapping] = useState<SpeakerMapping>({});
  const [savingMapping, setSavingMapping] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  // Reset meeting to re-extract tasks
  const resetToMapping = async () => {
    if (!id) return;
    setResetting(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');
      
      const res = await fetch('/api/reset-meeting', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          meetingId: id,
          targetStatus: 'needs_mapping',
        }),
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to reset meeting');
      }
      
      // Reload the page to show mapping UI
      window.location.reload();
    } catch (err: any) {
      console.error('Reset error:', err);
      setMappingError(err.message);
    } finally {
      setResetting(false);
    }
  };

  // Fetch meeting details
  useEffect(() => {
    // ============================================
    // CRITICAL: Wait for auth to finish loading
    // On page reload, Firebase restores auth session asynchronously.
    // We MUST wait for this to complete before querying Firestore.
    // ============================================
    if (authLoading) {
      console.log('[MeetingDetails] Auth loading, waiting...');
      setLoading(true);
      return;
    }

    if (!id || !user?.uid) {
      console.log('[MeetingDetails] No id or user, showing error');
      setLoading(false);
      if (!user?.uid) {
        setError('Please sign in to view this meeting');
      }
      return;
    }

    const fetchMeeting = async () => {
      try {
        console.log('[MeetingDetails] Auth ready, fetching meeting:', id);
        
        // Get meeting document
        const meetingRef = doc(db, 'meetings', id);
        const meetingSnap = await getDoc(meetingRef);

        if (!meetingSnap.exists()) {
          console.log('[MeetingDetails] Meeting not found');
          setError('Meeting not found');
          setLoading(false);
          return;
        }

        const data = meetingSnap.data();
        
        // Verify ownership - CRITICAL for security
        if (data.userId !== user.uid) {
          console.log('[MeetingDetails] Access denied - not owner');
          setError('You do not have permission to view this meeting');
          setLoading(false);
          return;
        }

        const meetingData: Meeting = {
          id: meetingSnap.id,
          title: data.title || 'Untitled Meeting',
          date: formatDate(data.createdAt),
          status: (data.status as MeetingStatus) || 'uploaded',
          fileType: data.fileType || 'audio', // Default to audio for backward compatibility
          audioUrl: data.audioUrl,
          userId: data.userId,
          taskCount: data.taskCount || 0,
          errorMessage: data.errorMessage,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
        };

        console.log('[MeetingDetails] Meeting loaded:', meetingData.title);
        setMeeting(meetingData);
        setLoading(false);
      } catch (err) {
        console.error('[MeetingDetails] Error fetching meeting:', err);
        setError('Failed to load meeting details');
        setLoading(false);
      }
    };

    fetchMeeting();
  }, [id, user?.uid, authLoading]);

  // Fetch transcript - only after auth is ready
  useEffect(() => {
    if (authLoading || !id || !user?.uid) return;

    const fetchTranscript = async () => {
      try {
        const transcriptRef = doc(db, 'transcripts', id);
        const transcriptSnap = await getDoc(transcriptRef);

        if (transcriptSnap.exists()) {
          const data = transcriptSnap.data();
          setTranscript(data.text || '');
          
          // Load formatted transcript (with real names)
          if (data.formattedTranscript) {
            setFormattedTranscript(data.formattedTranscript);
          }
          
          // Load speaker diarization data
          if (data.utterances) {
            setUtterances(data.utterances);
          }
          if (data.speakerMapping) {
            setSpeakerMapping(data.speakerMapping);
          }
          
          // Check if video OCR was used
          if (data.videoAnalysisUsed) {
            setVideoOcrUsed(true);
          }
          
          console.log('[MeetingDetails] Transcript loaded with', data.utterances?.length || 0, 'utterances');
          console.log('[MeetingDetails] Video OCR used:', data.videoAnalysisUsed || false);
        }
      } catch (err) {
        console.error('[MeetingDetails] Error fetching transcript:', err);
        // Transcript is optional, don't set error
      }
    };

    fetchTranscript();
  }, [id, user?.uid, authLoading]);

  // Real-time listener for tasks - only after auth is ready
  useEffect(() => {
    if (authLoading || !id || !user?.uid) return;

    console.log('[MeetingDetails] Setting up tasks listener for meeting:', id, 'user:', user.uid);

    // Query tasks for this meeting AND this user (required by Firestore rules)
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('meetingId', '==', id),
      where('userId', '==', user.uid)
    );

    const unsubscribe = onSnapshot(
      tasksQuery,
      (snapshot) => {
        const tasksData: Task[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          tasksData.push({
            id: doc.id,
            meetingId: data.meetingId,
            meetingTitle: data.meetingTitle,
            userId: data.userId,
            title: data.title || 'Untitled Task',
            description: data.description || '',
            owner: data.assignedToName || data.owner || 'Unassigned',
            deadline: data.dueDate || data.deadline || '',
            priority: (data.priority as TaskPriorityExtended) || 'medium',
            status: (data.status as TaskStatusExtended) || 'pending',
            // Speaker assignment fields
            assignedTo: data.assignedTo || 'Unassigned',
            assignedToName: data.assignedToName || '',
            assignedToEmail: data.assignedToEmail || '',
            creatorId: data.creatorId || data.userId || '',
            creatorMtaiId: data.creatorMtaiId,
            speakerId: data.speakerId,
            dueDate: data.dueDate,
            confidence: data.confidence,
            sourceSentence: data.sourceSentence || '',
            completed: data.completed || data.status === 'completed',
            createdAt: data.createdAt?.toDate?.()?.toISOString(),
            updates: data.updates || [],
            emailSent: data.emailSent || false,
          });
        });

        console.log('[MeetingDetails] Tasks updated:', tasksData.length);
        setTasks(tasksData);
      },
      (err) => {
        console.error('[MeetingDetails] Error fetching tasks:', err);
      }
    );

    return () => unsubscribe();
  }, [id, user?.uid, authLoading]);

  // Load users list and speakers when meeting needs mapping
  useEffect(() => {
    if (authLoading || !meeting || meeting.status !== 'needs_mapping') return;

    // Load speakers from meeting or transcript
    const loadSpeakers = async () => {
      try {
        // Get speakers from transcript
        const transcriptRef = doc(db, 'transcripts', id!);
        const transcriptSnap = await getDoc(transcriptRef);
        
        if (transcriptSnap.exists()) {
          const data = transcriptSnap.data();
          if (data.speakers) {
            setSpeakers(data.speakers);
            // Initialize pending mapping with empty values
            const initial: SpeakerMapping = {};
            data.speakers.forEach((s: string) => { initial[s] = ''; });
            setPendingMapping(initial);
          }
        }

        // Load all users for dropdown
        const usersSnap = await getDocs(collection(db, 'users'));
        const users: FirestoreUser[] = [];
        let needsMigration = false;
        
        usersSnap.forEach((docSnap) => {
          const data = docSnap.data();
          const email = data.email || docSnap.id;
          
          // Include all users, generate temporary MTAI ID if missing
          const mtaiId = data.mtaiId || `TEMP-${docSnap.id.substring(0, 6).toUpperCase()}`;
          
          if (!data.mtaiId) {
            needsMigration = true;
            console.log('[MeetingDetails] User without MTAI ID:', email);
          }
          
          users.push({
            uid: data.uid || docSnap.id,
            mtaiId: mtaiId,
            email: email,
            displayName: data.displayName || email.split('@')[0] || 'User',
            photoURL: data.photoURL || null,
            authProviders: data.authProviders || [],
          });
        });
        
        // Also add current user if not in list
        if (user?.email && !users.find(u => u.email === user.email)) {
          users.push({
            uid: user.uid,
            mtaiId: (user as any).mtaiId || `TEMP-${user.uid.substring(0, 6).toUpperCase()}`,
            email: user.email,
            displayName: user.displayName || user.email.split('@')[0] || 'User',
            photoURL: user.photoURL || null,
            authProviders: [],
          });
        }
        
        // Sort by MTAI ID for consistency
        users.sort((a, b) => a.mtaiId.localeCompare(b.mtaiId));
        setUsersList(users);
        console.log('[MeetingDetails] Users loaded for mapping:', users.length);
        
        if (needsMigration) {
          console.log('[MeetingDetails] Some users need MTAI ID migration - they will get IDs on next login');
        }
      } catch (err) {
        console.error('[MeetingDetails] Error loading speakers/users:', err);
      }
    };

    loadSpeakers();
  }, [id, meeting?.status, authLoading, user]);

  // Handle speaker mapping change
  const handleMappingChange = (speakerId: string, mtaiId: string) => {
    setPendingMapping(prev => ({ ...prev, [speakerId]: mtaiId }));
  };

  // Save speaker mapping and trigger task extraction
  const saveSpeakerMapping = async () => {
    // Get mappings that have values (non-skipped speakers)
    const activeMappings = Object.entries(pendingMapping).filter(([_, value]) => value);
    
    // At least one speaker must be mapped
    if (activeMappings.length === 0) {
      setMappingError('Please map at least one speaker to extract tasks');
      return;
    }
    
    // Check for duplicate assignments (same user mapped to multiple speakers)
    const assignedMtaiIds = activeMappings.map(([_, mtaiId]) => mtaiId);
    const uniqueMtaiIds = new Set(assignedMtaiIds);
    if (uniqueMtaiIds.size !== assignedMtaiIds.length) {
      setMappingError('Each participant can only be assigned to one speaker');
      return;
    }

    setSavingMapping(true);
    setMappingError(null);

    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error('Not authenticated');

      // Only send non-empty mappings
      const filteredMapping = Object.fromEntries(activeMappings);

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

      const result = await res.json();
      console.log('[MeetingDetails] Mapping saved, tasks:', result.tasksExtracted);
      
      // Update local state
      setSpeakerMapping(filteredMapping);
      
      // Reload meeting to get updated status
      window.location.reload();
    } catch (err: any) {
      console.error('[MeetingDetails] Error saving mapping:', err);
      setMappingError(err.message);
    } finally {
      setSavingMapping(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="space-y-8">
        <div className="flex items-center space-x-4">
          <div className="w-10 h-10 bg-slate-100 rounded-xl animate-pulse"></div>
          <div className="space-y-2">
            <div className="h-6 bg-slate-100 rounded w-64 animate-pulse"></div>
            <div className="h-4 bg-slate-100 rounded w-32 animate-pulse"></div>
          </div>
        </div>
        <div className="bg-white p-8 rounded-2xl border border-slate-200 animate-pulse">
          <div className="h-32 bg-slate-100 rounded"></div>
        </div>
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
          {/* Tabs for Action Items and Transcript */}
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
              {tasks.length === 0 ? (
                <div className="bg-white p-12 rounded-2xl border border-slate-200 text-center">
                  <span className="material-icons text-slate-300 text-5xl mb-4">assignment</span>
                  <h3 className="font-bold text-slate-900 mb-2">No tasks yet</h3>
                  <p className="text-slate-500 mb-4">
                    {meeting.status === 'completed' 
                      ? 'No action items were extracted from this meeting'
                      : 'Tasks will appear here after processing completes'}
                  </p>
                  {meeting.status === 'completed' && (
                    <button
                      onClick={resetToMapping}
                      disabled={resetting}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-medium rounded-lg transition flex items-center gap-2 mx-auto"
                    >
                      {resetting ? (
                        <>
                          <span className="animate-spin">⏳</span>
                          Resetting...
                        </>
                      ) : (
                        <>
                          <span className="material-icons text-sm">refresh</span>
                          Re-map Speakers & Extract Tasks
                        </>
                      )}
                    </button>
                  )}
                  {mappingError && (
                    <p className="mt-2 text-sm text-rose-600">{mappingError}</p>
                  )}
                </div>
              ) : (
                tasks.map((task) => (
                  <div key={task.id} className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start space-x-4">
                        <button className={`mt-1 w-6 h-6 rounded-full border-2 flex items-center justify-center transition ${
                          task.status === 'completed' || task.completed ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-slate-300 hover:border-indigo-400'
                        }`}>
                          {(task.status === 'completed' || task.completed) && <span className="material-icons text-xs">check</span>}
                        </button>
                        <div>
                          <h4 className={`font-bold text-lg ${task.status === 'completed' || task.completed ? 'text-slate-400 line-through' : 'text-slate-900'}`}>{task.title}</h4>
                          {task.description && (
                            <p className="text-slate-600 text-sm mt-1">{task.description}</p>
                          )}
                          <div className="flex flex-wrap gap-4 mt-2">
                            <div className="flex items-center text-sm text-slate-500">
                              <span className="material-icons text-[14px] mr-1">person</span> 
                              {task.assignedTo || task.owner}
                              {task.confidence && task.confidence >= 0.8 && (
                                <span className="ml-1 text-emerald-500" title={`${Math.round(task.confidence * 100)}% confident`}>✓</span>
                              )}
                            </div>
                            {task.deadline && task.deadline !== 'No deadline' && (
                              <div className="flex items-center text-sm text-slate-500">
                                <span className="material-icons text-[14px] mr-1">event</span> {task.deadline}
                              </div>
                            )}
                            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-md ${
                              task.priority === 'high' ? 'bg-rose-50 text-rose-600 border border-rose-100' : 
                              task.priority === 'low' ? 'bg-slate-50 text-slate-500 border border-slate-100' :
                              'bg-amber-50 text-amber-600 border border-amber-100'
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
                    {/* Source sentence if available */}
                    {task.sourceSentence && (
                      <div className="mt-3 pt-3 border-t border-slate-100">
                        <p className="text-xs text-slate-400 italic">
                          <span className="material-icons text-[12px] mr-1 align-middle">format_quote</span>
                          "{task.sourceSentence}"
                        </p>
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
                      <div className="flex items-center gap-3">
                        <div className="flex items-center text-sm text-slate-500">
                          <span className="material-icons text-[16px] mr-2">people</span>
                          {Object.keys(speakerMapping).length} speaker{Object.keys(speakerMapping).length !== 1 ? 's' : ''} identified
                        </div>
                        {videoOcrUsed && (
                          <span className="px-2 py-1 text-[10px] font-bold bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100">
                            <span className="material-icons text-[10px] mr-1 align-middle">videocam</span>
                            Names from video
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => setShowSpeakerView(!showSpeakerView)}
                        className={`px-3 py-1 text-xs font-bold rounded-lg transition ${
                          showSpeakerView 
                            ? 'bg-indigo-100 text-indigo-700' 
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {showSpeakerView ? 'Speaker View' : 'Plain Text'}
                      </button>
                    </div>
                  )}
                  
                  {/* Transcript content */}
                  {showSpeakerView && utterances.length > 0 ? (
                    <div className="space-y-4">
                      {utterances.map((utterance, idx) => {
                        const speakerName = speakerMapping[utterance.speaker] || `Speaker ${utterance.speaker}`;
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
                              <span className="font-bold text-sm">
                                {speakerName}
                              </span>
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
                    <p className="leading-relaxed text-slate-700 whitespace-pre-wrap">{transcript}</p>
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
              <p className="text-blue-600 text-sm">Your meeting is being processed. Tasks will appear shortly.</p>
            )}
            {meeting.status === 'transcribing' && (
              <p className="text-blue-600 text-sm">Audio is being transcribed. This may take a few minutes.</p>
            )}
            {meeting.status === 'analyzing' && (
              <p className="text-purple-600 text-sm">Extracting action items from transcript...</p>
            )}
            {meeting.status === 'uploaded' && (
              <p className="text-amber-600 text-sm">Meeting uploaded. Waiting for processing to begin.</p>
            )}
          </div>

          {/* Speaker Mapping UI - shown when status is needs_mapping */}
          {meeting.status === 'needs_mapping' && speakers.length > 0 && (
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-6 rounded-2xl border border-amber-200 shadow-sm">
              <div className="flex items-center gap-2 mb-4">
                <span className="material-icons text-amber-600">people_alt</span>
                <h3 className="font-bold text-lg text-amber-900">Map Speakers to Participants</h3>
              </div>
              <p className="text-sm text-amber-800 mb-4">
                We detected {speakers.length} speaker{speakers.length !== 1 ? 's' : ''} in this meeting. 
                Please identify who each speaker is to assign tasks correctly.
              </p>
              
              {/* Enterprise Rules Notice */}
              <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg">
                <p className="text-xs text-blue-700">
                  <span className="font-semibold">Rules:</span> You (meeting creator) cannot be assigned. Each participant can only be assigned to one speaker.
                </p>
              </div>
              
              <div className="space-y-3">
                {speakers.map((speakerId) => {
                  const speakerColors: { [key: string]: string } = {
                    'A': 'bg-blue-100 text-blue-700 border-blue-200',
                    'B': 'bg-emerald-100 text-emerald-700 border-emerald-200',
                    'C': 'bg-purple-100 text-purple-700 border-purple-200',
                    'D': 'bg-pink-100 text-pink-700 border-pink-200',
                    'E': 'bg-cyan-100 text-cyan-700 border-cyan-200',
                  };
                  const colorClass = speakerColors[speakerId] || 'bg-slate-100 text-slate-700 border-slate-200';
                  
                  // Find selected user for display
                  const selectedMtaiId = pendingMapping[speakerId];
                  const selectedUser = usersList.find(u => u.mtaiId === selectedMtaiId);
                  
                  // Get already-assigned MTAI IDs (excluding current speaker)
                  const alreadyAssigned = Object.entries(pendingMapping)
                    .filter(([key, value]) => key !== speakerId && value)
                    .map(([_, value]) => value);
                  
                  // Current user's MTAI ID (meeting creator - cannot be assigned)
                  const currentUserMtaiId = (user as any)?.mtaiId;
                  
                  // Filter available users
                  const availableUsers = usersList.filter(u => {
                    // Exclude meeting creator (self-assignment not allowed)
                    if (u.mtaiId === currentUserMtaiId) return false;
                    // Exclude already assigned users (unless it's the current selection)
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
                        <option value="">Select participant...</option>
                        <option value="" disabled className="text-slate-400">── Skip this speaker ──</option>
                        {availableUsers.map((u) => (
                          <option key={u.mtaiId} value={u.mtaiId}>
                            [{u.mtaiId}] {u.displayName} ({u.email})
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>

              {/* Selected mappings preview */}
              {Object.values(pendingMapping).some(v => v) && (
                <div className="mt-4 p-3 bg-white/60 rounded-lg border border-amber-100">
                  <p className="text-xs font-semibold text-amber-700 mb-2">Preview:</p>
                  <div className="space-y-1">
                    {speakers.map((speakerId) => {
                      const mtaiId = pendingMapping[speakerId];
                      const selectedUser = usersList.find(u => u.mtaiId === mtaiId);
                      if (!selectedUser) return null;
                      return (
                        <div key={speakerId} className="text-sm text-slate-700">
                          <span className="font-medium">Speaker {speakerId}</span>
                          <span className="text-slate-400 mx-2">→</span>
                          <span className="text-indigo-600 font-mono text-xs">{selectedUser.mtaiId}</span>
                          <span className="text-slate-500 ml-1">· {selectedUser.displayName}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

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
                    Extracting Tasks...
                  </>
                ) : (
                  <>
                    <span className="material-icons text-sm">check</span>
                    Confirm & Extract Tasks
                  </>
                )}
              </button>
              
              <p className="mt-2 text-xs text-amber-700 text-center">
                After confirming, we'll extract action items and assign them to mapped participants.
                <br />
                <span className="text-amber-600">Skipped speakers will not receive task assignments.</span>
              </p>
            </div>
          )}

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
              {Object.keys(speakerMapping).length > 0 && (
                <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                  <span className="text-slate-500">Speakers</span>
                  <span className="font-bold">{Object.keys(speakerMapping).length}</span>
                </div>
              )}
              {meeting.duration && meeting.duration > 0 && (
                <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                  <span className="text-slate-500">Duration</span>
                  <span className="font-bold">{Math.floor(meeting.duration / 60)}:{String(Math.floor(meeting.duration % 60)).padStart(2, '0')}</span>
                </div>
              )}
              <div className="flex justify-between text-sm py-2 border-b border-slate-100">
                <span className="text-slate-500">Status</span>
                <span className="font-bold capitalize">{meeting.status}</span>
              </div>
            </div>
          </div>

          {/* Speaker List */}
          {Object.keys(speakerMapping).length > 0 && (
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="font-bold text-lg mb-4">Participants</h3>
              <div className="space-y-2">
                {Object.entries(speakerMapping).map(([id, name]) => {
                  const speakerColors: { [key: string]: string } = {
                    'A': 'bg-blue-100 text-blue-700',
                    'B': 'bg-emerald-100 text-emerald-700',
                    'C': 'bg-purple-100 text-purple-700',
                    'D': 'bg-amber-100 text-amber-700',
                    'E': 'bg-rose-100 text-rose-700',
                  };
                  const colorClass = speakerColors[id] || 'bg-slate-100 text-slate-700';
                  const taskCount = tasks.filter(t => t.assignedTo === name || t.owner === name).length;
                  
                  return (
                    <div key={id} className="flex items-center justify-between py-2">
                      <div className="flex items-center">
                        <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold mr-3 ${colorClass}`}>
                          {id}
                        </span>
                        <span className="font-medium text-slate-700">{name}</span>
                      </div>
                      {taskCount > 0 && (
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full">
                          {taskCount} task{taskCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
