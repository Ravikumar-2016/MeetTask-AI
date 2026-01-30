
import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';

const SidebarLink: React.FC<{ to: string; label: string; icon: string; onClick?: () => void }> = ({ to, label, icon, onClick }) => {
  const location = useLocation();
  const isActive = location.pathname === to;

  return (
    <Link
      to={to}
      onClick={onClick}
      className={`flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 ${
        isActive 
          ? 'bg-gradient-to-r from-indigo-600 to-purple-600 text-white shadow-lg shadow-indigo-200' 
          : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      <span className="material-icons text-[20px]">{icon}</span>
      <span className="font-medium">{label}</span>
    </Link>
  );
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isManager, isEmployee } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/login');
    } catch (error) {
      console.error('Logout error', error);
    }
  };

  const closeMobileMenu = () => setMobileMenuOpen(false);

  // Get display name
  const displayName = user?.name || user?.displayName || user?.email?.split('@')[0] || 'User';
  const roleLabel = isManager ? 'Manager' : isEmployee ? 'Employee' : '';

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 hidden lg:flex flex-col fixed inset-y-0 z-30">
        <div className="p-6">
          <Link to="/dashboard" className="flex items-center space-x-2">
            <div className="w-9 h-9 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <span className="text-white font-bold text-xl leading-none">M</span>
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900">MeetTask AI</span>
          </Link>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-4">
          <SidebarLink to="/dashboard" label="Dashboard" icon="dashboard" />
          
          {/* Manager-only navigation */}
          {isManager && (
            <>
              <SidebarLink to="/meetings" label="Meetings" icon="video_call" />
              <SidebarLink to="/upload" label="Upload Meeting" icon="upload" />
              <SidebarLink to="/task-manager" label="Task Manager" icon="assignment_turned_in" />
            </>
          )}
          
          {/* Employee-only navigation */}
          {isEmployee && (
            <SidebarLink to="/tasks" label="My Tasks" icon="assignment" />
          )}
          
          {/* Profile link for all */}
          <SidebarLink to="/profile" label="Profile" icon="person" />
        </nav>

        <div className="p-4 border-t border-slate-200">
          <div className="flex items-center space-x-3 px-4 py-3 bg-slate-50 rounded-xl">
            <img
              src={user?.photoURL || `https://ui-avatars.com/api/?name=${displayName}&background=6366f1&color=fff`}
              className="w-10 h-10 rounded-full border-2 border-white shadow"
              alt="Profile"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{displayName}</p>
              <p className="text-xs text-slate-500">{roleLabel}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full mt-3 flex items-center justify-center space-x-2 px-4 py-2.5 text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all duration-200"
          >
            <span className="material-icons text-lg">logout</span>
            <span className="font-medium text-sm">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="lg:hidden bg-white border-b border-slate-200 h-16 flex items-center justify-between px-4 fixed top-0 left-0 right-0 z-40">
        <Link to="/dashboard" className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg leading-none">M</span>
          </div>
          <span className="font-bold text-lg text-slate-900">MeetTask AI</span>
        </Link>
        <button 
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 rounded-lg hover:bg-slate-100 transition"
        >
          <span className="material-icons">{mobileMenuOpen ? 'close' : 'menu'}</span>
        </button>
      </header>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black/50 z-40"
          onClick={closeMobileMenu}
        />
      )}

      {/* Mobile Sidebar */}
      <aside className={`lg:hidden fixed inset-y-0 left-0 w-72 bg-white z-50 transform transition-transform duration-300 ease-in-out ${
        mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="p-5 border-b border-slate-200 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center space-x-2" onClick={closeMobileMenu}>
            <div className="w-9 h-9 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-xl leading-none">M</span>
            </div>
            <span className="text-xl font-bold text-slate-900">MeetTask AI</span>
          </Link>
          <button 
            onClick={closeMobileMenu}
            className="p-2 rounded-lg hover:bg-slate-100 transition"
          >
            <span className="material-icons">close</span>
          </button>
        </div>

        {/* User Info */}
        <div className="p-4 border-b border-slate-100">
          <div className="flex items-center space-x-3 px-2">
            <img
              src={user?.photoURL || `https://ui-avatars.com/api/?name=${displayName}&background=6366f1&color=fff`}
              className="w-12 h-12 rounded-full border-2 border-indigo-100 shadow"
              alt="Profile"
            />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900 truncate">{displayName}</p>
              <span className="inline-block px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-medium mt-1">
                {roleLabel}
              </span>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          <SidebarLink to="/dashboard" label="Dashboard" icon="dashboard" onClick={closeMobileMenu} />
          
          {/* Manager-only navigation */}
          {isManager && (
            <>
              <SidebarLink to="/meetings" label="Meetings" icon="video_call" onClick={closeMobileMenu} />
              <SidebarLink to="/upload" label="Upload Meeting" icon="upload" onClick={closeMobileMenu} />
              <SidebarLink to="/task-manager" label="Task Manager" icon="assignment_turned_in" onClick={closeMobileMenu} />
            </>
          )}
          
          {/* Employee-only navigation */}
          {isEmployee && (
            <SidebarLink to="/tasks" label="My Tasks" icon="assignment" onClick={closeMobileMenu} />
          )}
          
          {/* Profile link for all */}
          <SidebarLink to="/profile" label="Profile" icon="person" onClick={closeMobileMenu} />
        </nav>

        <div className="p-4 border-t border-slate-200">
          <button
            onClick={() => {
              closeMobileMenu();
              handleLogout();
            }}
            className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-xl transition-all duration-200"
          >
            <span className="material-icons text-lg">logout</span>
            <span className="font-medium">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-64 flex flex-col min-h-screen">
        {/* Spacer for mobile header */}
        <div className="lg:hidden h-16"></div>

        <div className="p-4 sm:p-6 lg:p-10 max-w-7xl mx-auto w-full flex-1">
          {children}
        </div>
      </main>

      {/* Material Icons Link in Layout */}
      <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" />
    </div>
  );
};

export default Layout;
