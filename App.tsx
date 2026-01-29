
import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';

// Pages
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import Dashboard from './pages/Dashboard';
import UploadPage from './pages/UploadPage';
import MeetingsPage from './pages/MeetingsPage';
import MeetingDetailsPage from './pages/MeetingDetailsPage';
import TasksPage from './pages/TasksPage';
import TaskManagerPage from './pages/TaskManagerPage';
import ProfilePage from './pages/ProfilePage';

const App: React.FC = () => {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />

          {/* Protected Routes */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard" element={<Layout><Dashboard /></Layout>} />
            
            {/* Manager Routes */}
            <Route path="/upload" element={<Layout><UploadPage /></Layout>} />
            <Route path="/meetings" element={<Layout><MeetingsPage /></Layout>} />
            <Route path="/meetings/:id" element={<Layout><MeetingDetailsPage /></Layout>} />
            <Route path="/task-manager" element={<Layout><TaskManagerPage /></Layout>} />
            
            {/* Employee Routes */}
            <Route path="/tasks" element={<Layout><TasksPage /></Layout>} />
            
            {/* Common Routes */}
            <Route path="/profile" element={<Layout><ProfilePage /></Layout>} />
          </Route>

          {/* Catch All */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
};

export default App;
