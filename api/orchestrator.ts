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
import Tesseract from 'tesseract.js';

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
  console.log('🔗 [Cloudinary] Parsing URL:', videoUrl.substring(0, 80));
  
  // Pattern 1: Standard Cloudinary URL
  // https://res.cloudinary.com/{cloud_name}/video/upload/v{version}/{public_id}.{ext}
  const cloudinaryRegex = /https:\/\/res\.cloudinary\.com\/([^\/]+)\/([^\/]+)\/upload\/(?:v\d+\/)?(.+)$/;
  const match = videoUrl.match(cloudinaryRegex);
  
  if (match) {
    const [, cloudName, resourceType, publicIdWithExt] = match;
    
    // Remove file extension
    const publicId = publicIdWithExt.replace(/\.[^.]+$/, '');
    
    // Build frame extraction URL
    // so_ = start offset, f_ = format, w_ = width, q_ = quality
    const frameUrl = `https://res.cloudinary.com/${cloudName}/video/upload/so_${timestampSeconds},f_jpg,w_1920,q_90/${publicId}.jpg`;
    
    console.log('✅ [Cloudinary] Generated frame URL:', frameUrl.substring(0, 100));
    return frameUrl;
  }
  
  // Pattern 2: URL with existing transformations
  const transformedRegex = /https:\/\/res\.cloudinary\.com\/([^\/]+)\/([^\/]+)\/upload\/([^\/]+)\/(.+)$/;
  const match2 = videoUrl.match(transformedRegex);
  
  if (match2) {
    const [, cloudName, resourceType, existingTransforms, publicIdWithExt] = match2;
    const publicId = publicIdWithExt.replace(/\.[^.]+$/, '');
    
    // Add our transforms before existing ones
    const frameUrl = `https://res.cloudinary.com/${cloudName}/video/upload/so_${timestampSeconds},f_jpg,w_1920,q_90/${publicId}.jpg`;
    
    console.log('✅ [Cloudinary] Generated frame URL (v2):', frameUrl.substring(0, 100));
    return frameUrl;
  }
  
  console.log('❌ [Cloudinary] Could not parse URL format');
  console.log('❌ [Cloudinary] Expected format: https://res.cloudinary.com/{cloud}/video/upload/...');
  return '';
}

// ============================================
// TESSERACT.JS OCR (FREE - NO API KEY NEEDED)
// ============================================

// Timeout wrapper for OCR (Vercel has 60s limit, we use 15s for single frame)
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => {
      console.log(`⏱️ [Timeout] Operation timed out after ${ms}ms`);
      resolve(fallback);
    }, ms)),
  ]);
}

async function detectTextInImage(imageUrl: string): Promise<string[]> {
  console.log('🔍 [Tesseract] Analyzing frame:', imageUrl.substring(0, 80) + '...');
  
  try {
    // Fetch image first with timeout
    console.log('📥 [Tesseract] Fetching image...');
    const imageResponse = await withTimeout(
      fetch(imageUrl),
      10000,
      null as any
    );
    
    if (!imageResponse || !imageResponse.ok) {
      console.log('❌ [Tesseract] Failed to fetch image');
      return [];
    }
    
    const arrayBuffer = await imageResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log('✅ [Tesseract] Image fetched, size:', Math.round(buffer.length / 1024), 'KB');
    
    // Run Tesseract OCR with timeout (15 seconds max per frame)
    console.log('🔄 [Tesseract] Running OCR (15s timeout)...');
    
    const result = await withTimeout(
      Tesseract.recognize(buffer, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text' && m.progress === 1) {
            console.log('   OCR complete');
          }
        },
      }),
      15000,
      { data: { text: '' } } as any
    );
    
    const fullText = result?.data?.text || '';
    
    if (fullText.trim()) {
      console.log('📝 [Tesseract] Text detected:', fullText.substring(0, 300));
      const lines = fullText.split('\n').filter((l: string) => l.trim());
      return [fullText, ...lines];
    } else {
      console.log('📝 [Tesseract] No text detected in frame');
      return [];
    }
  } catch (err: any) {
    console.log('❌ [Tesseract] Exception:', err.message);
    return [];
  }
}

// ============================================
// SPEAKER NAME EXTRACTION FROM OCR
// ============================================

