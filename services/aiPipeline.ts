/**
 * AI Pipeline Service
 * 
 * ⚠️ DEPRECATED: This file uses old Gemini v1beta REST API
 * 
 * Current workflow uses:
 * - AssemblyAI for transcription (orchestrator.ts → webhook/assemblyai.ts)
 * - Gemini SDK for task extraction (save-speaker-mapping.ts)
 * 
 * This file is kept for reference but should NOT be used.
 * 
 * @deprecated Use AssemblyAI for transcription and Gemini SDK for AI tasks
 * @module services/aiPipeline
 */

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface TranscriptionResult {
  text: string;
  wordCount: number;
}

export interface ExtractedTask {
  title: string;
  description: string;
  assignedTo: string;
  dueDate: string;
  priority: 'high' | 'medium' | 'low';
}

export interface ExtractionResult {
  summary: string;
  tasks: ExtractedTask[];
}

export interface PipelineResult {
  transcript: string;
  summary: string;
  tasks: ExtractedTask[];
}

export type FileType = 'audio' | 'video' | 'image';

// ============================================
// HELPER: Get MIME type from URL
// ============================================

function getMimeType(url: string, fileType: FileType): string {
  const extension = url.split('.').pop()?.toLowerCase().split('?')[0];
  
  if (fileType === 'image') {
    const imageMimes: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'webp': 'image/webp',
      'gif': 'image/gif',
    };
    return imageMimes[extension || ''] || 'image/jpeg';
  }
  
  const mediaMimes: Record<string, string> = {
    'mp3': 'audio/mpeg',
    'wav': 'audio/wav',
    'mp4': 'video/mp4',
    'mov': 'video/quicktime',
    'webm': 'video/webm',
    'm4a': 'audio/mp4',
    'ogg': 'audio/ogg',
    'flac': 'audio/flac',
  };
  
  return mediaMimes[extension || ''] || 'audio/mpeg';
}

// ============================================
// STEP 1: TRANSCRIPTION (Audio/Video)
// Uses Gemini 1.5 Flash for fast transcription
// ============================================

