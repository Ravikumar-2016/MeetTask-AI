/**
 * Test Video OCR API
 * 
 * GET /api/test-vision?url=...
 * 
 * Test endpoint to verify Tesseract.js OCR is working.
 * Pass a Cloudinary video URL to test frame extraction and OCR.
 * 
 * 🆓 NO API KEY NEEDED - Uses Tesseract.js (free, local OCR)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Tesseract from 'tesseract.js';

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (request.method === 'OPTIONS') {
    return response.status(200).end();
  }

  const videoUrl = request.query.url as string;
  const timestamp = parseInt(request.query.t as string) || 5;

  if (!videoUrl) {
    return response.status(400).json({
      error: 'Missing url parameter',
      usage: '/api/test-vision?url=YOUR_CLOUDINARY_VIDEO_URL&t=5',
      note: '🆓 Using Tesseract.js - NO API KEY NEEDED!',
    });
  }

  try {
    // Step 1: Generate frame URL
    const cloudinaryRegex = /https:\/\/res\.cloudinary\.com\/([^\/]+)\/([^\/]+)\/upload\/(?:v\d+\/)?(.+)$/;
    const match = videoUrl.match(cloudinaryRegex);
    
    if (!match) {
      return response.status(400).json({
        error: 'Not a valid Cloudinary URL',
        expected: 'https://res.cloudinary.com/{cloud}/video/upload/...',
        received: videoUrl.substring(0, 100),
      });
    }

    const [, cloudName, , publicIdWithExt] = match;
    const publicId = publicIdWithExt.replace(/\.[^.]+$/, '');
    const frameUrl = `https://res.cloudinary.com/${cloudName}/video/upload/so_${timestamp},f_jpg,w_1920,q_90/${publicId}.jpg`;

    console.log('Frame URL:', frameUrl);

    // Step 2: Fetch the frame image
    const imageResponse = await fetch(frameUrl);
    if (!imageResponse.ok) {
      return response.status(400).json({
        error: 'Failed to fetch frame from Cloudinary',
        status: imageResponse.status,
        frameUrl,
      });
    }

    const arrayBuffer = await imageResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const imageSizeKB = Math.round(buffer.length / 1024);

    console.log('Image fetched, size:', imageSizeKB, 'KB');

    // Step 3: Run Tesseract OCR (FREE - no API key!)
    console.log('Running Tesseract OCR...');
    const startTime = Date.now();
    
    const result = await Tesseract.recognize(buffer, 'eng', {
      logger: (m) => {
        if (m.status === 'recognizing text' && m.progress === 1) {
          console.log('OCR complete');
        }
      },
    });
    
    const ocrTime = Date.now() - startTime;
    const fullText = result.data.text || '';
    const lines = fullText.split(/[\n\r]+/).filter((l: string) => l.trim());
    const confidence = result.data.confidence;

    console.log('OCR completed in', ocrTime, 'ms');
    console.log('Text detected:', fullText.substring(0, 200));

    // Step 4: Extract names
    const names: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length < 4 || trimmed.length > 40) continue;
      
      const beforeDash = trimmed.split(/\s*[-–—]\s*/)[0].trim();
      const words = beforeDash.split(/\s+/);
      
      if (words.length >= 2 && words.length <= 3) {
        const allCapitalized = words.every((w: string) => /^[A-Z][a-z]+$/.test(w));
        if (allCapitalized && !names.includes(beforeDash)) {
          names.push(beforeDash);
        }
      }
    }

    return response.status(200).json({
      success: true,
      engine: 'Tesseract.js (FREE - no API key)',
      frameUrl,
      imageSizeKB,
      timestamp,
      ocrTimeMs: ocrTime,
      confidence: Math.round(confidence),
      textDetected: fullText.length > 0,
      fullText: fullText.substring(0, 1000),
      lines: lines.slice(0, 30),
      extractedNames: names,
    });

  } catch (error: any) {
    return response.status(500).json({
      error: 'Exception',
      message: error.message,
    });
  }
}
