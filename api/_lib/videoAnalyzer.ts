/**
 * Video Analyzer Service
 * 
 * Extracts speaker names from Zoom/Meet video tiles using:
 * 1. Cloudinary frame extraction (via URL transformation)
 * 2. Google Cloud Vision OCR for name detection
 * 
 * Flow:
 * - Extract frames at regular intervals (every 10 seconds)
 * - Send frames to Vision API for text detection
 * - Parse detected text to find speaker names
 * - Build speaker name map with timestamps
 */

// ============================================
// TYPES
// ============================================

export interface DetectedSpeaker {
  name: string;
  confidence: number;
  firstSeenAt: number;      // seconds
  lastSeenAt: number;       // seconds
  occurrences: number;      // how many frames detected
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface FrameAnalysis {
  timestamp: number;        // seconds
  detectedNames: string[];
  rawText: string[];
}

export interface VideoAnalysisResult {
  speakers: DetectedSpeaker[];
  frameAnalyses: FrameAnalysis[];
  totalFramesAnalyzed: number;
  videoDuration: number;
}

// ============================================
// CLOUDINARY FRAME EXTRACTION
// ============================================

/**
 * Generate Cloudinary URLs for video frames at specific timestamps
 * Uses Cloudinary's transformation API to extract frames without FFmpeg
 */
export function getCloudinaryFrameUrl(videoUrl: string, timestampSeconds: number): string {
  // Parse Cloudinary URL to extract components
  // Format: https://res.cloudinary.com/{cloud_name}/{resource_type}/upload/{version}/{public_id}.{format}
  
  const cloudinaryRegex = /https:\/\/res\.cloudinary\.com\/([^\/]+)\/([^\/]+)\/upload\/(?:v\d+\/)?(.+)$/;
  const match = videoUrl.match(cloudinaryRegex);
  
  if (!match) {
    console.warn('[VideoAnalyzer] Not a Cloudinary URL, cannot extract frames:', videoUrl.substring(0, 50));
    return videoUrl;
  }
  
  const [, cloudName, resourceType, publicIdWithExt] = match;
  
  // Remove file extension for transformation
  const publicId = publicIdWithExt.replace(/\.[^.]+$/, '');
  
  // Build frame extraction URL with transformations:
  // - so_{timestamp} = start offset at timestamp
  // - f_jpg = output as JPEG
  // - w_1280 = width 1280px (good for OCR)
  // - q_auto = automatic quality
  const frameUrl = `https://res.cloudinary.com/${cloudName}/video/upload/so_${timestampSeconds},f_jpg,w_1280,q_auto/${publicId}.jpg`;
  
  return frameUrl;
}

/**
 * Generate frame URLs for analysis at regular intervals
 */
export function generateFrameUrls(videoUrl: string, durationSeconds: number, intervalSeconds: number = 10): { url: string; timestamp: number }[] {
  const frames: { url: string; timestamp: number }[] = [];
  
  // Start at 5 seconds to skip intro, then every interval
  for (let t = 5; t < durationSeconds; t += intervalSeconds) {
    frames.push({
      url: getCloudinaryFrameUrl(videoUrl, t),
      timestamp: t,
    });
  }
  
  // Limit to 30 frames max to control API costs
  return frames.slice(0, 30);
}

// ============================================
// GOOGLE CLOUD VISION OCR
// ============================================

interface VisionTextAnnotation {
  description: string;
  boundingPoly?: {
    vertices: { x: number; y: number }[];
  };
}

interface VisionResponse {
  responses: {
    textAnnotations?: VisionTextAnnotation[];
    fullTextAnnotation?: {
      text: string;
    };
    error?: {
      message: string;
    };
  }[];
}

/**
 * Send image to Google Cloud Vision API for text detection
 */
async function detectTextInImage(imageUrl: string, apiKey: string): Promise<string[]> {
  const visionUrl = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
  
  const requestBody = {
    requests: [{
      image: {
        source: {
          imageUri: imageUrl,
        },
      },
      features: [{
        type: 'TEXT_DETECTION',
        maxResults: 50,
      }],
    }],
  };
  
  try {
    const response = await fetch(visionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    
    if (!response.ok) {
      const errText = await response.text();
      console.error('[Vision API] Error:', response.status, errText);
      return [];
    }
    
    const data: VisionResponse = await response.json();
    
    if (data.responses[0]?.error) {
      console.error('[Vision API] Error:', data.responses[0].error.message);
      return [];
    }
    
    const annotations = data.responses[0]?.textAnnotations || [];
    
    // First annotation is the full text, rest are individual words/phrases
    return annotations.map(a => a.description);
  } catch (error) {
    console.error('[Vision API] Exception:', error);
    return [];
  }
}

// ============================================
// SPEAKER NAME EXTRACTION
// ============================================

/**
 * Parse detected text to extract likely speaker names
 * Zoom/Meet tiles typically show: "FirstName LastName - Title" or just "FirstName LastName"
 */
function extractSpeakerNames(detectedTexts: string[]): string[] {
  const names: string[] = [];
  
  // Common patterns in video conference tiles
  const namePatterns = [
    // "FirstName LastName" (2-3 words, capitalized)
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})$/,
    // "FirstName LastName - Title" (extract name before dash)
    /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s*[-–—]/,
    // "FirstName L." or "F. LastName"
    /^([A-Z][a-z]+\s+[A-Z]\.?)$/,
    /^([A-Z]\.\s+[A-Z][a-z]+)$/,
  ];
  
