/**
 * Orchestrator API - Multi-Modal Meeting Processing
 * 
 * POST /api/orchestrator
 * 
 * Enhanced Flow (Video + Audio):
 * 1. Verify auth & meeting ownership
 * 2. Update status → "processing"
 * 3. PARALLEL:
 *    a) Video Analysis: Extract frames → OCR speaker names from tiles
 *    b) Audio Analysis: AssemblyAI transcription + diarization
 * 4. Speaker Mapping: Match Speaker A/B/C to real names from video
 * 5. Enhanced Transcript: Replace IDs with real names
 * 6. Task Extraction: LeMUR with speaker context → auto-assign to people
 * 7. Save to Firestore
 * 8. Update status → "completed"
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ============================================
// FIREBASE ADMIN SETUP
// ============================================
let adminApp: App;

function initAdmin() {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase Admin credentials');
  }

  adminApp = initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    }),
  });

  return adminApp;
}

function getAdminDb() {
  initAdmin();
  return getFirestore();
}

function getAdminAuth() {
  initAdmin();
  return getAuth();
}

// ============================================
// AUTH VERIFICATION
// ============================================
interface AuthenticatedUser {
  uid: string;
  email: string | undefined;
}

async function verifyToken(request: VercelRequest): Promise<AuthenticatedUser> {
  const authHeader = request.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or invalid Authorization header');
  }

  const token = authHeader.substring(7);
  if (!token) throw new Error('Empty token');

  const auth = getAdminAuth();
  const decodedToken = await auth.verifyIdToken(token);
  
  return { uid: decodedToken.uid, email: decodedToken.email };
}

// ============================================
// TYPES
// ============================================
interface ExtractedTask {
  title: string;
  description: string;
  assignedTo: string;
  dueDate: string;
  priority: 'high' | 'medium' | 'low';
  confidence?: number;        // 0.0 - 1.0 confidence in assignment
  sourceSentence?: string;    // Original quote from transcript
}

interface MeetingDoc {
  userId: string;
  title: string;
  fileUrl?: string;
  audioUrl?: string;
  fileType?: 'audio' | 'video' | 'image';
  status: string;
}

type FileType = 'audio' | 'video' | 'image';

// ============================================
// SPEAKER TYPES
// ============================================

interface SpeakerUtterance {
  speaker: string;       // "A", "B", "C", etc. or real name after mapping
  text: string;
  start: number;         // milliseconds
  end: number;
  confidence: number;
}

interface SpeakerMapping {
  [speakerId: string]: string;  // "A" -> "Eric Johnson" or "Speaker A"
}

interface TranscriptionResult {
  text: string;
  confidence: number;
  duration: number;
  transcriptId: string;
  utterances: SpeakerUtterance[];
  speakerMapping: SpeakerMapping;
}

// ============================================
// VIDEO ANALYSIS TYPES
// ============================================

interface DetectedSpeaker {
  name: string;
  confidence: number;
  firstSeenAt: number;
  lastSeenAt: number;
  occurrences: number;
}

interface VideoAnalysisResult {
  speakers: DetectedSpeaker[];
  totalFramesAnalyzed: number;
  videoDuration: number;
}

// ============================================
// VIDEO FRAME EXTRACTION (Cloudinary)
// ============================================

function getCloudinaryFrameUrl(videoUrl: string, timestampSeconds: number): string {
  const cloudinaryRegex = /https:\/\/res\.cloudinary\.com\/([^\/]+)\/([^\/]+)\/upload\/(?:v\d+\/)?(.+)$/;
  const match = videoUrl.match(cloudinaryRegex);
  
  if (!match) {
    console.warn('[Video] Not a Cloudinary URL, cannot extract frames');
    return '';
  }
  
  const [, cloudName, resourceType, publicIdWithExt] = match;
  const publicId = publicIdWithExt.replace(/\.[^.]+$/, '');
  
  // Cloudinary transformation: extract frame at timestamp as JPEG
  return `https://res.cloudinary.com/${cloudName}/video/upload/so_${timestampSeconds},f_jpg,w_1280,q_auto/${publicId}.jpg`;
}

// ============================================
// GOOGLE CLOUD VISION OCR
// ============================================

async function detectTextInImage(imageUrl: string): Promise<string[]> {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  if (!apiKey) return [];
  
  try {
    const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { source: { imageUri: imageUrl } },
          features: [{ type: 'TEXT_DETECTION', maxResults: 50 }],
        }],
      }),
    });
    
    if (!response.ok) return [];
    
    const data = await response.json();
    const annotations = data.responses?.[0]?.textAnnotations || [];
    return annotations.map((a: any) => a.description);
  } catch {
    return [];
  }
}

// ============================================
// SPEAKER NAME EXTRACTION FROM OCR
// ============================================

function extractSpeakerNamesFromOCR(detectedTexts: string[]): string[] {
  const names: string[] = [];
  
  // Filter words (UI elements)
  const filterWords = new Set([
    'zoom', 'meet', 'teams', 'webex', 'mute', 'unmute', 'video', 'audio',
    'share', 'screen', 'chat', 'record', 'recording', 'participants', 'host',
    'leave', 'end', 'meeting', 'you', 'me', 'pin', 'spotlight', 'gallery',
    'view', 'speaker', 'grid', 'reactions', 'raise', 'hand', 'more',
    'security', 'breakout', 'rooms', 'polls', 'apps', 'live', 'transcript',
    'captions', 'settings', 'minimize', 'maximize',
  ]);
  
  for (const text of detectedTexts) {
    if (text.length < 3 || text.length > 50) continue;
    
    const lowerText = text.toLowerCase();
    if ([...filterWords].some(w => lowerText.includes(w))) continue;
    if (/^\d+$/.test(text) || /^[^a-zA-Z]+$/.test(text)) continue;
    
    // Check for "FirstName LastName" pattern (2-3 capitalized words)
    const words = text.trim().split(/\s+/);
    if (words.length >= 2 && words.length <= 4) {
      // Allow format like "Eric Johnson - VP" → take "Eric Johnson"
      const namePart = text.split(/\s*[-–—]\s*/)[0].trim();
      const nameWords = namePart.split(/\s+/);
      
      if (nameWords.length >= 2 && nameWords.length <= 3) {
        const allCapitalized = nameWords.every(w => /^[A-Z][a-z]+$/.test(w));
        if (allCapitalized && !names.includes(namePart)) {
          names.push(namePart);
        }
      }
    }
  }
  
  return names;
}

