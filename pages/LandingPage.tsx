
import React from 'react';
import { Link } from 'react-router-dom';

const LandingPage: React.FC = () => {
  return (
    <div className="bg-white">
      {/* Navigation */}
      <nav className="flex items-center justify-between px-8 py-6 max-w-7xl mx-auto">
        <div className="flex items-center space-x-2">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
            <span className="text-white font-bold text-2xl leading-none">M</span>
          </div>
          <span className="text-2xl font-bold text-slate-900">MeetTask AI</span>
        </div>
        <div className="space-x-6 flex items-center">
          <Link to="/login" className="text-slate-600 font-medium hover:text-indigo-600 transition">Log In</Link>
          <Link to="/login" className="bg-indigo-600 text-white px-6 py-2.5 rounded-lg font-semibold hover:bg-indigo-700 transition shadow-lg shadow-indigo-200">
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="px-8 py-20 text-center max-w-5xl mx-auto">
        <h1 className="text-5xl md:text-7xl font-extrabold text-slate-900 leading-tight mb-6">
          Meetings turned into <br />
          <span className="text-indigo-600 italic">Actionable Results</span>
        </h1>
        <p className="text-xl text-slate-600 mb-10 max-w-2xl mx-auto leading-relaxed">
          Upload your meeting recordings and let AI transcribe, analyze, and extract tasks. 
          Stop chasing meeting notes and start executing.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link to="/login" className="w-full sm:w-auto bg-indigo-600 text-white px-8 py-4 rounded-xl text-lg font-bold hover:bg-indigo-700 transition shadow-xl shadow-indigo-200">
            Start for Free
          </Link>
          <button className="w-full sm:w-auto px-8 py-4 rounded-xl text-lg font-bold text-slate-700 hover:bg-slate-50 border border-slate-200 transition">
            Watch Demo
          </button>
        </div>

        <div className="mt-20 relative">
          <div className="absolute inset-0 bg-indigo-600/5 blur-3xl -z-10 rounded-full scale-110"></div>
          <img 
            src="https://picsum.photos/1200/600" 
            alt="Dashboard Preview" 
            className="rounded-2xl shadow-2xl border border-slate-100 w-full"
          />
        </div>
      </section>

      {/* Features */}
      <section className="bg-slate-50 py-24 px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">Everything you need for productive meetings</h2>
            <p className="text-slate-600 max-w-xl mx-auto">Our AI engine handles the grunt work while you focus on the collaboration.</p>
          </div>
          
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { title: 'AI Transcription', desc: 'World-class accuracy in 50+ languages with speaker identification.', icon: 'auto_awesome' },
              { title: 'Auto Task Extraction', desc: 'Identifies action items, owners, and deadlines automatically.', icon: 'checklist' },
              { title: 'Centralized Dashboard', desc: 'Track all meeting action items across your entire team.', icon: 'grid_view' }
            ].map((f, i) => (
              <div key={i} className="bg-white p-8 rounded-2xl border border-slate-200 hover:border-indigo-400 transition group">
                <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center mb-6 group-hover:bg-indigo-600 transition-colors">
                  <span className="material-icons text-indigo-600 group-hover:text-white">{f.icon}</span>
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">{f.title}</h3>
                <p className="text-slate-600">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-24 px-8 max-w-7xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-16">How it works</h2>
        <div className="grid md:grid-cols-4 gap-8">
          {[
            { step: '01', title: 'Record', desc: 'Record your meeting as usual.' },
            { step: '02', title: 'Upload', desc: 'Drop the audio/video file into our app.' },
            { step: '03', title: 'Process', desc: 'AI extracts tasks and deadlines.' },
            { step: '04', title: 'Execute', desc: 'Assign and track tasks to completion.' }
          ].map((s, i) => (
            <div key={i} className="relative">
              <span className="text-6xl font-black text-slate-100 absolute -top-10 left-0 -z-10">{s.step}</span>
              <h3 className="text-xl font-bold mb-2">{s.title}</h3>
              <p className="text-slate-600">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA Footer */}
      <section className="bg-indigo-600 py-16 px-8 text-center text-white">
        <h2 className="text-3xl font-bold mb-6">Ready to make your meetings work for you?</h2>
        <Link to="/login" className="inline-block bg-white text-indigo-600 px-10 py-4 rounded-xl text-lg font-bold hover:bg-slate-100 transition">
          Join MeetTask AI Today
        </Link>
      </section>
      
      <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" />
    </div>
  );
};

export default LandingPage;
