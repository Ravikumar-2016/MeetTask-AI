/**
 * fileUpload.ts - Cloudinary File Upload Service
 * 
 * Handles secure file uploads to Cloudinary using signed requests.
 * Features:
 * - Signed uploads (secrets stay on server)
 * - File type validation
 * - File size validation
 * - Upload progress tracking
 * - Error handling
 */

import { auth } from './firebase';
import { CloudinarySignResponse, ALLOWED_FILE_EXTENSIONS, MAX_FILE_SIZE, AllowedFileExtension } from '../types';

// ============================================
// CONSTANTS
// ============================================
const CLOUDINARY_UPLOAD_URL = 'https://api.cloudinary.com/v1_1';

// MIME type mapping for validation
const MIME_TYPE_MAP: Record<AllowedFileExtension, string[]> = {
  pdf: ['application/pdf'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  zip: ['application/zip', 'application/x-zip-compressed', 'application/x-zip'],
  txt: ['text/plain'],
};

// ============================================
// TYPES
// ============================================
export interface FileUploadResult {
  success: boolean;
  fileUrl?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
  publicId?: string;
  error?: string;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export type ProgressCallback = (progress: UploadProgress) => void;

// ============================================
// VALIDATION HELPERS
// ============================================

/**
 * Get file extension from filename
 */
export function getFileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

/**
 * Validate file extension
 */
export function isAllowedFileType(fileName: string): boolean {
  const ext = getFileExtension(fileName);
  return ALLOWED_FILE_EXTENSIONS.includes(ext as AllowedFileExtension);
}

/**
 * Validate file size
 */
export function isFileSizeValid(fileSize: number): boolean {
  return fileSize <= MAX_FILE_SIZE;
}

/**
 * Get human-readable file size
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validate file before upload
 */
export function validateFile(file: File): { valid: boolean; error?: string } {
  // Check file extension
  if (!isAllowedFileType(file.name)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed formats: ${ALLOWED_FILE_EXTENSIONS.map(e => e.toUpperCase()).join(', ')}`,
    };
  }

  // Check file size
  if (!isFileSizeValid(file.size)) {
    return {
      valid: false,
      error: `File too large. Maximum size is ${formatFileSize(MAX_FILE_SIZE)}`,
    };
  }

  // Check if file has content
  if (file.size === 0) {
    return {
      valid: false,
      error: 'File is empty',
    };
  }

  return { valid: true };
}

// ============================================
// UPLOAD FUNCTIONS
// ============================================

/**
 * Get signed upload parameters from server
 */
async function getUploadSignature(
  taskId: string,
  meetingId: string,
  fileName: string,
  fileSize: number,
  fileType: string
): Promise<CloudinarySignResponse> {
  const token = await auth.currentUser?.getIdToken();
  
  if (!token) {
    throw new Error('Not authenticated. Please sign in again.');
  }

  const response = await fetch('/api/cloudinary-sign', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      taskId,
      meetingId,
      fileName,
      fileSize,
      fileType,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to get upload signature');
  }

  return response.json();
}

/**
 * Upload file to Cloudinary with signed request
 */
export async function uploadFileToCloudinary(
  file: File,
  taskId: string,
  meetingId: string,
  onProgress?: ProgressCallback
): Promise<FileUploadResult> {
  console.log('[FileUpload] Starting upload for:', file.name);

  // Validate file
  const validation = validateFile(file);
  if (!validation.valid) {
    console.error('[FileUpload] Validation failed:', validation.error);
    return { success: false, error: validation.error };
  }

  try {
    // Step 1: Get signed upload parameters
    console.log('[FileUpload] Getting upload signature...');
    const signData = await getUploadSignature(
      taskId,
      meetingId,
      file.name,
      file.size,
      file.type
    );

    if (!signData.success) {
      throw new Error('Failed to get upload authorization');
    }

    console.log('[FileUpload] Signature received');
    console.log('[FileUpload] Folder:', signData.folder);
    console.log('[FileUpload] Public ID:', signData.publicId);
    console.log('[FileUpload] Timestamp:', signData.timestamp);

    // Step 2: Upload to Cloudinary
    // IMPORTANT: Only send params that were signed (folder, public_id, timestamp)
    const formData = new FormData();
    formData.append('file', file);
    formData.append('api_key', signData.apiKey);
    formData.append('folder', signData.folder);
    formData.append('public_id', signData.publicId);
    formData.append('timestamp', signData.timestamp.toString());
    formData.append('signature', signData.signature);

    // Use XMLHttpRequest for progress tracking
    const result = await new Promise<FileUploadResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      // Track upload progress
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress({
            loaded: event.loaded,
            total: event.total,
            percentage: Math.round((event.loaded / event.total) * 100),
          });
        }
      });

      // Handle completion
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            console.log('[FileUpload] Upload successful:', data.secure_url);
            resolve({
              success: true,
              fileUrl: data.secure_url,
              fileName: file.name,
              fileSize: file.size,
              fileType: file.type,
              publicId: data.public_id,
            });
          } catch (e) {
            reject(new Error('Invalid response from upload server'));
          }
        } else {
          let errorMessage = 'Upload failed';
          try {
            const errorData = JSON.parse(xhr.responseText);
            errorMessage = errorData.error?.message || errorMessage;
          } catch {}
          reject(new Error(errorMessage));
        }
      });

      // Handle errors
      xhr.addEventListener('error', () => {
        reject(new Error('Network error. Please check your connection.'));
      });

      xhr.addEventListener('abort', () => {
        reject(new Error('Upload was cancelled'));
      });

      xhr.addEventListener('timeout', () => {
        reject(new Error('Upload timed out. Please try again.'));
      });

      // Set timeout (5 minutes for large files)
      xhr.timeout = 5 * 60 * 1000;

      // Send request
      const uploadUrl = `${CLOUDINARY_UPLOAD_URL}/${signData.cloudName}/auto/upload`;
      xhr.open('POST', uploadUrl);
      xhr.send(formData);
    });

    return result;

  } catch (error: any) {
    console.error('[FileUpload] Error:', error);
    return {
      success: false,
      error: error.message || 'Failed to upload file. Please try again.',
    };
  }
}

/**
 * Get file icon based on extension
 */
export function getFileIcon(fileName: string): string {
  const ext = getFileExtension(fileName);
  switch (ext) {
    case 'pdf':
      return 'picture_as_pdf';
    case 'docx':
      return 'description';
    case 'xlsx':
      return 'table_chart';
    case 'zip':
      return 'folder_zip';
    case 'txt':
      return 'text_snippet';
    default:
      return 'attach_file';
  }
}

/**
 * Check if file can be previewed in browser
 */
export function canPreviewFile(fileName: string): boolean {
  const ext = getFileExtension(fileName);
  return ext === 'pdf' || ext === 'txt';
}