// ============================================
// VIDEO ANALYSIS - Extract Speaker Names from Tiles
// ============================================

async function analyzeVideoForSpeakers(videoUrl: string, durationSeconds: number): Promise<VideoAnalysisResult> {
  console.log('🎬 [VideoAnalysis] Starting video analysis for speaker names...');
  
  if (!process.env.GOOGLE_CLOUD_VISION_API_KEY) {
    console.log('⚠️ [VideoAnalysis] GOOGLE_CLOUD_VISION_API_KEY not set, skipping');
    return { speakers: [], totalFramesAnalyzed: 0, videoDuration: durationSeconds };
  }
  
  const frameTimestamps: number[] = [];
  // Extract frames every 15 seconds, starting at 5 seconds
  for (let t = 5; t < durationSeconds && t < 300; t += 15) { // Max 5 min analysis
    frameTimestamps.push(t);
  }
  
  console.log('📸 [VideoAnalysis] Analyzing', frameTimestamps.length, 'frames');
  
  const speakerMap = new Map<string, DetectedSpeaker>();
  let framesAnalyzed = 0;
  
  // Process in batches of 3 to avoid rate limits
  for (let i = 0; i < frameTimestamps.length; i += 3) {
    const batch = frameTimestamps.slice(i, i + 3);
    
    const results = await Promise.all(batch.map(async (timestamp) => {
      const frameUrl = getCloudinaryFrameUrl(videoUrl, timestamp);
      if (!frameUrl) return { timestamp, names: [] };
      
      const texts = await detectTextInImage(frameUrl);
      const names = extractSpeakerNamesFromOCR(texts);
      return { timestamp, names };
    }));
    
    for (const { timestamp, names } of results) {
      framesAnalyzed++;
      for (const name of names) {
        const existing = speakerMap.get(name);
        if (existing) {
          existing.occurrences++;
          existing.lastSeenAt = timestamp;
          existing.confidence = Math.min(0.95, existing.confidence + 0.05);
        } else {
          speakerMap.set(name, {
            name,
            confidence: 0.6,
            firstSeenAt: timestamp,
            lastSeenAt: timestamp,
            occurrences: 1,
          });
        }
      }
    }
    
    // Small delay between batches
    if (i + 3 < frameTimestamps.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  
  // Filter: must appear in at least 2 frames
  const speakers = [...speakerMap.values()]
    .filter(s => s.occurrences >= 2)
    .sort((a, b) => b.occurrences - a.occurrences);
  
  console.log('✅ [VideoAnalysis] Detected speakers from video:', speakers.map(s => s.name));
  
  return {
    speakers,
    totalFramesAnalyzed: framesAnalyzed,
    videoDuration: durationSeconds,
  };
}

// ============================================
// SPEAKER MAPPING - Align Audio IDs with Video Names
// ============================================

function mapAudioSpeakersToVideoNames(
  utterances: SpeakerUtterance[],
  videoSpeakers: DetectedSpeaker[]
): SpeakerMapping {
  const mapping: SpeakerMapping = {};
  const usedNames = new Set<string>();
  
  // Get unique speaker IDs from audio
  const speakerIds = [...new Set(utterances.map(u => u.speaker))];
  const knownNames = videoSpeakers.map(s => s.name);
  
  console.log('🔗 [SpeakerMapping] Mapping', speakerIds.length, 'audio speakers to', knownNames.length, 'video names');
  
  // Strategy 1: Detect self-introductions in transcript
  const introPatterns = [
    /(?:hi|hello|hey)[,.]?\s+(?:i'm|i am|this is)\s+([A-Z][a-z]+)/i,
    /(?:i'm|i am|my name is)\s+([A-Z][a-z]+)/i,
    /([A-Z][a-z]+)\s+(?:here|speaking)/i,
  ];
  
  // Check first 5 utterances of each speaker for self-intro
  const speakerFirstUtterances = new Map<string, SpeakerUtterance[]>();
  for (const u of utterances) {
    const existing = speakerFirstUtterances.get(u.speaker) || [];
    if (existing.length < 5) {
      speakerFirstUtterances.set(u.speaker, [...existing, u]);
    }
  }
  
  for (const [speakerId, speakerUtterances] of speakerFirstUtterances) {
    for (const u of speakerUtterances) {
      for (const pattern of introPatterns) {
        const match = u.text.match(pattern);
        if (match && match[1]) {
          const firstName = match[1];
          const fullName = knownNames.find(n => 
            n.toLowerCase().startsWith(firstName.toLowerCase())
          );
          if (fullName && !usedNames.has(fullName)) {
            mapping[speakerId] = fullName;
            usedNames.add(fullName);
            console.log(`  ✓ Self-intro: ${speakerId} → ${fullName}`);
            break;
          }
        }
      }
      if (mapping[speakerId]) break;
    }
  }
  
  // Strategy 2: Match by speaking prominence (most active audio = most visible video)
  const speakerDurations = new Map<string, number>();
  for (const u of utterances) {
    const current = speakerDurations.get(u.speaker) || 0;
    speakerDurations.set(u.speaker, current + (u.end - u.start));
  }
  
  const sortedBySpeakingTime = [...speakerDurations.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id)
    .filter(id => !mapping[id]);
  
  const sortedVideoSpeakers = [...videoSpeakers]
    .sort((a, b) => b.occurrences - a.occurrences);
  
  for (let i = 0; i < sortedBySpeakingTime.length; i++) {
    const speakerId = sortedBySpeakingTime[i];
    const videoSpeaker = sortedVideoSpeakers.find(v => !usedNames.has(v.name));
    
    if (videoSpeaker) {
      mapping[speakerId] = videoSpeaker.name;
      usedNames.add(videoSpeaker.name);
      console.log(`  ✓ Prominence match: ${speakerId} → ${videoSpeaker.name}`);
    }
  }
  
  // Strategy 3: Fallback to "Speaker X"
  for (const speakerId of speakerIds) {
    if (!mapping[speakerId]) {
      mapping[speakerId] = `Speaker ${speakerId}`;
      console.log(`  ⚠️ Fallback: ${speakerId} → Speaker ${speakerId}`);
    }
  }
  
  return mapping;
}

// ============================================
// GENERATE FORMATTED TRANSCRIPT
// ============================================

function generateFormattedTranscript(utterances: SpeakerUtterance[], mapping: SpeakerMapping): string {
  let currentSpeaker = '';
  const lines: string[] = [];
  
  for (const u of utterances) {
    const speakerName = mapping[u.speaker] || u.speaker;
    
    if (speakerName !== currentSpeaker) {
      const minutes = Math.floor(u.start / 60000);
      const seconds = Math.floor((u.start % 60000) / 1000);
      lines.push('');
      lines.push(`${speakerName} [${minutes}:${seconds.toString().padStart(2, '0')}]:`);
      currentSpeaker = speakerName;
    }
    
    lines.push(u.text);
  }
  
  return lines.join('\n').trim();
}

// ============================================
// ASSEMBLYAI TRANSCRIPTION WITH SPEAKER DIARIZATION
// ============================================

async function transcribeWithAssemblyAI(mediaUrl: string): Promise<TranscriptionResult> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY not set');

  console.log('🎤 [AssemblyAI] Starting transcription with speaker diarization...');
  console.log('📁 [AssemblyAI] Media URL:', mediaUrl.substring(0, 50) + '...');

  // Step 1: Submit transcription request WITH speaker labels
  const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: mediaUrl,
      language_detection: true,
      speaker_labels: true,  // Enable speaker diarization
    }),
  });

  if (!submitRes.ok) {
    const errText = await submitRes.text();
    throw new Error(`AssemblyAI submit error: ${submitRes.status} - ${errText}`);
  }

  const submitData = await submitRes.json();
  const transcriptId = submitData.id;
  console.log('📝 [AssemblyAI] Transcript ID:', transcriptId);

  // Step 2: Poll for completion (max 5 minutes)
  const maxAttempts = 60;
  let attempts = 0;
  let pollData: any = null;

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: { 'Authorization': apiKey },
    });

    if (!pollRes.ok) {
      throw new Error(`AssemblyAI poll error: ${pollRes.status}`);
    }

    pollData = await pollRes.json();
    console.log('⏳ [AssemblyAI] Status:', pollData.status, `(attempt ${attempts + 1})`);

    if (pollData.status === 'completed') {
      break;
    }

    if (pollData.status === 'error') {
      throw new Error(`AssemblyAI error: ${pollData.error || 'Unknown error'}`);
    }

    attempts++;
  }

  if (!pollData || pollData.status !== 'completed') {
    throw new Error('AssemblyAI transcription timed out');
  }

  console.log('✅ [AssemblyAI] Transcription complete!');

  // Step 3: Extract speaker utterances
  const utterances: SpeakerUtterance[] = (pollData.utterances || []).map((u: any) => ({
    speaker: u.speaker || 'A',
    text: u.text || '',
    start: u.start || 0,
    end: u.end || 0,
    confidence: u.confidence || 0,
  }));

  console.log('👥 [AssemblyAI] Found', utterances.length, 'utterances');
  console.log('👥 [AssemblyAI] Unique speakers:', [...new Set(utterances.map(u => u.speaker))]);

  // NOTE: Speaker mapping will be done later using video OCR
  // Here we just return empty mapping, actual mapping happens in runPipeline
  const speakerMapping: SpeakerMapping = {};

  return {
    text: pollData.text || '',
    confidence: pollData.confidence || 0,
    duration: pollData.audio_duration || 0,
    transcriptId,
    utterances,
    speakerMapping,
  };
}

