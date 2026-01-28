
import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';

const SidebarLink: React.FC<{ to: string; label: string; icon: string }> = ({ to, label, icon }) => {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <Link
      to={to}
      className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
        isActive ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      <span className="material-icons text-[20px]">{icon}</span>
      <span className="font-medium">{label}</span>
    </Link>
  );
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/login');
    } catch (error) {
      console.error('Logout error', error);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 hidden md:flex flex-col fixed inset-y-0">
        <div className="p-6">
          <Link to="/dashboard" className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-xl leading-none">M</span>
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900">MeetTask AI</span>
          </Link>
        </div>

        <nav className="flex-1 px-4 space-y-2 mt-4">
          <SidebarLink to="/dashboard" label="Dashboard" icon="dashboard" />
          <SidebarLink to="/meetings" label="Meetings" icon="video_call" />
          <SidebarLink to="/tasks" label="My Tasks" icon="assignment" />
          <SidebarLink to="/manager" label="Task Manager" icon="supervisor_account" />
          <SidebarLink to="/upload" label="Upload New" icon="upload" />
        </nav>

        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center space-x-3 px-4 py-3">
            <img
              src={user?.photoURL || `https://ui-avatars.com/api/?name=${user?.displayName || 'User'}`}
              className="w-10 h-10 rounded-full border border-slate-200"
              alt="Profile"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{user?.displayName}</p>
              <button
                onClick={handleLogout}
                className="text-xs text-slate-500 hover:text-indigo-600 transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 md:ml-64 flex flex-col">
        {/* Mobile Header */}
        <header className="md:hidden bg-white border-b border-slate-200 h-16 flex items-center justify-between px-6 sticky top-0 z-10">
          <Link to="/dashboard" className="font-bold text-lg text-indigo-600">MeetTask AI</Link>
          <div className="flex items-center space-x-4">
             <Link to="/profile">
               <img src={user?.photoURL || ''} className="w-8 h-8 rounded-full" alt="profile" />
             </Link>
          </div>
        </header>

        <div className="p-6 md:p-10 max-w-7xl mx-auto w-full">
          {children}
        </div>
      </main>

      {/* Material Icons Link in Layout */}
      <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" />
    </div>
  );
};

export default Layout;