  // Words to filter out (common UI elements)
  const filterWords = new Set([
    'zoom', 'meet', 'teams', 'webex', 'mute', 'unmute', 'video', 'audio',
    'share', 'screen', 'chat', 'record', 'recording', 'participants', 'host',
    'co-host', 'leave', 'end', 'meeting', 'call', 'you', 'me', 'pin', 'unpin',
    'spotlight', 'gallery', 'view', 'speaker', 'grid', 'reactions', 'raise',
    'hand', 'more', 'security', 'breakout', 'rooms', 'polls', 'apps',
    'live', 'transcript', 'captions', 'cc', 'settings', 'minimize', 'maximize',
  ]);
  
  for (const text of detectedTexts) {
    // Skip very short or very long strings
    if (text.length < 3 || text.length > 50) continue;
    
    // Skip if contains filter words
    const lowerText = text.toLowerCase();
    if ([...filterWords].some(w => lowerText.includes(w))) continue;
    
    // Skip if mostly numbers or special chars
    if (/^\d+$/.test(text) || /^[^a-zA-Z]+$/.test(text)) continue;
    
    // Try each pattern
    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        const name = match[1].trim();
        // Validate: should have at least 2 parts (first + last)
        const parts = name.split(/\s+/);
        if (parts.length >= 2 && parts.every(p => p.length >= 2)) {
          names.push(name);
          break;
        }
      }
    }
    
    // Also try direct match for 2-3 word names
    const words = text.trim().split(/\s+/);
    if (words.length >= 2 && words.length <= 3) {
      const allCapitalized = words.every(w => /^[A-Z][a-z]+$/.test(w));
      if (allCapitalized) {
        const name = words.join(' ');
        if (!names.includes(name)) {
          names.push(name);
        }
      }
    }
  }
  
  return [...new Set(names)]; // Deduplicate
}

// ============================================
// MAIN VIDEO ANALYSIS
// ============================================

/**
 * Analyze video to extract speaker names using OCR
 */
export async function analyzeVideo(
  videoUrl: string, 
  durationSeconds: number
): Promise<VideoAnalysisResult> {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  
  if (!apiKey) {
    console.warn('[VideoAnalyzer] GOOGLE_CLOUD_VISION_API_KEY not set, skipping video analysis');
    return {
      speakers: [],
      frameAnalyses: [],
      totalFramesAnalyzed: 0,
      videoDuration: durationSeconds,
    };
  }
  
  console.log('[VideoAnalyzer] Starting analysis for', durationSeconds, 'second video');
  
  // Generate frame URLs
  const frames = generateFrameUrls(videoUrl, durationSeconds, 15); // Every 15 seconds
  console.log('[VideoAnalyzer] Will analyze', frames.length, 'frames');
  
  const frameAnalyses: FrameAnalysis[] = [];
  const speakerMap = new Map<string, DetectedSpeaker>();
  
  // Process frames (in batches of 5 to avoid rate limits)
  for (let i = 0; i < frames.length; i += 5) {
    const batch = frames.slice(i, i + 5);
    
    const batchResults = await Promise.all(
      batch.map(async (frame) => {
        const detectedTexts = await detectTextInImage(frame.url, apiKey);
        const names = extractSpeakerNames(detectedTexts);
        
        return {
          timestamp: frame.timestamp,
          detectedNames: names,
          rawText: detectedTexts.slice(0, 10), // Keep first 10 for debugging
        };
      })
    );
    
    // Process results
    for (const analysis of batchResults) {
      frameAnalyses.push(analysis);
      
      for (const name of analysis.detectedNames) {
        const existing = speakerMap.get(name);
        if (existing) {
          existing.occurrences++;
          existing.lastSeenAt = analysis.timestamp;
          existing.confidence = Math.min(0.95, existing.confidence + 0.05);
        } else {
          speakerMap.set(name, {
            name,
            confidence: 0.6, // Start with moderate confidence
            firstSeenAt: analysis.timestamp,
            lastSeenAt: analysis.timestamp,
            occurrences: 1,
          });
        }
      }
    }
    
    // Small delay between batches
    if (i + 5 < frames.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  
  // Convert map to array and sort by occurrences
  const speakers = [...speakerMap.values()]
    .filter(s => s.occurrences >= 2) // Must appear in at least 2 frames
    .sort((a, b) => b.occurrences - a.occurrences);
  
  console.log('[VideoAnalyzer] Detected', speakers.length, 'speakers:', speakers.map(s => s.name));
  
  return {
    speakers,
    frameAnalyses,
    totalFramesAnalyzed: frameAnalyses.length,
    videoDuration: durationSeconds,
  };
}

// ============================================
// ALTERNATIVE: ASSEMBLYAI AUTO CHAPTERS + ENTITY DETECTION
// (Fallback if no Vision API key)
// ============================================

export async function extractSpeakersFromTranscript(
  transcriptId: string,
  apiKey: string
): Promise<string[]> {
  // Use AssemblyAI's entity detection to find person names
  const response = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
    headers: { 'Authorization': apiKey },
  });
  
  if (!response.ok) return [];
  
  const data = await response.json();
  
  // Look for detected entities of type "person_name"
  const entities = data.entities || [];
  const personNames = entities
    .filter((e: any) => e.entity_type === 'person_name')
    .map((e: any) => e.text);
  
  return [...new Set(personNames)];
}
