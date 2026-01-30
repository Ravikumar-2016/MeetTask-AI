
import React, { useState } from 'react';
import { Link } from 'react-router-dom';

const LandingPage: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="bg-white min-h-screen">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-100">
        <div className="flex items-center justify-between px-4 sm:px-8 py-4 max-w-7xl mx-auto">
          <div className="flex items-center space-x-2">
            <div className="w-9 h-9 sm:w-10 sm:h-10 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <span className="text-white font-bold text-xl sm:text-2xl leading-none">M</span>
            </div>
            <span className="text-xl sm:text-2xl font-bold text-slate-900">MeetTask AI</span>
          </div>
          
          {/* Desktop Navigation */}
          <div className="hidden sm:flex space-x-6 items-center">
            <Link to="/login" className="text-slate-600 font-medium hover:text-indigo-600 transition">Log In</Link>
            <Link to="/login" className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-2.5 rounded-xl font-semibold hover:opacity-90 transition shadow-lg shadow-indigo-200">
              Get Started
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <button 
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="sm:hidden p-2 rounded-lg hover:bg-slate-100 transition"
          >
            <span className="material-icons">{mobileMenuOpen ? 'close' : 'menu'}</span>
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="sm:hidden bg-white border-t border-slate-100 px-4 py-4 space-y-3 animate-fadeIn">
            <Link 
              to="/login" 
              className="block w-full text-center py-3 text-slate-600 font-medium hover:text-indigo-600 transition"
              onClick={() => setMobileMenuOpen(false)}
            >
              Log In
            </Link>
            <Link 
              to="/login" 
              className="block w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-xl font-semibold text-center"
              onClick={() => setMobileMenuOpen(false)}
            >
              Get Started
            </Link>
          </div>
        )}
      </nav>

      {/* Hero Section */}
      <section className="px-4 sm:px-8 py-12 sm:py-20 text-center max-w-5xl mx-auto">
        
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-extrabold text-slate-900 leading-tight mb-6">
          From Meetings to <br className="hidden sm:block" />
          <span className="bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">Tasks Assigned</span>
        </h1>
        <p className="text-lg sm:text-xl text-slate-600 mb-8 sm:mb-10 max-w-2xl mx-auto leading-relaxed px-4">
          Upload meeting recordings, let AI transcribe with speaker identification, 
          then assign tasks to your team. Track submissions through Google Drive links.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 px-4">
          <Link to="/login" className="w-full sm:w-auto bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-8 py-4 rounded-xl text-lg font-bold hover:opacity-90 transition shadow-xl shadow-indigo-200">
            Start Using MeetTask
          </Link>
        </div>

        {/* Hero Visual - Workflow Illustration */}
        <div className="mt-12 sm:mt-20 relative px-4">
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-600/5 to-purple-600/5 blur-3xl -z-10 rounded-full scale-110"></div>
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl sm:rounded-3xl p-4 sm:p-8 shadow-2xl">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 sm:gap-8 text-white">
              {/* Step 1 */}
              <div className="flex-1 text-center p-3 sm:p-4">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-indigo-500/20 rounded-xl sm:rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <span className="material-icons text-2xl sm:text-3xl text-indigo-400">upload_file</span>
                </div>
                <p className="text-xs sm:text-sm font-medium text-slate-300">Manager</p>
              </div>
              
              <span className="material-icons text-slate-600 hidden sm:block">arrow_forward</span>
              
              {/* Step 2 */}
              <div className="flex-1 text-center p-3 sm:p-4">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-purple-500/20 rounded-xl sm:rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <span className="material-icons text-2xl sm:text-3xl text-purple-400">record_voice_over</span>
                </div>
                <p className="text-xs sm:text-sm font-medium text-slate-300">AI Engine</p>
              </div>
              
              <span className="material-icons text-slate-600 hidden sm:block">arrow_forward</span>
              
              {/* Step 3 */}
              <div className="flex-1 text-center p-3 sm:p-4">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-emerald-500/20 rounded-xl sm:rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <span className="material-icons text-2xl sm:text-3xl text-emerald-400">assignment_ind</span>
                </div>
                <p className="text-xs sm:text-sm font-medium text-slate-300">Manager</p>
              </div>
              
              <span className="material-icons text-slate-600 hidden sm:block">arrow_forward</span>
              
              {/* Step 4 */}
              <div className="flex-1 text-center p-3 sm:p-4">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-amber-500/20 rounded-xl sm:rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <span className="material-icons text-2xl sm:text-3xl text-amber-400">add_link</span>
                </div>
                <p className="text-xs sm:text-sm font-medium text-slate-300">Employee</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Two Roles Section */}
      <section className="bg-slate-50 py-16 sm:py-24 px-4 sm:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">Built for Teams</h2>
            <p className="text-slate-600 max-w-xl mx-auto">Two distinct roles working together seamlessly.</p>
          </div>
          
          <div className="grid md:grid-cols-2 gap-6 sm:gap-8">
            {/* Manager Card */}
            <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 hover:border-indigo-400 hover:shadow-xl transition-all duration-300 group">
              <div className="w-14 h-14 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-indigo-200 group-hover:scale-110 transition-transform">
                <span className="material-icons text-white text-2xl">supervisor_account</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-slate-900 mb-3">For Managers</h3>
              <ul className="space-y-3 text-slate-600">
                <li className="flex items-start gap-3">
                  <span className="material-icons text-emerald-500 text-lg mt-0.5">check_circle</span>
                  <span>Upload meeting recordings (audio/video)</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="material-icons text-emerald-500 text-lg mt-0.5">check_circle</span>
                  <span>View AI-generated transcripts with speaker labels</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="material-icons text-emerald-500 text-lg mt-0.5">check_circle</span>
                  <span>Map speakers to team members</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="material-icons text-emerald-500 text-lg mt-0.5">check_circle</span>
                  <span>Create and assign tasks with priorities</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="material-icons text-emerald-500 text-lg mt-0.5">check_circle</span>
                  <span>Review employee submissions</span>
                </li>
              </ul>
            </div>
            
            {/* Employee Card */}
            <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 hover:border-purple-400 hover:shadow-xl transition-all duration-300 group">
              <div className="w-14 h-14 bg-gradient-to-br from-purple-500 to-purple-600 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-purple-200 group-hover:scale-110 transition-transform">
                <span className="material-icons text-white text-2xl">person</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-bold text-slate-900 mb-3">For Employees</h3>
              <ul className="space-y-3 text-slate-600">
                <li className="flex items-start gap-3">
                  <span className="material-icons text-emerald-500 text-lg mt-0.5">check_circle</span>
                  <span>View tasks assigned by managers</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="material-icons text-emerald-500 text-lg mt-0.5">check_circle</span>
                  <span>See task priorities and due dates</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="material-icons text-emerald-500 text-lg mt-0.5">check_circle</span>
                  <span>Write text responses for tasks</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="material-icons text-emerald-500 text-lg mt-0.5">check_circle</span>
                  <span>Submit work via Google Drive links</span>
                </li>
                <li className="flex items-start gap-3">
                  <span className="material-icons text-emerald-500 text-lg mt-0.5">check_circle</span>
                  <span>Track task completion progress</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 sm:py-24 px-4 sm:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-12 sm:mb-16">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-4">Key Features</h2>
            <p className="text-slate-600 max-w-xl mx-auto">Everything you need to transform meetings into actionable tasks.</p>
          </div>
          
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
            {[
              { 
                title: 'AI Transcription', 
                desc: 'Powered by AssemblyAI with speaker diarization to identify who said what.', 
                icon: 'record_voice_over',
                color: 'from-blue-500 to-blue-600'
              },
              { 
                title: 'Speaker Mapping', 
                desc: 'Map detected speakers to actual team members for accurate task assignment.', 
                icon: 'people_alt',
                color: 'from-purple-500 to-purple-600'
              },
              { 
                title: 'Task Management', 
                desc: 'Create tasks with titles, descriptions, priorities, and due dates.', 
                icon: 'assignment',
                color: 'from-emerald-500 to-emerald-600'
              },
              { 
                title: 'Google Drive Integration', 
                desc: 'Employees submit work via shareable Google Drive links.', 
                icon: 'add_to_drive',
                color: 'from-amber-500 to-amber-600'
              },
              { 
                title: 'Role-Based Access', 
                desc: 'Managers and employees see different dashboards tailored to their needs.', 
                icon: 'admin_panel_settings',
                color: 'from-rose-500 to-rose-600'
              },
              { 
                title: 'Real-time Updates', 
                desc: 'See task status changes and submissions in real-time with Firebase.', 
                icon: 'sync',
                color: 'from-indigo-500 to-indigo-600'
              }
            ].map((f, i) => (
              <div key={i} className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 hover:border-slate-300 hover:shadow-lg transition-all duration-300 group">
                <div className={`w-12 h-12 bg-gradient-to-br ${f.color} rounded-xl flex items-center justify-center mb-5 shadow-lg group-hover:scale-110 transition-transform`}>
                  <span className="material-icons text-white">{f.icon}</span>
                </div>
                <h3 className="text-lg sm:text-xl font-bold text-slate-900 mb-2">{f.title}</h3>
                <p className="text-slate-600 text-sm sm:text-base">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-slate-50 py-16 sm:py-24 px-4 sm:px-8">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold text-center mb-12 sm:mb-16">How It Works</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
            {[
              { step: '01', title: 'Upload', desc: 'Manager uploads meeting recording to Cloudinary storage.', icon: 'cloud_upload' },
              { step: '02', title: 'Transcribe', desc: 'AssemblyAI transcribes audio with speaker identification.', icon: 'auto_awesome' },
              { step: '03', title: 'Assign', desc: 'Manager creates tasks and assigns to team members.', icon: 'assignment_turned_in' },
              { step: '04', title: 'Submit', desc: 'Employees complete tasks and submit Google Drive links.', icon: 'send' }
            ].map((s, i) => (
              <div key={i} className="relative bg-white p-6 rounded-2xl border border-slate-200 hover:shadow-lg transition-all duration-300">
                <span className="text-5xl sm:text-6xl font-black text-indigo-100 absolute -top-4 -right-2">{s.step}</span>
                <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg flex items-center justify-center mb-4 relative z-10">
                  <span className="material-icons text-white text-lg">{s.icon}</span>
                </div>
                <h3 className="text-lg sm:text-xl font-bold mb-2 relative z-10">{s.title}</h3>
                <p className="text-slate-600 text-sm sm:text-base relative z-10">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Footer */}
      <section className="bg-gradient-to-r from-indigo-600 to-purple-600 py-12 sm:py-16 px-4 sm:px-8 text-center text-white">
        <h2 className="text-2xl sm:text-3xl font-bold mb-4 sm:mb-6">Ready to Get Started?</h2>
        <p className="text-indigo-100 mb-6 sm:mb-8 max-w-lg mx-auto">Sign up as a Manager or Employee and experience seamless task management.</p>
        <Link to="/login" className="inline-block bg-white text-indigo-600 px-8 sm:px-10 py-3 sm:py-4 rounded-xl text-base sm:text-lg font-bold hover:bg-slate-100 transition shadow-xl">
          Create Your Account
        </Link>
      </section>
      
      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-8 px-4 sm:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-lg leading-none">M</span>
            </div>
            <span className="font-bold text-white">MeetTask AI</span>
          </div>
          <p className="text-sm">© 2026 MeetTask AI</p>
        </div>
      </footer>
      
      <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" />
    </div>
  );
};

export default LandingPage;
