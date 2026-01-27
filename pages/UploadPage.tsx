
import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const UploadPage: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
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

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !title) return;

    setUploading(true);
    setError('');
    setProgress(0);

    // Simulation for demo purposes if backend isn't real
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);

    try {
      // In a real production scenario, you would use axios or fetch
      // await axios.post('/api/upload', formData, {
      //   onUploadProgress: (progressEvent) => {
      //     const p = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 100));
      //     setProgress(p);
      //   }
      // });

      // Simulate network request
      let currentProgress = 0;
      const interval = setInterval(() => {
        currentProgress += Math.random() * 30;
        if (currentProgress >= 100) {
          clearInterval(interval);
          setProgress(100);
          setSuccess(true);
          setUploading(false);
          // Redirect after 2 seconds
          setTimeout(() => navigate('/meetings'), 2000);
        } else {
          setProgress(currentProgress);
        }
      }, 400);

    } catch (err) {
      setError('Upload failed. Please check your network and try again.');
      setUploading(false);
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
                accept="audio/*,video/*"
              />
              <div className="space-y-2">
                <span className="material-icons text-slate-400 text-5xl">cloud_upload</span>
                <div className="text-lg font-bold text-slate-900">
                  {file ? file.name : 'Click to upload or drag and drop'}
                </div>
                <p className="text-sm text-slate-500">MP4, MOV, MP3 or WAV (Max 500MB)</p>
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
                  <span>Uploading...</span>
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
