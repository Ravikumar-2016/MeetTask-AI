/**
 * fileUpload.ts - Cloudinary File Upload Service
 * 
 * Handles file uploads to Cloudinary using unsigned public preset.
 * Simple, stable approach for task file submissions.
 * 
 * Features:
 * - Direct unsigned uploads (same as meeting uploads)
 * - File type validation
 * - File size validation (20MB max)
 * - Upload progress tracking
 * - Direct Cloudinary URL usage (no backend proxy)
 */

import { auth } from './firebase';
import { ALLOWED_FILE_EXTENSIONS, MAX_FILE_SIZE, AllowedFileExtension } from '../types';

// ============================================
// CONSTANTS
// ============================================
const CLOUDINARY_CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'dmdyvkf2j';
// Use task_files_upload preset if available, fallback to meeting_uploads
// Make sure the preset is configured as "unsigned" and allows "raw" resource type
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_TASK_PRESET || 'meeting_uploads';

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

interface CloudinaryUploadResponse {
  secure_url: string;
  public_id: string;
  format: string;
  resource_type: string;
  bytes: number;
  folder?: string;
}

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
 * Upload file directly to Cloudinary using unsigned preset
 * Simple and stable approach - same as meeting uploads
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
    // Prepare form data for unsigned upload
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    formData.append('folder', `meettask/tasks/${taskId}`); // Organize by task
    formData.append('resource_type', 'auto'); // Let Cloudinary detect the file type
    
    // Use auto endpoint which works for all file types
    const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
    console.log('[FileUpload] Upload Configuration:');
    console.log('  - Cloud Name:', CLOUDINARY_CLOUD_NAME);
    console.log('  - Upload Preset:', CLOUDINARY_UPLOAD_PRESET);
    console.log('  - Folder: meettask/tasks/' + taskId);
    console.log('  - Endpoint:', uploadUrl);
    console.log('  - Resource Type: auto');
    console.log('  - File:', file.name, `(${formatFileSize(file.size)})`);

    // Upload with XMLHttpRequest for progress tracking
    const response = await new Promise<CloudinaryUploadResponse>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // Track upload progress
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && onProgress) {
          const progress: UploadProgress = {
            loaded: event.loaded,
            total: event.total,
            percentage: Math.round((event.loaded / event.total) * 100),
          };
          onProgress(progress);
          console.log(`[FileUpload] Progress: ${progress.percentage}%`);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const uploadResponse: CloudinaryUploadResponse = JSON.parse(xhr.responseText);
            console.log('[FileUpload] Upload successful!');
            console.log('[FileUpload] URL:', uploadResponse.secure_url);
            console.log('[FileUpload] Public ID:', uploadResponse.public_id);
            resolve(uploadResponse);
          } catch (parseError) {
            console.error('[FileUpload] Failed to parse response:', xhr.responseText);
            reject(new Error('Invalid response from upload server. Please check your Cloudinary configuration.'));
          }
        } else {
          console.error('[FileUpload] Upload failed:', xhr.status);
          
          // Try to parse error response
          let errorMessage = `Upload failed with status ${xhr.status}`;
          try {
            const errorResponse = JSON.parse(xhr.responseText);
            if (errorResponse.error?.message) {
              errorMessage = errorResponse.error.message;
            }
          } catch {
            // Response is not JSON (might be HTML error page)
            if (xhr.responseText.includes('<!DOCTYPE') || xhr.responseText.includes('<html')) {
              errorMessage = 'Upload server error. Please check your Cloudinary preset configuration.';
            } else if (xhr.responseText) {
              errorMessage = `Upload failed: ${xhr.responseText.substring(0, 100)}`;
            }
          }
          
          console.error('[FileUpload] Error details:', errorMessage);
          reject(new Error(errorMessage));
        }
      });

      xhr.addEventListener('error', () => {
        console.error('[FileUpload] Network error during upload');
        reject(new Error('Network error during upload. Please check your internet connection.'));
      });

      xhr.open('POST', uploadUrl);
      xhr.send(formData);
    });

    // Return success result with direct Cloudinary URL
    return {
      success: true,
      fileUrl: response.secure_url,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      publicId: response.public_id,
    };

  } catch (error: any) {
    console.error('[FileUpload] Error:', error);
    return {
      success: false,
      error: error.message || 'Upload failed',
    };
  }
}

// ============================================
// HELPER FUNCTIONS FOR UI
// ============================================

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

/**
 * Open file in new tab - uses direct Cloudinary URL
 */
export function openFile(fileUrl: string, fileName: string, forceDownload: boolean = false): void {
  if (forceDownload) {
    // Force download
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = fileName;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    // Open in new tab for preview
    window.open(fileUrl, '_blank');
  }
}
