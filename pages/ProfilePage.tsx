
import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const ProfilePage: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await logout();
      navigate('/login');
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Your Profile</h1>
        <p className="text-slate-500">Manage your account settings and preferences.</p>
      </div>

      <div className="space-y-6">
        {/* Profile Card */}
        <div className="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center space-y-4 md:space-y-0 md:space-x-8">
          <div className="relative group">
            <img
              src={user?.photoURL || `https://ui-avatars.com/api/?name=${user?.displayName || 'User'}`}
              className="w-24 h-24 rounded-full border-4 border-white shadow-lg"
              alt="Profile"
            />
            <button className="absolute bottom-0 right-0 bg-indigo-600 text-white p-2 rounded-full shadow-lg hover:bg-indigo-700 transition">
              <span className="material-icons text-sm">photo_camera</span>
            </button>
          </div>
          <div className="flex-1 text-center md:text-left">
            <h2 className="text-2xl font-bold text-slate-900">{user?.displayName}</h2>
            <p className="text-slate-500 font-medium">{user?.email}</p>
            <div className="mt-4 flex flex-wrap justify-center md:justify-start gap-2">
              <span className="px-3 py-1 bg-indigo-50 text-indigo-600 rounded-full text-xs font-bold uppercase border border-indigo-100">Pro Plan</span>
              <span className="px-3 py-1 bg-slate-50 text-slate-600 rounded-full text-xs font-bold uppercase border border-slate-100">Beta Tester</span>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="px-6 py-2.5 bg-rose-50 text-rose-600 font-bold rounded-xl hover:bg-rose-100 transition border border-rose-100"
          >
            Logout
          </button>
        </div>

        {/* Settings Groups */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-lg mb-4 flex items-center">
               <span className="material-icons text-indigo-600 mr-2">notifications</span> Notifications
            </h3>
            <div className="space-y-4">
              {[
                { label: 'Email Recap', sub: 'Receive summary after every meeting', checked: true },
                { label: 'Task Reminders', sub: 'Get notified of upcoming deadlines', checked: true },
                { label: 'Mentions', sub: 'Alert when your name is mentioned', checked: false }
              ].map((s, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-900 text-sm">{s.label}</p>
                    <p className="text-xs text-slate-500">{s.sub}</p>
                  </div>
                  <div className={`w-10 h-5 rounded-full relative transition ${s.checked ? 'bg-indigo-600' : 'bg-slate-200'}`}>
                    <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${s.checked ? 'left-6' : 'left-1'}`}></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <h3 className="font-bold text-lg mb-4 flex items-center">
               <span className="material-icons text-indigo-600 mr-2">settings</span> General
            </h3>
            <div className="space-y-4">
               <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Default Transcription Language</label>
                  <select className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none">
                    <option>English (US)</option>
                    <option>Spanish</option>
                    <option>French</option>
                  </select>
               </div>
               <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Workspace Name</label>
                  <input type="text" defaultValue="My Team Workspace" className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none" />
               </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
