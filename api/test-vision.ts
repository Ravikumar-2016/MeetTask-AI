/**
 * Test Video OCR API
 * 
 * GET /api/test-vision?url=...
 * 
 * Test endpoint to verify Google Cloud Vision OCR is working.
 * Pass a Cloudinary video URL to test frame extraction and OCR.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

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
    });
  }

  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  if (!apiKey) {
    return response.status(500).json({
      error: 'GOOGLE_CLOUD_VISION_API_KEY not configured',
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
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    const imageSizeKB = Math.round(base64.length / 1024);

    console.log('Image fetched, size:', imageSizeKB, 'KB');

    // Step 3: Send to Vision API
    const visionResponse = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          image: { content: base64 },
          features: [{ type: 'TEXT_DETECTION', maxResults: 50 }],
        }],
      }),
    });

    if (!visionResponse.ok) {
      const errText = await visionResponse.text();
      return response.status(500).json({
        error: 'Vision API error',
        status: visionResponse.status,
        details: errText.substring(0, 500),
      });
    }

    const visionData = await visionResponse.json();
    
    if (visionData.responses?.[0]?.error) {
      return response.status(500).json({
        error: 'Vision API response error',
        details: visionData.responses[0].error,
      });
    }

    const annotations = visionData.responses?.[0]?.textAnnotations || [];
    const fullText = annotations[0]?.description || '';
    const lines = fullText.split(/[\n\r]+/).filter((l: string) => l.trim());

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
      frameUrl,
      imageSizeKB,
      timestamp,
      textDetected: fullText.length > 0,
      fullText: fullText.substring(0, 1000),
      lines: lines.slice(0, 30),
      extractedNames: names,
      annotationCount: annotations.length,
    });

  } catch (error: any) {
    return response.status(500).json({
      error: 'Exception',
      message: error.message,
    });
  }
}
