/**
 * fileUtils.ts - File Utility Functions
 * 
 * Simple utility functions for file handling in the UI.
 * No upload functionality - files are uploaded via Google Drive link.
 */

// ============================================
// TYPES
// ============================================
export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Get file extension from filename
 */
export function getFileExtension(fileName: string): string {
  return fileName.split('.').pop()?.toLowerCase() || '';
}

/**
 * Check if file type is allowed
 */
export function isAllowedFileType(fileName: string): boolean {
  const ext = getFileExtension(fileName);
  const allowedExtensions = ['pdf', 'docx', 'xlsx', 'zip', 'txt'];
  return allowedExtensions.includes(ext);
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
 * Open file in new tab
 */
export function openFile(fileUrl: string, fileName: string, forceDownload: boolean = false): void {
  if (forceDownload) {
    const link = document.createElement('a');
    link.href = fileUrl;
    link.download = fileName;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    window.open(fileUrl, '_blank');
  }
}

/**
 * Validate file (stub for compatibility)
 */
export function validateFile(file: File): { valid: boolean; error?: string } {
  if (!isAllowedFileType(file.name)) {
    return {
      valid: false,
      error: 'Invalid file type. Allowed: PDF, DOCX, XLSX, ZIP, TXT',
    };
  }
  return { valid: true };
}

/**
 * Stub for upload function (no longer used)
 */
export async function uploadFileToCloudinary(): Promise<{ success: false; error: string }> {
  return {
    success: false,
    error: 'File upload disabled. Please upload files to Google Drive.',
  };
}