// ============================================
// NOTE: mapSpeakersToNames is now replaced by mapAudioSpeakersToVideoNames
// which uses video OCR for real names
// ============================================

// ============================================
// ASSEMBLYAI LEMUR - Summary & Task Extraction with Speakers
// ============================================

async function extractSummaryWithLemur(
  transcriptId: string, 
  meetingTitle: string,
  speakerMapping: SpeakerMapping
): Promise<{ summary: string; tasks: ExtractedTask[] }> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY not set');

  console.log('🤖 [AssemblyAI LeMUR] Extracting summary & tasks...');

  // Build speaker context for the AI
  const speakerList = Object.entries(speakerMapping)
    .map(([id, name]) => `Speaker ${id} = ${name}`)
    .join(', ');

  // Use LeMUR for summary
  const summaryRes = await fetch('https://api.assemblyai.com/lemur/v3/generate/summary', {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transcript_ids: [transcriptId],
      context: `Meeting title: ${meetingTitle}. Speakers identified: ${speakerList || 'Unknown'}`,
      answer_format: 'A concise 2-4 sentence summary of the main discussion points, mentioning who said what when relevant.',
    }),
  });

  let summary = 'Meeting transcript processed.';
  if (summaryRes.ok) {
    const summaryData = await summaryRes.json();
    summary = summaryData.response || summary;
    console.log('✅ [LeMUR] Summary generated');
  } else {
    console.log('⚠️ [LeMUR] Summary failed, using default');
  }

  // Use LeMUR for task extraction WITH speaker assignment
  const tasksRes = await fetch('https://api.assemblyai.com/lemur/v3/generate/task', {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      transcript_ids: [transcriptId],
      prompt: `You are analyzing a meeting transcript with multiple speakers.
Speakers identified: ${speakerList || 'Unknown speakers'}

Extract all action items and tasks. Pay close attention to WHO is assigned each task.
Look for patterns like:
- "I'll handle...", "I will...", "I'm going to..." (self-assignment by the speaker)
- "Can you...", "[Name], could you...", "You should..." (assignment to another person)
- "[Name] will...", "[Name] is responsible for..." (explicit assignment)

For each task, provide:
- title: A clear, actionable task title (max 10 words)
- description: Brief context about what needs to be done
- assignedTo: The person's name who should do this task. Use actual names if mentioned, otherwise use "Speaker A", "Speaker B", etc. Use "Unassigned" only if truly unclear.
- dueDate: Deadline if mentioned (format: YYYY-MM-DD) or "No deadline"
- priority: high, medium, or low based on urgency language
- confidence: A number 0.0-1.0 indicating how confident you are about this task and its assignment
- sourceSentence: The exact quote from the transcript where this task was mentioned

Return ONLY a valid JSON array. If no tasks found, return [].
Example:
[{"title":"Review proposal","description":"Review the Q1 budget proposal document","assignedTo":"John","dueDate":"2026-02-01","priority":"high","confidence":0.9,"sourceSentence":"John, can you review the Q1 budget proposal by next Monday?"}]`,
    }),
  });

  let tasks: ExtractedTask[] = [];
  if (tasksRes.ok) {
    const tasksData = await tasksRes.json();
    const responseText = tasksData.response || '[]';
    console.log('📋 [LeMUR] Tasks response:', responseText.substring(0, 300));
    
    try {
      // Try to extract JSON array from response
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const rawTasks = JSON.parse(jsonMatch[0]);
        // Normalize task structure
        tasks = rawTasks.map((t: any) => ({
          title: t.title || 'Untitled Task',
          description: t.description || '',
          assignedTo: t.assignedTo || 'Unassigned',
          dueDate: t.dueDate || 'No deadline',
          priority: t.priority || 'medium',
          confidence: typeof t.confidence === 'number' ? t.confidence : 0.7,
          sourceSentence: t.sourceSentence || '',
        }));
        console.log('✅ [LeMUR] Tasks extracted:', tasks.length);
      }
    } catch (e) {
      console.log('⚠️ [LeMUR] Could not parse tasks, continuing without tasks');
    }
  } else {
    const errText = await tasksRes.text();
    console.log('⚠️ [LeMUR] Tasks extraction failed:', errText);
  }

  return { summary, tasks };
}

