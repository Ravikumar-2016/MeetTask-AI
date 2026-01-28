/**
 * Speaker Mapper Service
 * 
 * Maps audio diarization speaker IDs (A, B, C) to real names from video OCR
 * 
 * Strategy:
 * 1. Get speaker names from video OCR
 * 2. Get utterances from audio diarization with timestamps
 * 3. Analyze speaking patterns and timing
 * 4. Match speaker IDs to real names based on:
 *    - Temporal alignment (who was visible when speaking)
 *    - Speaking duration patterns
 *    - Name mentions in transcript
 */

import { DetectedSpeaker } from './videoAnalyzer';

// ============================================
// TYPES
// ============================================

export interface SpeakerUtterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

export interface SpeakerMapping {
  [speakerId: string]: string;
}

export interface SpeakerProfile {
  speakerId: string;           // "A", "B", "C"
  realName: string | null;     // Detected name or null
  confidence: number;          // 0.0 - 1.0
  totalSpeakingTime: number;   // milliseconds
  utteranceCount: number;
  matchMethod: 'video_ocr' | 'transcript_mention' | 'pattern' | 'fallback';
}

export interface MappingResult {
  mapping: SpeakerMapping;
  profiles: SpeakerProfile[];
  unmatchedSpeakers: string[];
  unmatchedNames: string[];
}

// ============================================
// SPEAKER STATISTICS
// ============================================

interface SpeakerStats {
  speakerId: string;
  totalDuration: number;
  utteranceCount: number;
  firstSpoke: number;      // timestamp ms
  lastSpoke: number;       // timestamp ms
  avgUtteranceLength: number;
}

function calculateSpeakerStats(utterances: SpeakerUtterance[]): Map<string, SpeakerStats> {
  const stats = new Map<string, SpeakerStats>();
  
  for (const u of utterances) {
    const existing = stats.get(u.speaker);
    const duration = u.end - u.start;
    
    if (existing) {
      existing.totalDuration += duration;
      existing.utteranceCount++;
      existing.lastSpoke = Math.max(existing.lastSpoke, u.end);
    } else {
      stats.set(u.speaker, {
        speakerId: u.speaker,
        totalDuration: duration,
        utteranceCount: 1,
        firstSpoke: u.start,
        lastSpoke: u.end,
        avgUtteranceLength: 0,
      });
    }
  }
  
  // Calculate averages
  for (const stat of stats.values()) {
    stat.avgUtteranceLength = stat.totalDuration / stat.utteranceCount;
  }
  
  return stats;
}

// ============================================
// NAME MENTION DETECTION
// ============================================

/**
 * Detect when speakers mention names in the transcript
 * Useful for identifying "Thanks John" or "Hey Sarah" patterns
 */
function detectNameMentions(
  utterances: SpeakerUtterance[],
  knownNames: string[]
): Map<string, string[]> {
  const mentions = new Map<string, string[]>();
  
  const firstNames = knownNames.map(n => n.split(' ')[0].toLowerCase());
  
  for (const u of utterances) {
    const text = u.text.toLowerCase();
    const foundNames: string[] = [];
    
    for (let i = 0; i < knownNames.length; i++) {
      const firstName = firstNames[i];
      const fullName = knownNames[i].toLowerCase();
      
      // Check for direct mentions
      if (text.includes(fullName) || text.includes(firstName)) {
        // Don't add if speaker is introducing themselves
        const selfIntroPatterns = [
          `i'm ${firstName}`,
          `i am ${firstName}`,
          `my name is ${firstName}`,
          `this is ${firstName}`,
          `${firstName} here`,
        ];
        
        const isSelfIntro = selfIntroPatterns.some(p => text.includes(p));
        
        if (!isSelfIntro) {
          foundNames.push(knownNames[i]);
        }
      }
    }
    
    if (foundNames.length > 0) {
      const existing = mentions.get(u.speaker) || [];
      mentions.set(u.speaker, [...existing, ...foundNames]);
    }
  }
  
  return mentions;
}

