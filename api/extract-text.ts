/**
 * Extract Text API - Gemini Vision OCR
 * 
 * POST /api/extract-text
 * 
 * Uses Google Gemini Vision API to extract text from:
 * - Images (JPG, PNG, WEBP, etc.)
 * - PDFs (converted to images per page)
 * 
 * Features:
 * - High-quality OCR using Gemini Vision
 * - Text cleaning (fix broken lines, merge wrapped text)
 * - Preserves paragraph structure
 * - Returns cleaned transcript ready for task extraction
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { GoogleGenerativeAI } from '@google/generative-ai';

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

function getAdminAuth() {
  initAdmin();
  return getAuth();
}

// ============================================
// AUTH VERIFICATION
// ============================================
async function verifyToken(request: VercelRequest): Promise<{ uid: string; email?: string }> {
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
// GEMINI VISION OCR
// ============================================

/**
 * Extract text from image using Gemini Vision API
 */
async function extractTextWithGemini(imageUrl: string, fileType: 'image' | 'pdf'): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  console.log('🔮 [Gemini] Initializing Gemini Vision API...');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

  // Fetch the image/PDF from Cloudinary
  console.log('📥 [Gemini] Fetching file from:', imageUrl.substring(0, 60) + '...');
  const imageResponse = await fetch(imageUrl);
  
  if (!imageResponse.ok) {
    throw new Error(`Failed to fetch file: ${imageResponse.status}`);
  }

  const imageBuffer = await imageResponse.arrayBuffer();
  const base64Image = Buffer.from(imageBuffer).toString('base64');
  
  // Determine MIME type
  let mimeType = 'image/jpeg';
  if (imageUrl.includes('.png')) mimeType = 'image/png';
  else if (imageUrl.includes('.webp')) mimeType = 'image/webp';
  else if (imageUrl.includes('.gif')) mimeType = 'image/gif';
  else if (imageUrl.includes('.pdf') || fileType === 'pdf') mimeType = 'application/pdf';

  console.log('🔮 [Gemini] Processing with MIME type:', mimeType);

  // Create prompt for OCR
  const prompt = `You are an OCR specialist. Extract ALL text from this ${fileType === 'pdf' ? 'PDF document' : 'image'} exactly as it appears.

INSTRUCTIONS:
1. Extract every word, number, and symbol visible in the ${fileType === 'pdf' ? 'document' : 'image'}
2. Fix any broken lines or wrapped text - merge them into proper sentences
3. Preserve paragraph structure with blank lines between paragraphs
4. If there are speaker names (like "John:", "Manager:", etc.), keep them on their own lines
5. Do NOT add any commentary, explanations, or descriptions
6. Do NOT use markdown formatting - just plain text
7. If there are bullet points or numbered lists, preserve them
8. If there are multiple pages or sections, separate them clearly

OUTPUT: Return ONLY the extracted text, cleaned and properly formatted. No other text.`;

  try {
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Image,
        },
      },
    ]);

    const response = await result.response;
    const extractedText = response.text();
    
    console.log('✅ [Gemini] Text extracted, length:', extractedText.length);
    console.log('📝 [Gemini] Preview:', extractedText.substring(0, 200));
    
    return cleanExtractedText(extractedText);
  } catch (error: any) {
    console.error('❌ [Gemini] OCR error:', error.message);
    throw new Error(`Gemini OCR failed: ${error.message}`);
  }
}

/**
 * Clean and format extracted text
 */
function cleanExtractedText(rawText: string): string {
  let text = rawText;
  
  // Remove any markdown code blocks if present
  text = text.replace(/```[\s\S]*?```/g, '');
  text = text.replace(/`/g, '');
  
  // Fix common OCR issues
  // Remove excessive whitespace within lines
  text = text.replace(/[ \t]+/g, ' ');
  
  // Fix broken lines (hyphenated words at line breaks)
  text = text.replace(/-\s*\n\s*/g, '');
  
  // Normalize line breaks
  text = text.replace(/\r\n/g, '\n');
  text = text.replace(/\r/g, '\n');
  
  // Remove excessive blank lines (more than 2)
  text = text.replace(/\n{3,}/g, '\n\n');
  
  // Trim whitespace from each line
  text = text.split('\n').map(line => line.trim()).join('\n');
  
  // Remove leading/trailing whitespace
  text = text.trim();
  
  return text;
}

// ============================================
// API HANDLER
// ============================================
export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  // CORS headers
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  if (request.method !== 'POST') {
    return response.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Verify authentication
    const user = await verifyToken(request);
    console.log('👤 [ExtractText] User authenticated:', user.email);

    // Get request body
    const { fileUrl, fileType } = request.body;

    if (!fileUrl) {
      return response.status(400).json({ 
        success: false, 
        error: 'Missing fileUrl in request body' 
      });
    }

    const validFileTypes = ['image', 'pdf'];
    const type = validFileTypes.includes(fileType) ? fileType : 'image';

    console.log('📄 [ExtractText] Processing:', type, 'from', fileUrl.substring(0, 50) + '...');

    // Extract text using Gemini Vision
    const extractedText = await extractTextWithGemini(fileUrl, type);

    if (!extractedText || extractedText.length < 10) {
      return response.status(200).json({
        success: true,
        text: 'No readable text could be extracted from this file.',
        wordCount: 0,
        warning: 'File may not contain readable text'
      });
    }

    const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;

    console.log('✅ [ExtractText] Success - Words:', wordCount);

    return response.status(200).json({
      success: true,
      text: extractedText,
      wordCount,
      fileType: type
    });

  } catch (error: any) {
    console.error('❌ [ExtractText] Error:', error.message);
    
    if (error.message.includes('Authorization') || error.message.includes('token')) {
      return response.status(401).json({ success: false, error: 'Unauthorized' });
    }

    return response.status(500).json({ 
      success: false, 
      error: error.message || 'Text extraction failed'
    });
  }
}
