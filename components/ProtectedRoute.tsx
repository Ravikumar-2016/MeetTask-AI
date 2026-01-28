/**
 * ProtectedRoute.tsx - Route guard for authenticated pages
 * 
 * Access rules:
 * - Not logged in → Redirect to /login
 * - Google users → Always allowed (auto-verified)
 * - Email users with verified email → Allowed
 * - Email users without verification → Redirect to /login (shows verify screen)
 */

import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const ProtectedRoute: React.FC = () => {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Show loading state while checking auth
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-slate-600 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  // Not logged in → redirect to login
  if (!user) {
    console.log('🚫 Access denied: Not logged in');
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check if user is verified
  // Google users are always verified, email users need emailVerified = true
  const isGoogleUser = user.authProviders?.includes('google') ?? false;
  const isVerified = isGoogleUser || user.emailVerified;

  if (!isVerified) {
    console.log('🚫 Access denied: Email not verified');
    // Redirect to login which will show the verification screen
    return <Navigate to="/login" state={{ from: location, needsVerification: true }} replace />;
  }

  // User is authenticated and verified
  console.log('✅ Access granted');
  return <Outlet />;
};

export default ProtectedRoute;