// ============================================
// SELF-INTRODUCTION DETECTION
// ============================================

/**
 * Detect when speakers introduce themselves
 * "Hi, I'm Eric" → Speaker A = Eric
 */
function detectSelfIntroductions(
  utterances: SpeakerUtterance[],
  knownNames: string[]
): Map<string, string> {
  const introductions = new Map<string, string>();
  
  const introPatterns = [
    /(?:hi|hello|hey)[,.]?\s+(?:i'm|i am|this is)\s+([A-Z][a-z]+)/i,
    /(?:i'm|i am|my name is)\s+([A-Z][a-z]+)/i,
    /([A-Z][a-z]+)\s+(?:here|speaking)/i,
  ];
  
  // Only check first few utterances of each speaker
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
          const detectedFirstName = match[1];
          
          // Try to match with known full names
          const fullName = knownNames.find(n => 
            n.toLowerCase().startsWith(detectedFirstName.toLowerCase())
          );
          
          if (fullName) {
            introductions.set(speakerId, fullName);
            break;
          }
        }
      }
      if (introductions.has(speakerId)) break;
    }
  }
  
  return introductions;
}

// ============================================
// TEMPORAL ALIGNMENT
// ============================================

/**
 * Match speakers to names based on when they were visible in video
 */
function matchByTemporalAlignment(
  speakerStats: Map<string, SpeakerStats>,
  videoSpeakers: DetectedSpeaker[]
): Map<string, { name: string; confidence: number }> {
  const matches = new Map<string, { name: string; confidence: number }>();
  
  // Sort both by speaking time / visibility
  const sortedSpeakers = [...speakerStats.values()]
    .sort((a, b) => b.totalDuration - a.totalDuration);
  
  const sortedVideoNames = [...videoSpeakers]
    .sort((a, b) => b.occurrences - a.occurrences);
  
  // Try to match by order (most active audio speaker = most visible video person)
  // This is a heuristic and may not always be accurate
  for (let i = 0; i < Math.min(sortedSpeakers.length, sortedVideoNames.length); i++) {
    const audioSpeaker = sortedSpeakers[i];
    const videoSpeaker = sortedVideoNames[i];
    
    // Calculate confidence based on both having similar prominence
    const audioRank = i / sortedSpeakers.length;
    const videoRank = i / sortedVideoNames.length;
    const rankDiff = Math.abs(audioRank - videoRank);
    const confidence = Math.max(0.3, 0.7 - rankDiff);
    
    matches.set(audioSpeaker.speakerId, {
      name: videoSpeaker.name,
      confidence,
    });
  }
  
  return matches;
}

// ============================================
// MAIN MAPPING FUNCTION
// ============================================

/**
 * Map audio speaker IDs to real names using multiple strategies
 */