export async function transcribeMedia(
  mediaUrl: string, 
  fileType: FileType
): Promise<TranscriptionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  console.log('🎤 [AI Pipeline] Starting transcription...');
  console.log('📁 [AI Pipeline] Media URL:', mediaUrl.substring(0, 60) + '...');
  console.log('📂 [AI Pipeline] File type:', fileType);

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: `You are a professional transcriptionist. Transcribe the following ${fileType} file accurately.

Instructions:
- Transcribe ALL spoken words exactly as heard
- Include speaker labels if multiple speakers (e.g., "Speaker 1:", "Speaker 2:")
- Preserve natural flow and punctuation
- Mark unclear parts as [inaudible]
- Do NOT summarize - provide full verbatim transcript

Output the transcript directly without any preamble.`
          },
          {
            fileData: {
              mimeType: getMimeType(mediaUrl, fileType),
              fileUri: mediaUrl
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ [AI Pipeline] Gemini transcription error:', response.status);
    throw new Error(`Transcription failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!text) {
    throw new Error('Gemini returned empty transcript');
  }

  console.log('✅ [AI Pipeline] Transcription complete:', text.length, 'characters');
  
  return {
    text,
    wordCount: text.split(/\s+/).length
  };
}

// ============================================
// STEP 2: VISION/OCR (Images)
// Uses Gemini Vision to extract text from images
// ============================================

export async function extractTextFromImage(imageUrl: string): Promise<TranscriptionResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  console.log('🖼️ [AI Pipeline] Starting image text extraction...');
  console.log('📁 [AI Pipeline] Image URL:', imageUrl.substring(0, 60) + '...');

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            text: `Analyze this image and extract all relevant information.

Instructions:
1. If it contains text (whiteboard, document, notes): Extract ALL text exactly as written
2. If it contains diagrams: Describe the structure and any labels
3. If it contains people/scenes: Describe what's happening relevant to a meeting context
4. Identify any action items, tasks, or assignments visible

Format your response as:
---
EXTRACTED TEXT:
[All text found in the image]

CONTEXT:
[Brief description of what the image shows]

ACTION ITEMS VISIBLE:
[Any tasks or action items you can see]
---`
          },
          {
            fileData: {
              mimeType: getMimeType(imageUrl, 'image'),
              fileUri: imageUrl
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ [AI Pipeline] Gemini vision error:', response.status);
    throw new Error(`Image extraction failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
  
  if (!text) {
    throw new Error('Gemini returned empty image analysis');
  }

  console.log('✅ [AI Pipeline] Image extraction complete:', text.length, 'characters');
  
  return {
    text,
    wordCount: text.split(/\s+/).length
  };
}

// ============================================
// STEP 3: SUMMARIZATION + TASK EXTRACTION
// Uses OpenAI GPT-4o-mini for structured extraction
// ============================================

export async function extractSummaryAndTasks(
  transcript: string, 
  meetingTitle: string
): Promise<ExtractionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set');
  }

  console.log('🤖 [AI Pipeline] Starting summary & task extraction...');

  const systemPrompt = `You are an AI assistant that analyzes meeting content to extract actionable insights.

Your task:
1. Write a concise summary (2-4 sentences) of the main discussion points
2. Extract ALL action items/tasks mentioned

For each task, identify:
- title: Clear, actionable task title (what needs to be done)
- description: Brief context about the task
- assignedTo: Who is responsible (use "Unassigned" if unclear)
- dueDate: When it's due (ISO format YYYY-MM-DD, or "No deadline" if not specified)
- priority: high, medium, or low (based on urgency mentioned)

IMPORTANT:
- Only extract REAL tasks actually mentioned
- If no tasks mentioned, return empty tasks array
- Be specific with task titles
- Today's date is ${new Date().toISOString().split('T')[0]}

Respond ONLY with valid JSON:
{
  "summary": "string",
  "tasks": [
    {
      "title": "string",
      "description": "string",
      "assignedTo": "string",
      "dueDate": "YYYY-MM-DD or No deadline",
      "priority": "high|medium|low"
    }
  ]
}`;

  const userPrompt = `Meeting Title: ${meetingTitle}

Content:
${transcript.substring(0, 12000)}

Extract the summary and all action items.`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('❌ [AI Pipeline] OpenAI error:', response.status);
    throw new Error(`Extraction failed: ${response.status}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('OpenAI returned empty response');
  }

  try {
    const extracted: ExtractionResult = JSON.parse(content);
    console.log('✅ [AI Pipeline] Extraction complete');
    console.log('   - Summary:', extracted.summary?.substring(0, 50) + '...');
    console.log('   - Tasks found:', extracted.tasks?.length || 0);
    return extracted;
  } catch {
    console.error('❌ [AI Pipeline] Failed to parse OpenAI response');
    throw new Error('Failed to parse extraction result');
  }
}

// ============================================
// MAIN PIPELINE: Process based on file type
// ============================================

export async function runPipeline(
  fileUrl: string,
  fileType: FileType,
  meetingTitle: string
): Promise<PipelineResult> {
  console.log('\n========================================');
  console.log('🚀 [AI Pipeline] Starting pipeline...');
  console.log('   File type:', fileType);
  console.log('   Title:', meetingTitle);
  console.log('========================================\n');

  // Step 1: Get text content based on file type
  let transcription: TranscriptionResult;
  
  if (fileType === 'image') {
    console.log('📸 [AI Pipeline] Processing IMAGE...');
    transcription = await extractTextFromImage(fileUrl);
  } else {
    console.log('🎵 [AI Pipeline] Processing AUDIO/VIDEO...');
    transcription = await transcribeMedia(fileUrl, fileType);
  }

  // Step 2: Extract summary and tasks
  console.log('📝 [AI Pipeline] Extracting summary & tasks...');
  const extraction = await extractSummaryAndTasks(transcription.text, meetingTitle);

  // Step 3: Return combined result
  const result: PipelineResult = {
    transcript: transcription.text,
    summary: extraction.summary,
    tasks: extraction.tasks,
  };

  console.log('\n========================================');
  console.log('✅ [AI Pipeline] Pipeline complete!');
  console.log('   - Transcript:', transcription.wordCount, 'words');
  console.log('   - Summary:', result.summary?.length, 'chars');
  console.log('   - Tasks:', result.tasks.length);
  console.log('========================================\n');

  return result;
}
