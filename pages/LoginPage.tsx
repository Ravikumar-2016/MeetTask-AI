/**
 * LoginPage.tsx - Professional Authentication UI
 * 
 * Features:
 * - Login with email/password
 * - Signup with email verification
 * - Forgot password flow
 * - Google OAuth
 * - Show/hide password toggle
 * - Professional error handling
 * - Loading states
 * - Smooth transitions
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';

// Auth screen modes
type AuthMode = 'login' | 'signup' | 'forgot-password' | 'verify-email' | 'reset-sent';

// Eye icons for password visibility toggle
const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

const EyeOffIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
  </svg>
);

// Loading spinner component
const Spinner = () => (
  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
);

// Google logo SVG
const GoogleIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const LoginPage: React.FC = () => {
  // Form state
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('employee');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  // Google signup flow - needs role selection after OAuth
  const [pendingGoogleUser, setPendingGoogleUser] = useState<boolean>(false);
  
  // UI state
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get auth methods from context
  const { 
    user,
    loading: authLoading,
    login, 
    signup, 
    googleLogin,
    logout,
    sendVerificationEmail,
    sendPasswordReset,
    refreshUser
  } = useAuth();

  // Get redirect path from location state
  const from = (location.state as any)?.from?.pathname || '/dashboard';

  /**
   * Handle user state changes - redirect when appropriate
   */
  useEffect(() => {
    if (authLoading) return;
    
    if (user) {
      const isGoogleUser = user.authProviders?.includes('google') ?? false;
      const isVerified = isGoogleUser || user.emailVerified;
      
      if (isVerified) {
        console.log('✅ User verified, redirecting to:', from);
        navigate(from, { replace: true });
      } else {
        console.log('⚠️ Email not verified, showing verification screen');
        setMode('verify-email');
      }
    }
  }, [user, authLoading, navigate, from]);

  /**
   * Countdown timer for resend button
   */
  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer(prev => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendTimer]);

  /**
   * Clear messages when switching modes
   */
  useEffect(() => {
    setError('');
    setSuccess('');
  }, [mode]);

  /**
   * Reset form to initial state
   */
  const resetForm = useCallback(() => {
    setEmail('');
    setName('');
    setRole('employee');
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    setError('');
    setSuccess('');
    setPendingGoogleUser(false);
  }, []);

  /**
   * Handle login form submission
   */
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      await login(email, password);
      setSuccess('Login successful! Redirecting...');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle signup form submission
   */
  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Validate name
    if (!name.trim()) {
      setError('Please enter your full name.');
      return;
    }

    // Validate password match
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    // Validate password length
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);

    try {
      await signup(email, password, name.trim(), role);
      setSuccess('Account created! Please check your email to verify your account.');
      setResendTimer(60);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle forgot password form submission
   */
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      await sendPasswordReset(email);
      setMode('reset-sent');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle Google sign in (for login - existing users)
   */
  const handleGoogleSignIn = async () => {
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      // Try to sign in - googleLogin handles existing vs new users
      await googleLogin(name.trim() || '', role);
      setSuccess('Google sign-in successful! Redirecting...');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle Google signup (new users - needs name and role)
   */
  const handleGoogleSignup = async () => {
    setError('');
    setSuccess('');

    if (!name.trim()) {
      setError('Please enter your full name before continuing with Google.');
      return;
    }

    setLoading(true);

    try {
      await googleLogin(name.trim(), role);
      setSuccess('Account created with Google! Redirecting...');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle resend verification email
   */
  const handleResendVerification = async () => {
    if (resendTimer > 0) return;
    
    setError('');
    setLoading(true);

    try {
      await sendVerificationEmail();
      setSuccess('Verification email sent! Check your inbox.');
      setResendTimer(60);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle checking verification status
   */
  const handleCheckVerification = async () => {
    setError('');
    setLoading(true);

    try {
      await refreshUser();
      // If still not verified after refresh
      const isGoogleUser = user?.authProviders?.includes('google') ?? false;
      if (user && !user.emailVerified && !isGoogleUser) {
        setError('Email not verified yet. Please check your inbox and click the verification link.');
      }
    } catch (err: any) {
      setError('Could not check verification status. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle sign out (from verify email screen)
   */
  const handleSignOut = async () => {
    await logout();
    resetForm();
    setMode('login');
  };

  /**
   * Render password input with visibility toggle
   */
  const renderPasswordInput = (
    value: string,
    onChange: (value: string) => void,
    show: boolean,
    setShow: (show: boolean) => void,
    placeholder: string = 'Enter your password',
    id: string = 'password'
  ) => (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-3 pr-12 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
        placeholder={placeholder}
        required
        minLength={6}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
        tabIndex={-1}
      >
        {show ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );

  /**
   * Render error message
   */
  const renderError = () => error && (
    <div className="bg-red-50 text-red-700 px-4 py-3 rounded-xl text-sm border border-red-100 flex items-start gap-3">
      <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
      </svg>
      <span>{error}</span>
    </div>
  );

  /**
   * Render success message
   */
  const renderSuccess = () => success && (
    <div className="bg-green-50 text-green-700 px-4 py-3 rounded-xl text-sm border border-green-100 flex items-start gap-3">
      <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
      <span>{success}</span>
    </div>
  );

  /**
   * Render Google sign in button
   */
  const renderGoogleButton = () => (
    <button
      type="button"
      onClick={handleGoogleSignIn}
      disabled={loading}
      className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-slate-200 rounded-xl font-medium text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <GoogleIcon />
      <span>Continue with Google</span>
    </button>
  );

  /**
   * Render divider
   */
  const renderDivider = () => (
    <div className="relative my-6">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-slate-200"></div>
      </div>
      <div className="relative flex justify-center text-sm">
        <span className="px-4 bg-white text-slate-500">or</span>
      </div>
    </div>
  );

  // Show loading while auth state is being determined
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto"></div>
          <p className="mt-4 text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Logo */}
        <div className="flex justify-center">
          <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <span className="text-white font-bold text-2xl">M</span>
          </div>
        </div>

        {/* Card */}
        <div className="mt-8 bg-white py-8 px-6 shadow-xl shadow-slate-200/50 rounded-2xl sm:px-10 border border-slate-100">
          
          {/* ========== LOGIN ========== */}
          {mode === 'login' && (
            <>
              <h2 className="text-2xl font-bold text-slate-900 text-center mb-2">Welcome back</h2>
              <p className="text-slate-500 text-center mb-8">Sign in to your account</p>

              <div className="space-y-4">
                {renderError()}
                {renderSuccess()}

                {renderGoogleButton()}
                {renderDivider()}

                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
                      Email address
                    </label>
                    <input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                      placeholder="you@example.com"
                      required
                      autoComplete="email"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                        Password
                      </label>
                      <button
                        type="button"
                        onClick={() => { resetForm(); setMode('forgot-password'); }}
                        className="text-sm text-indigo-600 hover:text-indigo-500 font-medium"
                      >
                        Forgot password?
                      </button>
                    </div>
                    {renderPasswordInput(password, setPassword, showPassword, setShowPassword)}
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {loading ? <Spinner /> : 'Sign in'}
                  </button>
                </form>

                <p className="text-center text-sm text-slate-600 mt-6">
                  Don't have an account?{' '}
                  <button
                    onClick={() => { resetForm(); setMode('signup'); }}
                    className="font-semibold text-indigo-600 hover:text-indigo-500"
                  >
                    Sign up
                  </button>
                </p>
              </div>
            </>
          )}

          {/* ========== SIGNUP ========== */}
          {mode === 'signup' && (
            <>
              <h2 className="text-2xl font-bold text-slate-900 text-center mb-2">Create account</h2>
              <p className="text-slate-500 text-center mb-8">Join MeetTask AI today</p>

              <div className="space-y-4">
                {renderError()}
                {renderSuccess()}

                <form onSubmit={handleSignup} className="space-y-4">
                  {/* Full Name */}
                  <div>
                    <label htmlFor="signup-name" className="block text-sm font-medium text-slate-700 mb-1">
                      Full Name
                    </label>
                    <input
                      id="signup-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                      placeholder="John Smith"
                      required
                      autoComplete="name"
                    />
                  </div>

                  {/* Email */}
                  <div>
                    <label htmlFor="signup-email" className="block text-sm font-medium text-slate-700 mb-1">
                      Email address
                    </label>
                    <input
                      id="signup-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                      placeholder="you@example.com"
                      required
                      autoComplete="email"
                    />
                  </div>

                  {/* Role Selection */}
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-2">
                      I am a...
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setRole('manager')}
                        className={`flex flex-col items-center p-4 rounded-xl border-2 transition-all ${
                          role === 'manager'
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 hover:border-slate-300 text-slate-600'
                        }`}
                      >
                        <svg className="w-6 h-6 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        <span className="font-medium">Manager</span>
                        <span className="text-xs text-slate-500 mt-1">Create & assign tasks</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRole('employee')}
                        className={`flex flex-col items-center p-4 rounded-xl border-2 transition-all ${
                          role === 'employee'
                            ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                            : 'border-slate-200 hover:border-slate-300 text-slate-600'
                        }`}
                      >
                        <svg className="w-6 h-6 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <span className="font-medium">Employee</span>
                        <span className="text-xs text-slate-500 mt-1">View & complete tasks</span>
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="signup-password" className="block text-sm font-medium text-slate-700 mb-1">
                      Password
                    </label>
                    {renderPasswordInput(password, setPassword, showPassword, setShowPassword, 'Create a password', 'signup-password')}
                    <p className="mt-1 text-xs text-slate-500">Must be at least 6 characters</p>
                  </div>

                  <div>
                    <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700 mb-1">
                      Confirm password
                    </label>
                    {renderPasswordInput(confirmPassword, setConfirmPassword, showConfirmPassword, setShowConfirmPassword, 'Confirm your password', 'confirm-password')}
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {loading ? <Spinner /> : 'Create account'}
                  </button>
                </form>

                {renderDivider()}

                {/* Google signup - only if name is provided */}
                <button
                  type="button"
                  onClick={handleGoogleSignup}
                  disabled={loading || !name.trim()}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-slate-200 rounded-xl font-medium text-slate-700 hover:bg-slate-50 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <GoogleIcon />
                  <span>Sign up with Google</span>
                </button>
                {!name.trim() && (
                  <p className="text-xs text-center text-slate-500">
                    Enter your name above to enable Google signup
                  </p>
                )}

                <p className="text-center text-sm text-slate-600 mt-6">
                  Already have an account?{' '}
                  <button
                    onClick={() => { resetForm(); setMode('login'); }}
                    className="font-semibold text-indigo-600 hover:text-indigo-500"
                  >
                    Sign in
                  </button>
                </p>
              </div>
            </>
          )}

          {/* ========== FORGOT PASSWORD ========== */}
          {mode === 'forgot-password' && (
            <>
              <h2 className="text-2xl font-bold text-slate-900 text-center mb-2">Reset password</h2>
              <p className="text-slate-500 text-center mb-8">We'll send you a reset link</p>

              <div className="space-y-4">
                {renderError()}
                {renderSuccess()}

                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div>
                    <label htmlFor="reset-email" className="block text-sm font-medium text-slate-700 mb-1">
                      Email address
                    </label>
                    <input
                      id="reset-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                      placeholder="you@example.com"
                      required
                      autoComplete="email"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {loading ? <Spinner /> : 'Send reset link'}
                  </button>
                </form>

                <button
                  onClick={() => { resetForm(); setMode('login'); }}
                  className="w-full text-center text-sm text-slate-600 hover:text-slate-900 font-medium mt-4"
                >
                  ← Back to sign in
                </button>
              </div>
            </>
          )}

          {/* ========== RESET SENT ========== */}
          {mode === 'reset-sent' && (
            <div className="text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Check your email</h2>
              <p className="text-slate-500 mb-6">
                We sent a password reset link to<br />
                <span className="font-medium text-slate-700">{email}</span>
              </p>

              <div className="bg-amber-50 text-amber-800 px-4 py-3 rounded-xl text-sm border border-amber-100 mb-6">
                <p>📧 Check your inbox and spam folder</p>
              </div>

              <button
                onClick={() => { resetForm(); setMode('login'); }}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all"
              >
                Back to sign in
              </button>
            </div>
          )}

          {/* ========== VERIFY EMAIL ========== */}
          {mode === 'verify-email' && (
            <div className="text-center">
              <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              
              <h2 className="text-2xl font-bold text-slate-900 mb-2">Verify your email</h2>
              <p className="text-slate-500 mb-2">
                We sent a verification link to
              </p>
              <p className="font-medium text-slate-700 mb-6">{user?.email}</p>

              <div className="space-y-4">
                {renderError()}
                {renderSuccess()}

                <div className="bg-blue-50 text-blue-800 px-4 py-3 rounded-xl text-sm border border-blue-100 text-left">
                  <p className="mb-2">📧 <strong>Check your inbox</strong> (and spam folder)</p>
                  <p>Click the verification link, then click the button below.</p>
                </div>

                <button
                  onClick={handleCheckVerification}
                  disabled={loading}
                  className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-sm text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {loading ? <Spinner /> : "I've verified my email"}
                </button>

                <div className="pt-4 border-t border-slate-100">
                  <p className="text-sm text-slate-500 mb-2">Didn't receive the email?</p>
                  <button
                    onClick={handleResendVerification}
                    disabled={resendTimer > 0 || loading}
                    className="text-sm font-semibold text-indigo-600 hover:text-indigo-500 disabled:text-slate-400 disabled:cursor-not-allowed"
                  >
                    {resendTimer > 0 ? `Resend in ${resendTimer}s` : 'Resend verification email'}
                  </button>
                </div>

                <button
                  onClick={handleSignOut}
                  className="w-full text-center text-sm text-slate-600 hover:text-slate-900 font-medium mt-4"
                >
                  ← Use a different email
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="mt-8 text-center text-xs text-slate-500">
          By signing in, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