export function mapSpeakersToNames(
  utterances: SpeakerUtterance[],
  videoSpeakers: DetectedSpeaker[],
  fullTranscript?: string
): MappingResult {
  console.log('[SpeakerMapper] Starting mapping...');
  console.log('[SpeakerMapper] Audio speakers:', [...new Set(utterances.map(u => u.speaker))]);
  console.log('[SpeakerMapper] Video names:', videoSpeakers.map(s => s.name));
  
  const mapping: SpeakerMapping = {};
  const profiles: SpeakerProfile[] = [];
  const usedNames = new Set<string>();
  
  // Get unique speaker IDs
  const speakerIds = [...new Set(utterances.map(u => u.speaker))];
  const knownNames = videoSpeakers.map(s => s.name);
  
  // Calculate stats
  const speakerStats = calculateSpeakerStats(utterances);
  
  // Strategy 1: Self-introductions (highest confidence)
  const selfIntros = detectSelfIntroductions(utterances, knownNames);
  console.log('[SpeakerMapper] Self-introductions detected:', Object.fromEntries(selfIntros));
  
  for (const [speakerId, name] of selfIntros) {
    if (!usedNames.has(name)) {
      mapping[speakerId] = name;
      usedNames.add(name);
      
      const stats = speakerStats.get(speakerId);
      profiles.push({
        speakerId,
        realName: name,
        confidence: 0.9,
        totalSpeakingTime: stats?.totalDuration || 0,
        utteranceCount: stats?.utteranceCount || 0,
        matchMethod: 'transcript_mention',
      });
    }
  }
  
  // Strategy 2: Temporal alignment with video (medium confidence)
  const temporalMatches = matchByTemporalAlignment(speakerStats, videoSpeakers);
  
  for (const [speakerId, match] of temporalMatches) {
    if (!mapping[speakerId] && !usedNames.has(match.name)) {
      mapping[speakerId] = match.name;
      usedNames.add(match.name);
      
      const stats = speakerStats.get(speakerId);
      profiles.push({
        speakerId,
        realName: match.name,
        confidence: match.confidence,
        totalSpeakingTime: stats?.totalDuration || 0,
        utteranceCount: stats?.utteranceCount || 0,
        matchMethod: 'video_ocr',
      });
    }
  }
  
  // Strategy 3: Fallback - use remaining names or "Speaker X"
  for (const speakerId of speakerIds) {
    if (!mapping[speakerId]) {
      // Try to use an unused name
      const unusedName = knownNames.find(n => !usedNames.has(n));
      
      if (unusedName) {
        mapping[speakerId] = unusedName;
        usedNames.add(unusedName);
        
        const stats = speakerStats.get(speakerId);
        profiles.push({
          speakerId,
          realName: unusedName,
          confidence: 0.4,
          totalSpeakingTime: stats?.totalDuration || 0,
          utteranceCount: stats?.utteranceCount || 0,
          matchMethod: 'pattern',
        });
      } else {
        // Ultimate fallback
        mapping[speakerId] = `Speaker ${speakerId}`;
        
        const stats = speakerStats.get(speakerId);
        profiles.push({
          speakerId,
          realName: null,
          confidence: 0,
          totalSpeakingTime: stats?.totalDuration || 0,
          utteranceCount: stats?.utteranceCount || 0,
          matchMethod: 'fallback',
        });
      }
    }
  }
  
  // Identify unmatched
  const unmatchedSpeakers = speakerIds.filter(id => mapping[id]?.startsWith('Speaker '));
  const unmatchedNames = knownNames.filter(n => !usedNames.has(n));
  
  console.log('[SpeakerMapper] Final mapping:', mapping);
  
  return {
    mapping,
    profiles,
    unmatchedSpeakers,
    unmatchedNames,
  };
}

// ============================================
// TRANSCRIPT ENHANCEMENT
// ============================================

/**
 * Replace speaker IDs with real names in utterances
 */
export function enhanceTranscript(
  utterances: SpeakerUtterance[],
  mapping: SpeakerMapping
): SpeakerUtterance[] {
  return utterances.map(u => ({
    ...u,
    speaker: mapping[u.speaker] || u.speaker,
  }));
}

/**
 * Generate a clean, human-readable transcript
 */
export function generateFormattedTranscript(
  utterances: SpeakerUtterance[],
  mapping: SpeakerMapping
): string {
  let currentSpeaker = '';
  const lines: string[] = [];
  
  for (const u of utterances) {
    const speakerName = mapping[u.speaker] || `Speaker ${u.speaker}`;
    
    if (speakerName !== currentSpeaker) {
      // Add timestamp and speaker name
      const minutes = Math.floor(u.start / 60000);
      const seconds = Math.floor((u.start % 60000) / 1000);
      const timestamp = `[${minutes}:${seconds.toString().padStart(2, '0')}]`;
      
      lines.push('');
      lines.push(`${speakerName} ${timestamp}:`);
      currentSpeaker = speakerName;
    }
    
    lines.push(u.text);
  }
  
  return lines.join('\n').trim();
}
