# 🎯 MeetTask AI

> **College Project: A meeting transcription and task management system**

MeetTask AI streamlines the meeting-to-task workflow for teams. Managers upload meeting recordings, the system transcribes them with speaker identification, and tasks can be assigned to team members who submit their work via Google Drive links.

---

## Project Disclaimer

This is a **demonstration project** built to showcase:
- Full-stack React + TypeScript development
- Firebase authentication and real-time database
- Third-party API integration (AssemblyAI)
- Modern UI/UX with Tailwind CSS
- Serverless deployment on Vercel

---

## ✨ Core Features

### 🔐 Authentication
- Email/Password and Google OAuth via Firebase
- Two roles: **Manager** and **Employee**
- Human-readable IDs (e.g., `MTAI001`)

### 📹 Meeting Management
- Upload audio (MP3, WAV, M4A) or video (MP4, MOV, WebM) files
- Cloudinary storage for media files
- Real-time status updates via Firestore

### 🎙️ Transcription
- AssemblyAI speech-to-text with speaker diarization
- Automatic speaker detection (Speaker A, B, C...)
- Manual speaker-to-employee mapping

### ✅ Task Management
- Managers create and assign tasks manually
- Priority levels: Critical, High, Medium, Low
- Status tracking: Pending → In Progress → Completed
- **Employee submissions via Google Drive links** (text response + file link)

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────┐
│                    FRONTEND                             │
│     React 19 + TypeScript + Tailwind CSS + Vite        │
└────────────────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│              VERCEL SERVERLESS API (9 routes)          │
│  createMeeting │ orchestrator │ webhook/assemblyai     │
│  create-task   │ update-task  │ submit-task            │
│  save-speaker-mapping │ reset-meeting │ health         │
└────────────────────────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│    FIREBASE     │ │   ASSEMBLYAI    │ │   CLOUDINARY    │
│  • Auth         │ │  • Transcription│ │  • Media Storage│
│  • Firestore    │ │  • Diarization  │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| React 19 + TypeScript | Frontend framework |
| Tailwind CSS 4 | Styling |
| Vite | Build tool |
| Firebase Auth | Authentication |
| Firebase Firestore | Database |
| AssemblyAI | Speech-to-text transcription |
| Cloudinary | Media file storage |
| Vercel | Serverless deployment |

---

## 📁 Project Structure

```
meettask-ai/
├── api/                        # Vercel Serverless Functions (9 routes)
│   ├── _lib/                   # Shared helpers
│   │   ├── firebaseAdmin.ts    # Firebase Admin SDK
│   │   ├── verifyToken.ts      # JWT verification
│   │   └── types.ts            # API types
│   ├── webhook/
│   │   └── assemblyai.ts       # AssemblyAI webhook
│   ├── createMeeting.ts        # Create meeting
│   ├── orchestrator.ts         # Start transcription
│   ├── save-speaker-mapping.ts # Map speakers to employees
│   ├── create-task.ts          # Create task
│   ├── update-task.ts          # Update task status
│   ├── submit-task.ts          # Employee submission
│   ├── reset-meeting.ts        # Reset meeting
│   └── health.ts               # Health check
│
├── components/                 # Reusable UI components
│   ├── Layout.tsx              # App layout wrapper
│   ├── ProtectedRoute.tsx      # Auth route guard
│   └── ToastContainer.tsx      # Toast notifications
│
├── contexts/
│   └── AuthContext.tsx         # Authentication state
│
├── hooks/
│   ├── useMeetings.ts          # Meetings data
│   └── useToast.ts             # Toast notifications
│
├── lib/
│   └── firebase.ts             # Firebase client config
│
├── pages/                      # Route pages
│   ├── Dashboard.tsx           # Role-based dashboard
│   ├── MeetingsPage.tsx        # Meeting list
│   ├── MeetingDetailsPage.tsx  # Meeting details + tasks
│   ├── TasksPage.tsx           # Employee task view
│   ├── TaskManagerPage.tsx     # Manager task management
│   ├── UploadPage.tsx          # Upload meeting
│   ├── ProfilePage.tsx         # User settings
│   ├── LoginPage.tsx           # Auth page
│   └── LandingPage.tsx         # Public landing
│
├── services/
│   └── api.ts                  # API client
│
├── types.ts                    # TypeScript types
└── App.tsx                     # Main app + routes
```

---

## 🔄 How It Works

### Manager Workflow
1. **Upload** meeting recording (audio/video)
2. **Wait** for transcription (AssemblyAI processes automatically)
3. **Map** speakers to employees (Speaker A → John, etc.)
4. **Create tasks** and assign to employees
5. **View submissions** when employees complete work

### Employee Workflow
1. **View** assigned tasks in dashboard
2. **Work** on the task
3. **Upload** file to personal Google Drive
4. **Share** as "Anyone with link → Viewer"
5. **Submit** with text description + Drive link

---

## 📋 File Submission (Important!)

Employees submit work via **Google Drive share links**:

1. Upload file to your Google Drive
2. Right-click → Share → "Anyone with the link"
3. Set permission to **Viewer** (read-only)
4. Copy link and paste in submission form
5. Confirm sharing checkbox, then submit

**Supported links:**
- `drive.google.com/file/...`
- `docs.google.com/document/...`
- `docs.google.com/spreadsheets/...`
- `docs.google.com/presentation/...`

---

## 🚀 Getting Started

### Prerequisites
- Node.js v18+
- Firebase project (Auth + Firestore)
- AssemblyAI account
- Cloudinary account

### Environment Variables

Create `.env` file:

```env
# Firebase Client
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

# Firebase Admin (API)
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# AssemblyAI
ASSEMBLYAI_API_KEY=...

# Cloudinary
VITE_CLOUDINARY_CLOUD_NAME=...
VITE_CLOUDINARY_UPLOAD_PRESET=...
```

### Run Locally

```bash
npm install
npm run dev
```

### Deploy to Vercel

```bash
npm i -g vercel
vercel --prod
```

Configure AssemblyAI webhook URL in your app:
`https://your-app.vercel.app/api/webhook/assemblyai`

---

## 🔒 Security Notes

- All API endpoints verify Firebase JWT tokens
- Firestore rules enforce role-based access
- No sensitive data stored in localStorage
- Environment variables for all secrets

---

## 👥 User Roles

| Feature | Manager | Employee |
|---------|---------|----------|
| Upload meetings | ✅ | ❌ |
| View transcripts | ✅ | ✅ (if assigned) |
| Map speakers | ✅ | ❌ |
| Create tasks | ✅ | ❌ |
| View all tasks | ✅ | ❌ |
| View own tasks | ✅ | ✅ |
| Submit work | ❌ | ✅ |
| View submissions | ✅ | ✅ (own) |

---

## 📄 License

MIT License - Free for educational use.

---

<p align="center">
  <strong>Built for academic demonstration</strong><br>
  React • Firebase • AssemblyAI • Tailwind CSS • Vercel
</p>