// ============================================
// IMAGE TEXT EXTRACTION (Simple - no OpenAI needed)
// For images, we'll create a simple text description
// ============================================

async function extractTextFromImage(imageUrl: string): Promise<{ text: string; wordCount: number }> {
  console.log('🖼️ [Image] Processing image...');
  // For images without OpenAI, return a placeholder
  // The user can view the image directly in the meeting details
  const text = `Image uploaded: ${imageUrl.split('/').pop() || 'meeting-image'}. Please view the image in the meeting details for visual content.`;
  return { text, wordCount: text.split(/\s+/).length };
}

// ============================================
// SIMPLE SUMMARY EXTRACTION (No external API)
// Used as fallback or for images
// ============================================

function extractSimpleSummaryAndTasks(transcript: string, meetingTitle: string): { summary: string; tasks: ExtractedTask[] } {
  console.log('📝 [Simple] Generating basic summary...');
  
  const wordCount = transcript.split(/\s+/).length;
  const preview = transcript.substring(0, 200).trim();
  
  const summary = `Meeting "${meetingTitle}" - ${wordCount} words transcribed. ${preview}...`;
  
  return { summary, tasks: [] };
}

// ============================================
// MAIN PIPELINE
// ============================================

interface PipelineResult {
  transcript: string;
  formattedTranscript: string;
  confidence: number;
  duration: number;
  summary: string;
  tasks: ExtractedTask[];
  utterances: SpeakerUtterance[];
  speakerMapping: SpeakerMapping;
  speakers: string[];
  speakerCount: number;
  videoAnalysisUsed: boolean;
}