function extractSpeakerNamesFromOCR(detectedTexts: string[]): string[] {
  if (detectedTexts.length === 0) return [];
  
  const names: string[] = [];
  
  // Get the full text (first element contains all text)
  const fullText = detectedTexts[0] || '';
  
  console.log('📋 [OCR] Raw full text:', fullText.substring(0, 500));
  
  // Split by newlines to get individual lines (Zoom tiles have names on separate lines)
  const lines = fullText.split(/[\n\r]+/).map(l => l.trim()).filter(l => l.length > 0);
  
  console.log('📋 [OCR] Lines detected:', lines.length);
  console.log('📋 [OCR] All lines:', lines.slice(0, 20));
  
  // UI elements to filter out - case insensitive
  const filterWords = [
    'zoom', 'mute', 'unmute', 'video', 'screen', 'share', 'chat', 'record', 
    'recording', 'participant', 'leave', 'meeting', 'reaction', 'raise', 'hand',
    'security', 'breakout', 'polls', 'apps', 'transcript', 'caption', 'cc', 
    'invite', 'waiting', 'connecting', 'joining', 'gallery', 'view', 'settings',
    'host', 'co-host', 'speaker', 'options', 'minimize', 'maximize',
    'live', 'closed', 'more', 'end', 'start', 'stop', 'audio', 'mic', 'microphone',
    // Common non-name text
    'today', 'yesterday', 'meeting', 'call', 'conference', 'webinar',
  ];
  
  // Helper: Check if a string looks like a person name
  function looksLikeName(str: string): boolean {
    // Clean up the string
    const clean = str.trim();
    
    // Skip very short or very long
    if (clean.length < 3 || clean.length > 35) return false;
    
    // Skip if starts with lowercase
    if (/^[a-z]/.test(clean)) return false;
    
    // Skip if mostly numbers or symbols
    if (!/[a-zA-Z]{2,}/.test(clean)) return false;
    
    // Skip UI elements
    const lower = clean.toLowerCase();
    if (filterWords.some(w => lower.includes(w))) return false;
    
    // Skip single words (names usually have first + last)
    const words = clean.split(/\s+/);
    if (words.length < 2) return false;
    if (words.length > 4) return false;
    
    // Check if looks like "First Last" format
    // More permissive - allow mixed case, apostrophes, hyphens
    const validWordPattern = /^[A-Z][a-zA-Z'-]{1,20}$/;
    
    // At least 2 words should look like name parts
    const nameWords = words.filter(w => validWordPattern.test(w));
    return nameWords.length >= 2;
  }
  
  // Helper: Extract name part (handle "Name - Title" format)
  function extractNamePart(line: string): string {
    // Split by common separators (dash, pipe, parentheses)
    const parts = line.split(/\s*[-–—|]\s*|\s*\(.*\)/);
    return parts[0].trim();
  }
  
  for (const line of lines) {
    const candidate = extractNamePart(line);
    
    if (looksLikeName(candidate) && !names.includes(candidate)) {
      console.log('✅ [OCR] Found name:', candidate, '(from line:', line, ')');
      names.push(candidate);
    }
  }
  
  // Also check individual text annotations (bounding boxes often have cleaner text)
  for (let i = 1; i < Math.min(detectedTexts.length, 100); i++) {
    const text = detectedTexts[i]?.trim();
    if (!text) continue;
    
    const candidate = extractNamePart(text);
    
    if (looksLikeName(candidate) && !names.includes(candidate)) {
      console.log('✅ [OCR] Found name (annotation):', candidate);
      names.push(candidate);
    }
  }
  
  // SPECIAL: Look for patterns in the full text that might be missed
  // Pattern: Names often appear near the bottom of video tiles
  // They might be close together in OCR output
  const fullTextWords = fullText.split(/\s+/);
  for (let i = 0; i < fullTextWords.length - 1; i++) {
    const word1 = fullTextWords[i];
    const word2 = fullTextWords[i + 1];
    
    // Check if two consecutive words form a name
    if (/^[A-Z][a-z]+$/.test(word1) && /^[A-Z][a-z]+$/.test(word2)) {
      const potentialName = `${word1} ${word2}`;
      if (looksLikeName(potentialName) && !names.includes(potentialName)) {
        console.log('✅ [OCR] Found name (consecutive words):', potentialName);
        names.push(potentialName);
      }
    }
  }
  
  console.log('👥 [OCR] Total names extracted:', names);
  return names;
}

// ============================================
// VIDEO ANALYSIS - Extract Speaker Names from Tiles
// ============================================

async function analyzeVideoForSpeakers(videoUrl: string, durationSeconds: number): Promise<VideoAnalysisResult> {
  console.log('🎬 [VideoAnalysis] ===== STARTING VIDEO ANALYSIS =====');
  console.log('🎬 [VideoAnalysis] Video URL:', videoUrl.substring(0, 80));
  console.log('🎬 [VideoAnalysis] Duration:', durationSeconds, 'seconds');
  console.log('✅ [VideoAnalysis] Using Tesseract.js (FREE OCR - no API key needed)');
  
  // Test Cloudinary URL parsing
  const testFrameUrl = getCloudinaryFrameUrl(videoUrl, 5);
  
  if (!testFrameUrl) {
    console.log('❌ [VideoAnalysis] Failed to generate Cloudinary frame URL');
    return { speakers: [], totalFramesAnalyzed: 0, videoDuration: durationSeconds };
  }
  
  // LIMIT: Only analyze 3 frames to stay within Vercel timeout
  // Pick frames at: 5s, middle, and 3/4 through
  const maxDuration = Math.min(durationSeconds, 180);
  const frameTimestamps = [
    5,
    Math.floor(maxDuration / 2),
    Math.floor(maxDuration * 0.75),
  ].filter(t => t < maxDuration);
  
  console.log('📸 [VideoAnalysis] Analyzing', frameTimestamps.length, 'frames at:', frameTimestamps.join('s, ') + 's');
  
  const speakerMap = new Map<string, DetectedSpeaker>();
  let framesAnalyzed = 0;
  let framesWithText = 0;
  
  // Process frames sequentially (not parallel) to avoid memory issues
  for (const timestamp of frameTimestamps) {
    console.log(`\n📷 [VideoAnalysis] Frame ${framesAnalyzed + 1}/${frameTimestamps.length} at ${timestamp}s`);
    
    const frameUrl = getCloudinaryFrameUrl(videoUrl, timestamp);
    if (!frameUrl) {
      console.log('⚠️ [VideoAnalysis] Could not generate frame URL');
      continue;
    }
    
    const texts = await detectTextInImage(frameUrl);
    const names = extractSpeakerNamesFromOCR(texts);
    
    framesAnalyzed++;
    if (texts.length > 0) framesWithText++;
    
    for (const name of names) {
      const existing = speakerMap.get(name);
      if (existing) {
        existing.occurrences++;
        existing.lastSeenAt = timestamp;
        existing.confidence = Math.min(0.95, existing.confidence + 0.1);
      } else {
        speakerMap.set(name, {
          name,
          confidence: 0.7,
          firstSeenAt: timestamp,
          lastSeenAt: timestamp,
          occurrences: 1,
        });
      }
    }
  }
  
  console.log('\n📊 [VideoAnalysis] ===== ANALYSIS COMPLETE =====');
  console.log('📊 [VideoAnalysis] Frames analyzed:', framesAnalyzed);
  console.log('📊 [VideoAnalysis] Frames with text:', framesWithText);
  console.log('📊 [VideoAnalysis] Unique names found:', speakerMap.size);
  
  // Don't filter - keep all names found (even if only seen once)
  const speakers = [...speakerMap.values()]
    .sort((a, b) => b.occurrences - a.occurrences);
  
  console.log('👥 [VideoAnalysis] Final speaker list:', speakers.map(s => `${s.name} (${s.occurrences}x)`));
  
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
    
    // Step 1: First run audio transcription to get duration and transcript
    console.log('🔄 [Pipeline] Step 1: Audio transcription...');
    const audioResult = await transcribeWithAssemblyAI(fileUrl);
    
    transcript = audioResult.text;
    confidence = audioResult.confidence;
    duration = audioResult.duration;
    utterances = audioResult.utterances;
    
    console.log('📊 [Pipeline] Audio analysis complete:');
    console.log('   - Transcript length:', transcript.length, 'chars');
    console.log('   - Duration:', duration, 'seconds');
    console.log('   - Audio speakers:', [...new Set(utterances.map(u => u.speaker))]);
    
    // Step 2: Run video analysis with timeout (if video type)
    // Video OCR is optional - can be disabled via DISABLE_VIDEO_OCR env var
    // Tesseract.js can be slow on serverless, so we have timeouts
    let videoResult: VideoAnalysisResult = { speakers: [], totalFramesAnalyzed: 0, videoDuration: 0 };
    
    const disableVideoOcr = process.env.DISABLE_VIDEO_OCR === 'true';
    
    if (disableVideoOcr) {
      console.log('⏭️ [Pipeline] Video OCR disabled via DISABLE_VIDEO_OCR env var');
    } else if (fileType === 'video' && duration > 0) {
      console.log('🔄 [Pipeline] Step 2: Video analysis for speaker names (45s timeout)...');
      try {
        // Wrap entire video analysis in 45 second timeout
        videoResult = await withTimeout(
          analyzeVideoForSpeakers(fileUrl, duration),
          45000,
          { speakers: [], totalFramesAnalyzed: 0, videoDuration: 0 }
        );
      } catch (err: any) {
        console.log('⚠️ [Pipeline] Video analysis failed:', err.message);
      }
    } else {
      console.log('⏭️ [Pipeline] Skipping video analysis (fileType:', fileType, ', duration:', duration, ')');
    }
    
    // Step 3: Map speakers
    if (videoResult.speakers.length > 0) {
      console.log('📊 [Pipeline] Video analysis results:');
      console.log('   - Frames analyzed:', videoResult.totalFramesAnalyzed);
      console.log('   - Names detected:', videoResult.speakers.map(s => s.name));
      
      speakerMapping = mapAudioSpeakersToVideoNames(utterances, videoResult.speakers);
      videoAnalysisUsed = true;
    } else {
      console.log('⚠️ [Pipeline] No video names detected, using fallback speaker labels');
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
