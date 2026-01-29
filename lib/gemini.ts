/**
 * Centralized Gemini AI Client
 * 
 * Uses official @google/generative-ai SDK (v1 API)
 * DO NOT use REST calls to v1beta - they are deprecated
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini client
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not configured');
  }
  return new GoogleGenerativeAI(apiKey);
}

// Model for text generation (task extraction, summaries, etc.)
// Using gemini-pro - correct SDK model name (free tier)
export const GEMINI_TEXT_MODEL = 'gemini-pro';

/**
 * Get Gemini model for text generation
 * Use this for: task extraction, summaries, text cleanup
 */
export function getGeminiTextModel() {
  const genAI = getGeminiClient();
  return genAI.getGenerativeModel({ model: GEMINI_TEXT_MODEL });
}

/**
 * Simple helper to generate text content
 * @param prompt - The prompt to send to Gemini
 * @returns The generated text response
 */
export async function generateText(prompt: string): Promise<string> {
  const model = getGeminiTextModel();
  const result = await model.generateContent(prompt);
  const response = await result.response;
  return response.text();
}

/**
 * Generate JSON content from Gemini
 * Parses the response as JSON array
 * @param prompt - The prompt to send to Gemini
 * @returns Parsed JSON array or empty array on failure
 */
export async function generateJSON<T = any>(prompt: string): Promise<T[]> {
  try {
    const text = await generateText(prompt);
    
    // Try to find JSON array in response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    // Try direct parse
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('[Gemini] Failed to parse JSON response:', error);
    return [];
  }
}