async function runPipeline(fileUrl: string, fileType: FileType, meetingTitle: string): Promise<PipelineResult> {
  console.log('🚀 [Pipeline] Starting MULTI-MODAL processing for:', meetingTitle);
  console.log('📁 [Pipeline] File type:', fileType);

  let transcript = '';
  let formattedTranscript = '';
  let confidence = 0;
  let duration = 0;
  let summary = '';
  let tasks: ExtractedTask[] = [];
  let utterances: SpeakerUtterance[] = [];
  let speakerMapping: SpeakerMapping = {};
  let videoAnalysisUsed = false;

  // Step 1: Get transcript based on file type
  if (fileType === 'image') {
    const result = await extractTextFromImage(fileUrl);
    transcript = result.text;
    formattedTranscript = transcript;
    // For images, use simple summary (no LeMUR)
    const extraction = extractSimpleSummaryAndTasks(transcript, meetingTitle);
    summary = extraction.summary;
    tasks = extraction.tasks;
  } else {
    // ============================================
    // MULTI-MODAL PROCESSING (Audio + Video)
    // ============================================
    
    // Run BOTH audio transcription AND video analysis in PARALLEL
    console.log('🔄 [Pipeline] Starting parallel audio + video analysis...');
    
    const [audioResult, videoResult] = await Promise.all([
      // Audio: AssemblyAI transcription with speaker diarization
      transcribeWithAssemblyAI(fileUrl),
      
      // Video: Extract speaker names from video tiles (if video type)
      fileType === 'video' 
        ? analyzeVideoForSpeakers(fileUrl, 600) // Analyze up to 10 min
            .catch(err => {
              console.log('⚠️ [Pipeline] Video analysis failed, continuing with audio only:', err.message);
              return { speakers: [], totalFramesAnalyzed: 0, videoDuration: 0 } as VideoAnalysisResult;
            })
        : Promise.resolve({ speakers: [], totalFramesAnalyzed: 0, videoDuration: 0 } as VideoAnalysisResult)
    ]);
    
    transcript = audioResult.text;
    confidence = audioResult.confidence;
    duration = audioResult.duration;
    utterances = audioResult.utterances;
    
    console.log('📊 [Pipeline] Audio analysis complete:');
    console.log('   - Transcript length:', transcript.length);
    console.log('   - Audio speakers (A, B, C...):', [...new Set(utterances.map(u => u.speaker))]);
    
    // Use video analysis results for speaker mapping if available
    if (videoResult.speakers.length > 0) {
      console.log('📊 [Pipeline] Video analysis complete:');
      console.log('   - Frames analyzed:', videoResult.totalFramesAnalyzed);
      console.log('   - Names detected:', videoResult.speakers.map(s => s.name));
      
      // Map audio speaker IDs (A, B, C) to real names from video
      speakerMapping = mapAudioSpeakersToVideoNames(utterances, videoResult.speakers);
      videoAnalysisUsed = true;
    } else {
      // Fallback: Try to extract names from transcript
      console.log('⚠️ [Pipeline] No video names detected, using audio-only mapping');
      speakerMapping = mapAudioSpeakersToVideoNames(utterances, []);
    }
    
    console.log('🔗 [Pipeline] Final speaker mapping:', speakerMapping);
    
    // Generate formatted transcript with real names
    formattedTranscript = generateFormattedTranscript(utterances, speakerMapping);
    
    // Use AssemblyAI LeMUR for summary & tasks WITH real speaker names
    if (audioResult.transcriptId && transcript.length > 10) {
      const extraction = await extractSummaryWithLemur(audioResult.transcriptId, meetingTitle, speakerMapping);
      summary = extraction.summary;
      tasks = extraction.tasks;
    } else {
      // Fallback to simple extraction
      const extraction = extractSimpleSummaryAndTasks(transcript, meetingTitle);
      summary = extraction.summary;
      tasks = extraction.tasks;
    }
  }

  if (!transcript || transcript.trim().length === 0) {
    throw new Error('No transcript could be generated');
  }

  // Get list of speaker names
  const speakers = Object.values(speakerMapping);
  const speakerCount = speakers.length;

  return {
    transcript,
    formattedTranscript,
    confidence,
    duration,
    summary,
    tasks,
    utterances,
    speakerMapping,
    speakers,
    speakerCount,
    videoAnalysisUsed,
  };
}

