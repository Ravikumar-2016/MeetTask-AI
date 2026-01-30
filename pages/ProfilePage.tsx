
import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../hooks/useToast';
import ToastContainer from '../components/ToastContainer';

const ProfilePage: React.FC = () => {
  const { user, logout, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toasts, success, removeToast } = useToast();
  
  // Page loading state
  const [pageLoading, setPageLoading] = useState(true);
  
  // Form state
  const [language, setLanguage] = useState('English (US)');
  const [workspaceName, setWorkspaceName] = useState('My Team Workspace');
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Logout modal state
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  // Simulate page load
  useEffect(() => {
    if (!authLoading) {
      const timer = setTimeout(() => setPageLoading(false), 400);
      return () => clearTimeout(timer);
    }
  }, [authLoading]);

  // Track changes
  const handleLanguageChange = (value: string) => {
    setLanguage(value);
    setHasChanges(true);
  };

  const handleWorkspaceChange = (value: string) => {
    setWorkspaceName(value);
    setHasChanges(true);
  };

  // Save changes (simulated - no backend)
  const handleSaveChanges = async () => {
    setSaving(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 800));
    setSaving(false);
    setHasChanges(false);
    success('Settings saved successfully!');
  };

  // Logout with confirmation
  const handleLogoutClick = () => {
    setShowLogoutModal(true);
  };

  const handleConfirmLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout failed:', error);
      setLoggingOut(false);
      setShowLogoutModal(false);
    }
  };

  // Skeleton Loading State
  if (pageLoading || authLoading) {
    return (
      <div className="max-w-4xl mx-auto py-8 animate-pulse">
        <div className="mb-8">
          <div className="h-8 w-48 bg-slate-200 rounded-lg mb-2"></div>
          <div className="h-5 w-72 bg-slate-100 rounded-lg"></div>
        </div>
        
        {/* Profile Card Skeleton */}
        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm mb-6">
          <div className="flex flex-col md:flex-row items-center space-y-4 md:space-y-0 md:space-x-8">
            <div className="w-24 h-24 rounded-full bg-slate-200"></div>
            <div className="flex-1 text-center md:text-left space-y-3">
              <div className="h-7 w-48 bg-slate-200 rounded-lg mx-auto md:mx-0"></div>
              <div className="h-5 w-56 bg-slate-100 rounded-lg mx-auto md:mx-0"></div>
              <div className="flex gap-2 justify-center md:justify-start">
                <div className="h-6 w-20 bg-slate-100 rounded-full"></div>
                <div className="h-6 w-24 bg-slate-100 rounded-full"></div>
              </div>
            </div>
            <div className="h-10 w-24 bg-slate-100 rounded-xl"></div>
          </div>
        </div>

        {/* Settings Skeleton */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="h-6 w-32 bg-slate-200 rounded-lg mb-4"></div>
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex justify-between items-center">
                  <div className="space-y-1">
                    <div className="h-4 w-24 bg-slate-200 rounded"></div>
                    <div className="h-3 w-40 bg-slate-100 rounded"></div>
                  </div>
                  <div className="h-5 w-10 bg-slate-200 rounded-full"></div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <div className="h-6 w-24 bg-slate-200 rounded-lg mb-4"></div>
            <div className="space-y-4">
              <div className="h-10 w-full bg-slate-100 rounded-lg"></div>
              <div className="h-10 w-full bg-slate-100 rounded-lg"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      
      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 animate-fadeIn">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 animate-scaleIn">
            <div className="text-center">
              <div className="w-14 h-14 bg-rose-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="material-icons text-rose-600 text-2xl">logout</span>
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Sign Out?</h3>
              <p className="text-slate-500 text-sm mb-6">
                Are you sure you want to sign out of your account?
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowLogoutModal(false)}
                  disabled={loggingOut}
                  className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-xl transition disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmLogout}
                  disabled={loggingOut}
                  className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loggingOut ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Signing out...
                    </>
                  ) : (
                    'Sign Out'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <div className="max-w-4xl mx-auto py-8">
        <div className="mb-6 sm:mb-8 animate-fadeIn">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900">Your Profile</h1>
          <p className="text-sm sm:text-base text-slate-500">Manage your account settings and preferences.</p>
        </div>

        <div className="space-y-4 sm:space-y-6">
          {/* Profile Card */}
          <div className="bg-white p-4 sm:p-8 rounded-xl sm:rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow duration-300 animate-fadeIn" style={{ animationDelay: '50ms' }}>
            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
              <div className="relative group">
                <img
                  src={user?.photoURL || `https://ui-avatars.com/api/?name=${user?.displayName || 'User'}&background=6366f1&color=fff&bold=true`}
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-full border-4 border-white shadow-lg ring-2 ring-slate-100"
                  alt="Profile"
                />
                <button 
                  className="absolute bottom-0 right-0 bg-indigo-600 text-white p-1.5 sm:p-2 rounded-full shadow-lg hover:bg-indigo-700 hover:scale-110 transition-all"
                  title="Change photo (coming soon)"
                >
                  <span className="material-icons text-xs sm:text-sm">photo_camera</span>
                </button>
              </div>
              <div className="flex-1 text-center sm:text-left">
                <h2 className="text-xl sm:text-2xl font-bold text-slate-900">{user?.displayName || 'User'}</h2>
                <p className="text-slate-500 font-medium text-sm sm:text-base break-all">{user?.email}</p>
                <div className="mt-3 sm:mt-4 flex flex-wrap justify-center sm:justify-start gap-2">
                  <span className="px-2.5 sm:px-3 py-1 sm:py-1.5 bg-gradient-to-r from-indigo-50 to-purple-50 text-indigo-600 rounded-full text-[10px] sm:text-xs font-bold uppercase border border-indigo-100">
                    {user?.role === 'manager' ? 'Manager' : 'Employee'}
                  </span>
                  <span className="px-2.5 sm:px-3 py-1 sm:py-1.5 bg-slate-50 text-slate-600 rounded-full text-[10px] sm:text-xs font-bold uppercase border border-slate-200">
                    Active
                  </span>
                </div>
              </div>
              <button
                onClick={handleLogoutClick}
                className="w-full sm:w-auto px-6 py-2.5 bg-rose-50 text-rose-600 font-bold rounded-xl hover:bg-rose-100 hover:shadow-md transition-all border border-rose-100 flex items-center justify-center gap-2"
              >
                <span className="material-icons text-sm">logout</span>
                <span>Logout</span>
              </button>
            </div>
          </div>

          {/* Settings Groups */}
          <div className="grid sm:grid-cols-2 gap-4 sm:gap-6">
            {/* Notifications */}
            <div className="bg-white p-4 sm:p-6 rounded-xl sm:rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow duration-300 animate-fadeIn" style={{ animationDelay: '100ms' }}>
              <h3 className="font-bold text-base sm:text-lg mb-4 sm:mb-5 flex items-center text-slate-800">
                <span className="material-icons text-indigo-600 mr-2 text-lg sm:text-xl">notifications</span> 
                Notifications
              </h3>
              <div className="space-y-4 sm:space-y-5">
                {[
                  { label: 'Email Recap', sub: 'Receive summary after every meeting', checked: true },
                  { label: 'Task Reminders', sub: 'Get notified of upcoming deadlines', checked: true },
                  { label: 'Mentions', sub: 'Alert when your name is mentioned', checked: false }
                ].map((s, i) => (
                  <div key={i} className="flex items-center justify-between group gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-800 text-sm">{s.label}</p>
                      <p className="text-xs text-slate-500 truncate">{s.sub}</p>
                    </div>
                    <div className="relative shrink-0">
                      <div 
                        className={`w-10 sm:w-11 h-5 sm:h-6 rounded-full relative transition cursor-not-allowed ${s.checked ? 'bg-indigo-600' : 'bg-slate-200'}`}
                        title="Coming soon"
                      >
                        <div className={`absolute top-0.5 sm:top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-all ${s.checked ? 'left-5 sm:left-6' : 'left-0.5 sm:left-1'}`}></div>
                      </div>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-slate-400 italic pt-2 border-t border-slate-100">
                  ✨ Notification settings coming soon
                </p>
              </div>
            </div>

            {/* General Settings */}
            <div className="bg-white p-4 sm:p-6 rounded-xl sm:rounded-2xl border border-slate-200/80 shadow-sm hover:shadow-md transition-shadow duration-300 animate-fadeIn" style={{ animationDelay: '150ms' }}>
              <h3 className="font-bold text-base sm:text-lg mb-4 sm:mb-5 flex items-center text-slate-800">
                <span className="material-icons text-indigo-600 mr-2 text-lg sm:text-xl">settings</span> 
                General
              </h3>
              <div className="space-y-4 sm:space-y-5">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Default Transcription Language
                  </label>
                  <select 
                    value={language}
                    onChange={(e) => handleLanguageChange(e.target.value)}
                    disabled={saving}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:border-slate-300"
                  >
                    <option>English (US)</option>
                    <option>Spanish</option>
                    <option>French</option>
                    <option>German</option>
                    <option>Portuguese</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                    Workspace Name
                  </label>
                  <input 
                    type="text" 
                    value={workspaceName}
                    onChange={(e) => handleWorkspaceChange(e.target.value)}
                    disabled={saving}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition disabled:opacity-50 disabled:cursor-not-allowed hover:border-slate-300"
                    placeholder="Enter workspace name"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Save Changes Button */}
          <div className={`flex justify-center sm:justify-end transition-all duration-300 ${hasChanges ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}`}>
            <button
              onClick={handleSaveChanges}
              disabled={saving || !hasChanges}
              className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                  Saving...
                </>
              ) : (
                <>
                  <span className="material-icons text-sm">save</span>
                  Save Changes
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* CSS Animations - moved to global index.css */}
    </>
  );
};

export default ProfilePage;
