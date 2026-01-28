
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { processMeeting } from '../services/api';

// ============================================
// CLOUDINARY CONFIGURATION
// ============================================
const CLOUDINARY_CLOUD_NAME = 'dmdyvkf2j';
const CLOUDINARY_UPLOAD_PRESET = 'meeting_uploads';

// File type detection helper
type FileType = 'image' | 'video' | 'audio' | 'pdf';

const detectFileType = (file: File): FileType => {
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  return 'audio';
};

// Get Cloudinary upload URL based on file type
const getCloudinaryUploadUrl = (fileType: FileType): string => {
  // For PDFs, use /raw/upload; for images use /image/upload; for audio/video use /video/upload
  let resourceType = 'video';
  if (fileType === 'image') resourceType = 'image';
  else if (fileType === 'pdf') resourceType = 'raw';
  
  return `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;
};

// Cloudinary response type
interface CloudinaryResponse {
  secure_url: string;
  public_id: string;
  folder: string;
  format: string;
  resource_type: string;
  bytes: number;
  duration?: number;
  original_filename: string;
}

const UploadPage: React.FC = () => {
  const { user } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      if (!title) {
        setTitle(selectedFile.name.split('.')[0]);
      }
    }
  };

  /**
   * Upload file directly to Cloudinary (unsigned upload)
   * This bypasses the backend to avoid Vercel's file size limits
   * 
   * @param file - The file to upload
   * @param fileType - 'image', 'video', or 'audio' to determine Cloudinary resource type
   */
  const uploadToCloudinary = async (file: File, fileType: FileType): Promise<CloudinaryResponse> => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    // Note: folder is configured in the upload preset on Cloudinary dashboard
    // If you need to override, add: formData.append('folder', 'meetings');

    // Get correct upload URL based on file type
    const uploadUrl = getCloudinaryUploadUrl(fileType);
    console.log(`[Cloudinary] Using ${fileType} upload endpoint:`, uploadUrl);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      // Track upload progress
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round((event.loaded / event.total) * 100);
          setProgress(percentComplete);
          console.log(`[Cloudinary] Upload progress: ${percentComplete}%`);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const response: CloudinaryResponse = JSON.parse(xhr.responseText);
          console.log('[Cloudinary] Upload successful:', response);
          console.log('[Cloudinary] File URL:', response.secure_url);
          console.log('[Cloudinary] Folder:', response.folder || 'root (check preset config)');
          console.log('[Cloudinary] Public ID:', response.public_id);
          console.log('[Cloudinary] Resource type:', response.resource_type);
          resolve(response);
        } else {
          console.error('[Cloudinary] Upload failed:', xhr.status, xhr.responseText);
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      });

      xhr.addEventListener('error', () => {
        console.error('[Cloudinary] Network error during upload');
        reject(new Error('Network error during upload'));
      });

      xhr.open('POST', uploadUrl);
      xhr.send(formData);
    });
  };

  /**
   * Save meeting metadata to Firestore after successful Cloudinary upload
   * 
   * IMPORTANT: Frontend ONLY sets status to 'uploaded'.
   * Backend orchestrator controls all status updates after this.
   * 
   * For images and PDFs, OCR is done server-side via Gemini Vision API.
   * 
   * @param cloudinaryUrl - The secure URL from Cloudinary
   * @param fileName - Original file name
   * @param fileType - 'image', 'video', 'audio', or 'pdf'
   */
  const saveToFirestore = async (
    cloudinaryUrl: string, 
    fileName: string, 
    fileType: FileType
  ) => {
    if (!user) throw new Error('User not authenticated');

    // ALWAYS set status to 'uploaded' - backend controls lifecycle from here
    const meetingData: any = {
      title: title.trim(),
      userId: user.uid,
      audioUrl: cloudinaryUrl, // Keep field name for backward compatibility
      fileUrl: cloudinaryUrl,  // Also save as fileUrl for clarity
      fileType: fileType,
      status: 'uploaded' as const, // Frontend ONLY sets this, backend handles rest
      createdAt: serverTimestamp(),
      originalFileName: fileName,
    };

    console.log('[Firestore] Saving meeting:', meetingData);
    console.log('[Firestore] File type:', fileType);
    
    const docRef = await addDoc(collection(db, 'meetings'), meetingData);
    console.log('[Firestore] Meeting saved with ID:', docRef.id);
    
    return docRef.id;
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title || !user) return;

    setUploading(true);
    setError('');
    setProgress(0);
    setProgressMessage('');

    try {
      // Step 1: Detect file type
      const fileType = detectFileType(file);
      console.log('[Upload] Detected file type:', fileType);

      // Step 2: Upload to Cloudinary with correct resource type
      setProgressMessage('Uploading file...');
      console.log('[Upload] Starting Cloudinary upload for:', file.name);
      const cloudinaryResponse = await uploadToCloudinary(file, fileType);

      // Step 3: Verify upload was successful
      if (!cloudinaryResponse.secure_url) {
        throw new Error('Cloudinary did not return a secure URL');
      }

      // Step 4: Log file type (OCR is done server-side for images/PDFs)
      if (fileType === 'image' || fileType === 'pdf') {
        console.log('[Upload] Image/PDF detected - OCR will be done server-side via Gemini Vision');
        setProgress(70);
      }

      // Step 5: Verify folder (if preset is configured correctly)
      if (cloudinaryResponse.public_id) {
        const expectedFolder = 'meetings/';
        if (!cloudinaryResponse.public_id.startsWith(expectedFolder.replace('/', ''))) {
          console.warn(
            `[Cloudinary] Warning: File may not be in expected folder.`,
            `Expected: ${expectedFolder}, Got public_id: ${cloudinaryResponse.public_id}`,
            `Make sure upload preset "${CLOUDINARY_UPLOAD_PRESET}" has folder set to "meetings"`
          );
        }
      }

      // Step 6: Save to Firestore with file type
      setProgressMessage('Saving to database...');
      console.log('[Upload] Saving to Firestore...');
      const meetingId = await saveToFirestore(cloudinaryResponse.secure_url, file.name, fileType);

      console.log('[Upload] Complete! Meeting ID:', meetingId);
      setProgress(85);

      // Step 7: Trigger AI Orchestrator for ALL file types
      // The orchestrator will handle the appropriate processing based on file type
      // - Audio/Video: AssemblyAI transcription + speaker diarization
      // - Images/PDFs: Gemini Vision OCR → transcript → needs_mapping
      setProgressMessage('Starting AI analysis...');
      console.log('[Upload] Triggering AI orchestrator...');
      
      try {
        const result = await processMeeting(meetingId);
        console.log('[Upload] Orchestrator result:', result);
        
        setProgress(100);
        
        if (result.success) {
          console.log('[Upload] Orchestrator completed successfully:', result.message);
          setSuccess(true);
        } else {
          console.error('[Upload] Orchestrator failed:', result.error);
          // Still show success for upload, but log the error
          // The meeting can be reprocessed later
          setSuccess(true);
          setError(`Upload complete, but AI processing failed: ${result.error}`);
        }
      } catch (orchestratorError: any) {
        console.error('[Upload] Orchestrator exception:', orchestratorError);
        setSuccess(true);
        setError(`Upload complete, but AI processing failed: ${orchestratorError.message}`);
      }

      setUploading(false);

      // Redirect after showing success message
      setTimeout(() => navigate('/meetings'), 3000);

    } catch (err) {
      console.error('[Upload] Error:', err);
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
      setUploading(false);
      setProgress(0);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="max-w-3xl mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Upload Meeting</h1>
        <p className="text-slate-500">Upload your recording to start the AI analysis.</p>
      </div>

      <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
        {success ? (
          <div className="text-center py-10 space-y-4">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <span className="material-icons text-emerald-600 text-4xl">check_circle</span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900">Upload Complete!</h2>
            <p className="text-slate-600">Your meeting is being processed. You'll be redirected shortly.</p>
          </div>
        ) : (
          <form onSubmit={handleUpload} className="space-y-6">
            <div 
              onClick={triggerFileInput}
              className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
                file ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 hover:border-indigo-400 hover:bg-slate-50'
              }`}
            >
              <input 
                type="file" 
                className="hidden" 
                ref={fileInputRef} 
                onChange={handleFileChange}
                accept="audio/*,video/*,image/*,.pdf,application/pdf"
              />
              <div className="space-y-2">
                <span className="material-icons text-slate-400 text-5xl">cloud_upload</span>
                <div className="text-lg font-bold text-slate-900">
                  {file ? file.name : 'Click to upload or drag and drop'}
                </div>
                <p className="text-sm text-slate-500">MP4, MOV, MP3, WAV, JPG, PNG, PDF (Max 500MB)</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Meeting Title</label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition"
                placeholder="e.g. Project Apollo Kickoff"
              />
            </div>

            {uploading && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm font-bold text-slate-700">
                  <span>{progressMessage || 'Processing...'}</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-600 transition-all duration-300" style={{ width: `${progress}%` }}></div>
                </div>
              </div>
            )}

            {error && (
              <p className="text-red-600 text-sm font-bold bg-red-50 p-4 rounded-xl border border-red-100">{error}</p>
            )}

            <div className="flex justify-end pt-4">
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="px-6 py-3 text-slate-600 font-bold hover:bg-slate-50 rounded-xl transition mr-4"
              >
                Cancel
              </button>
              <button
                disabled={!file || !title || uploading}
                className="bg-indigo-600 text-white px-10 py-3 rounded-xl font-bold hover:bg-indigo-700 transition disabled:opacity-50 shadow-lg shadow-indigo-100"
              >
                {uploading ? 'Processing...' : 'Process Meeting'}
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="mt-8 bg-blue-50 border border-blue-100 p-6 rounded-2xl flex items-start space-x-4">
        <span className="material-icons text-blue-500">info</span>
        <div>
          <h4 className="font-bold text-blue-900">How long does it take?</h4>
          <p className="text-sm text-blue-700 leading-relaxed">
            Our AI typically processes meetings in 1/5th of the recording length. 
            A 60-minute meeting will take roughly 12 minutes to analyze. We'll email you when it's ready.
          </p>
        </div>
      </div>
    </div>
  );
};

export default UploadPage;