// ============================================
// MAIN HANDLER
// ============================================

export default async function handler(request: VercelRequest, response: VercelResponse) {
  // CORS
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (request.method === 'OPTIONS') return response.status(200).end();
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed' });

  console.log('\n========================================');
  console.log('🎯 [Orchestrator] Request received');
  console.log('========================================\n');

  const db = getAdminDb();
  let meetingId: string | undefined;

  try {
    // Check env vars
    if (!process.env.ASSEMBLYAI_API_KEY) {
      return response.status(500).json({
        success: false,
        error: 'ASSEMBLYAI_API_KEY not configured',
      });
    }

    // Auth
    console.log('🔐 Verifying auth...');
    const user = await verifyToken(request);
    console.log('✅ User:', user.uid);

    // Get meetingId
    meetingId = request.body?.meetingId;
    if (!meetingId) {
      return response.status(400).json({ success: false, error: 'meetingId required' });
    }
    console.log('📋 Meeting ID:', meetingId);

    const meetingRef = db.collection('meetings').doc(meetingId);
    const meetingSnap = await meetingRef.get();

    if (!meetingSnap.exists) {
      return response.status(404).json({ success: false, error: 'Meeting not found' });
    }

    const meeting = meetingSnap.data() as MeetingDoc;

    // Check ownership
    if (meeting.userId !== user.uid) {
      return response.status(403).json({ success: false, error: 'Not authorized' });
    }

    // Check if already completed
    if (meeting.status === 'completed') {
      return response.status(200).json({ success: true, message: 'Already processed' });
    }

    // Update to processing
    await meetingRef.update({ 
      status: 'processing', 
      updatedAt: FieldValue.serverTimestamp() 
    });
    console.log('📊 Status → processing');

    // Get file URL
    const fileUrl = meeting.fileUrl || meeting.audioUrl;
    if (!fileUrl) {
      await meetingRef.update({ 
        status: 'error', 
        errorMessage: 'No file URL found',
        updatedAt: FieldValue.serverTimestamp() 
      });
      return response.status(400).json({ success: false, error: 'No file URL found' });
    }

    const fileType = (meeting.fileType || 'video') as FileType;
    console.log('📁 File URL:', fileUrl.substring(0, 60) + '...');
    console.log('📁 File type:', fileType);

    // Run AI pipeline
    const result = await runPipeline(fileUrl, fileType, meeting.title || 'Untitled');

    // Save transcript WITH speaker segments and formatted version
    await db.collection('transcripts').doc(meetingId).set({
      meetingId,
      userId: user.uid,
      text: result.transcript,
      formattedTranscript: result.formattedTranscript,
      summary: result.summary,
      confidence: result.confidence,
      duration: result.duration,
      wordCount: result.transcript.split(/\s+/).length,
      // Speaker diarization data
      utterances: result.utterances,
      speakerMapping: result.speakerMapping,
      speakerCount: result.speakerCount,
      speakers: result.speakers,
      // Multi-modal analysis info
      videoAnalysisUsed: result.videoAnalysisUsed,
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log('💾 Transcript saved with', result.utterances.length, 'utterances');
    console.log('   Video OCR used:', result.videoAnalysisUsed);

    // Save tasks WITH speaker assignment details
    if (result.tasks.length > 0) {
      const batch = db.batch();
      for (const task of result.tasks) {
        const taskDoc = db.collection('tasks').doc();
        batch.set(taskDoc, {
          meetingId,
          userId: user.uid,
          title: task.title,
          text: task.title,
          description: task.description || '',
          assignedTo: task.assignedTo || 'Unassigned',
          dueDate: task.dueDate || 'No deadline',
          priority: task.priority || 'medium',
          confidence: task.confidence || 0.7,
          sourceSentence: task.sourceSentence || '',
          completed: false,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      console.log('💾 Tasks saved:', result.tasks.length);
    }

    // Update meeting to completed WITH speaker info
    await meetingRef.update({
      status: 'completed',
      taskCount: result.tasks.length,
      summary: result.summary.substring(0, 500),
      duration: result.duration,
      speakerCount: result.speakerCount,
      speakers: result.speakers,
      videoAnalysisUsed: result.videoAnalysisUsed,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log('\n========================================');
    console.log('✅ [Orchestrator] Processing complete!');
    console.log('   - Speakers:', result.speakers.join(', '));
    console.log('   - Tasks:', result.tasks.length);
    console.log('   - Video OCR:', result.videoAnalysisUsed ? 'Yes' : 'No');
    console.log('========================================\n');

    return response.status(200).json({
      success: true,
      message: 'Processing completed',
      meetingId,
      taskCount: result.tasks.length,
    });

  } catch (error: any) {
    console.error('❌ [Orchestrator] Error:', error.message);

    // Update meeting status to error
    if (meetingId) {
      try {
        await db.collection('meetings').doc(meetingId).update({
          status: 'error',
          errorMessage: error.message || 'Processing failed',
          updatedAt: FieldValue.serverTimestamp(),
        });
      } catch (updateError) {
        console.error('Failed to update error status:', updateError);
      }
    }

    return response.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
    });
  }
}
