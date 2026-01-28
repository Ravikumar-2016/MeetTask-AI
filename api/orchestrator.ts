/**
 * Orchestrator API - ASYNC Job Submitter
 * 
 * POST /api/orchestrator
 * 
 * This endpoint DOES NOT process the meeting. It only:
 * 1. Validates auth & meeting ownership
 * 2. Submits transcription job to AssemblyAI with webhook URL
 * 3. Updates status to "transcribing"
 * 4. Returns immediately (~2-3 seconds)
 * 
 * The actual processing happens when AssemblyAI calls /api/webhook/assemblyai
 * 
 * Status Flow:
 * uploaded → transcribing → analyzing → completed
 *                       ↘ error (if failed)
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
interface MeetingDoc {
  userId: string;
  title: string;
  fileUrl?: string;
  audioUrl?: string;
  fileType?: 'audio' | 'video' | 'image' | 'pdf';
  status: string;
  ocrText?: string;
}

// ============================================
// GEMINI VISION - SIMPLE IMAGE/PDF SUMMARIZER
// Uses REST API directly for better reliability
// ============================================

async function summarizeImageOrPdf(fileUrl: string, fileType: 'image' | 'pdf'): Promise<{ summary: string; keyPoints: string[] }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  console.log('🔮 [Gemini] Summarizing:', fileType);
  
  // PDF files cannot be directly processed - return a helpful message
  if (fileType === 'pdf') {
    console.log('⚠️ [Gemini] PDF direct processing not supported');
    return {
      summary: 'PDF files cannot be processed directly. Please convert your PDF to an image (screenshot or export as PNG/JPG) and upload the image instead.',
      keyPoints: ['Convert PDF to image format (PNG/JPG)', 'Take a screenshot of each page', 'Upload images separately']
    };
  }

  // Fetch the image from Cloudinary
  console.log('📥 [Gemini] Fetching image from:', fileUrl.substring(0, 80) + '...');
  
  const fetchResponse = await fetch(fileUrl);
  
  if (!fetchResponse.ok) {
    throw new Error(`Failed to fetch file: ${fetchResponse.status}`);
  }

  const buffer = await fetchResponse.arrayBuffer();
  const base64Data = Buffer.from(buffer).toString('base64');
  
  // Determine MIME type from URL
  let mimeType = 'image/jpeg';
  const urlLower = fileUrl.toLowerCase();
  if (urlLower.includes('.png')) mimeType = 'image/png';
  else if (urlLower.includes('.webp')) mimeType = 'image/webp';
  else if (urlLower.includes('.gif')) mimeType = 'image/gif';
  else if (urlLower.includes('.jpg') || urlLower.includes('.jpeg')) mimeType = 'image/jpeg';

  console.log('🔮 [Gemini] MIME type:', mimeType, 'Size:', Math.round(buffer.byteLength / 1024), 'KB');

  const prompt = `Analyze this image and provide a helpful summary.

If this is a meeting notes image, whiteboard, document, or screenshot:
1. Extract and summarize the main content
2. List key points, action items, or important information
3. Note any dates, names, or deadlines mentioned

If this is a general image:
1. Describe what's shown in the image
2. Extract any visible text
3. Note any relevant details

FORMAT YOUR RESPONSE AS JSON:
{
  "summary": "A 2-3 sentence summary of the image content",
  "keyPoints": ["Point 1", "Point 2", "Point 3"]
}

Return ONLY valid JSON, no other text.`;

  // Try with v1 API (stable) - gemini-1.5-flash supports vision
  const requestBody = {
    contents: [{
      parts: [
        { text: prompt },
        { 
          inlineData: { 
            mimeType: mimeType, 
            data: base64Data 
          } 
        }
      ]
    }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
    }
  };

  // Use v1 API with gemini-1.5-flash (supports vision)
  const endpoint = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  console.log('🔮 [Gemini] Calling v1 API with gemini-1.5-flash...');
  
  try {
    const apiResponse = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const responseData = await apiResponse.json();
    
    if (!apiResponse.ok) {
      console.error('❌ [Gemini] API error:', apiResponse.status, JSON.stringify(responseData));
      throw new Error(JSON.stringify(responseData));
    }

    const responseText = responseData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    console.log('✅ [Gemini] Success!');
    console.log('📝 [Gemini] Raw response:', responseText.substring(0, 200));

    // Try to parse JSON response
    try {
      let cleanJson = responseText
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      
      const parsed = JSON.parse(cleanJson);
      return {
        summary: parsed.summary || 'Image analyzed successfully.',
        keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints : []
      };
    } catch (parseError) {
      console.log('⚠️ [Gemini] JSON parse failed, using raw text');
      return {
        summary: responseText.substring(0, 500) || 'Image content extracted.',
        keyPoints: []
      };
    }
  } catch (error: any) {
    console.error('❌ [Gemini] Error:', error.message);
    throw new Error(`Gemini API failed: ${error.message}`);
  }
}

// ============================================
// ASSEMBLYAI JOB SUBMISSION
// ============================================
async function submitToAssemblyAI(mediaUrl: string, webhookUrl: string): Promise<string> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error('ASSEMBLYAI_API_KEY not set');

  console.log('🎤 [AssemblyAI] Submitting transcription job...');
  console.log('📁 Media URL:', mediaUrl.substring(0, 60) + '...');
  console.log('🔔 Webhook URL:', webhookUrl);

  const response = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      audio_url: mediaUrl,
      language_detection: true,
      speaker_labels: true,
      webhook_url: webhookUrl,
      webhook_auth_header_name: 'X-Webhook-Secret',
      webhook_auth_header_value: process.env.WEBHOOK_SECRET || 'meettask-webhook-secret',
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AssemblyAI submit error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  console.log('✅ [AssemblyAI] Job submitted! Transcript ID:', data.id);
  
  return data.id;
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
  console.log('🎯 [Orchestrator] Job submission request');
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

    // Check if already processing or completed
    if (meeting.status === 'completed') {
      return response.status(200).json({ success: true, message: 'Already processed' });
    }

    if (meeting.status === 'transcribing' || meeting.status === 'analyzing' || meeting.status === 'needs_mapping') {
      return response.status(200).json({ success: true, message: 'Already processing' });
    }

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

    console.log('📁 File URL:', fileUrl.substring(0, 60) + '...');
    console.log('📁 File type:', meeting.fileType || 'unknown');

    // ============================================
    // HANDLE IMAGES & PDFs: Simple Summary (No Task Tracking)
    // ============================================
    if (meeting.fileType === 'image' || meeting.fileType === 'pdf') {
      const fileTypeLabel = meeting.fileType === 'pdf' ? 'PDF' : 'Image';
      console.log(`🖼️ [Orchestrator] ${fileTypeLabel} file detected - using simple summary mode`);
      
      // Update status to processing
      await meetingRef.update({
        status: 'processing',
        updatedAt: FieldValue.serverTimestamp(),
      });

      let summary = '';
      let keyPoints: string[] = [];
      
      try {
        // Get summary using Gemini Vision API
        const result = await summarizeImageOrPdf(fileUrl, meeting.fileType as 'image' | 'pdf');
        summary = result.summary;
        keyPoints = result.keyPoints;
        console.log('📝 Summary:', summary.substring(0, 100));
        console.log('📝 Key points:', keyPoints.length);
      } catch (error: any) {
        console.error('❌ [Orchestrator] Summary failed:', error.message);
        summary = `Could not analyze ${fileTypeLabel.toLowerCase()}. Error: ${error.message}`;
        keyPoints = ['Please review the file manually'];
      }
      
      // Mark as COMPLETED immediately (no mapping needed for images/PDFs)
      await meetingRef.update({
        status: 'completed',
        summary: summary,
        keyPoints: keyPoints,
        processingNote: `${fileTypeLabel} analyzed with AI. No task tracking for this file type.`,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Create a simple transcript record (for consistency)
      await db.collection('transcripts').doc(meetingId).set({
        meetingId,
        userId: user.uid,
        text: summary,
        formattedTranscript: `📋 ${fileTypeLabel} Summary:\n\n${summary}\n\n📌 Key Points:\n${keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n') || 'No specific points extracted.'}`,
        summary: summary,
        keyPoints: keyPoints,
        fileType: meeting.fileType,
        isImageOrPdf: true,
        createdAt: FieldValue.serverTimestamp(),
      });

      return response.status(200).json({
        success: true,
        message: `${fileTypeLabel} analyzed successfully`,
        meetingId,
        status: 'completed',
        summary: summary,
        keyPoints: keyPoints,
      });
    }

    // ============================================
    // AUDIO/VIDEO: Submit to AssemblyAI
    // ============================================

    // Construct webhook URL
    const host = request.headers.host || 'meet-task-ai.vercel.app';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const webhookUrl = `${protocol}://${host}/api/webhook/assemblyai`;

    // Submit to AssemblyAI
    const transcriptId = await submitToAssemblyAI(fileUrl, webhookUrl);

    // Update meeting status
    await meetingRef.update({
      status: 'transcribing',
      transcriptId: transcriptId,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log('\n========================================');
    console.log('✅ [Orchestrator] Job submitted successfully!');
    console.log('   - Transcript ID:', transcriptId);
    console.log('   - Status: transcribing');
    console.log('   - Webhook will be called when done');
    console.log('========================================\n');

    return response.status(200).json({
      success: true,
      message: 'Transcription job submitted',
      meetingId,
      transcriptId,
      status: 'transcribing',
    });

  } catch (error: any) {
    console.error('❌ [Orchestrator] Error:', error.message);

    // Update meeting status to error
    if (meetingId) {
      try {
        await db.collection('meetings').doc(meetingId).update({
          status: 'error',
          errorMessage: error.message || 'Job submission failed',
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
