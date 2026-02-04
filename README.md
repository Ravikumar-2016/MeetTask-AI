# 🎯 MeetTask AI

> **Transform Meeting Recordings into Actionable Tasks with AI-Powered Transcription**

MeetTask AI is a full-stack web application that streamlines the meeting-to-task workflow for teams. Managers upload meeting recordings (audio/video), the system automatically transcribes them using AssemblyAI with speaker identification, and tasks can be assigned to team members who submit their work via Google Drive links.

![React](https://img.shields.io/badge/React-19.2-61DAFB?style=flat&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat&logo=typescript)
![Firebase](https://img.shields.io/badge/Firebase-12.8-FFCA28?style=flat&logo=firebase)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.1-06B6D4?style=flat&logo=tailwindcss)
![Vercel](https://img.shields.io/badge/Vercel-Serverless-000000?style=flat&logo=vercel)

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Tech Stack](#-tech-stack)
- [System Architecture](#-system-architecture)
- [Project Structure](#-project-structure)
- [User Workflows](#-user-workflows)
- [API Endpoints](#-api-endpoints)
- [Database Schema](#-database-schema)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [Deployment](#-deployment)
- [Security](#-security)
- [License](#-license)

---

## 🎯 Overview

MeetTask AI solves the common problem of action items getting lost after meetings. It provides:

- **Automated Transcription**: Upload any audio/video meeting recording and get accurate transcripts
- **Speaker Diarization**: Automatically identifies different speakers in the meeting
- **Manual Speaker Mapping**: Map detected speakers (A, B, C) to actual team members
- **Task Assignment**: Create and assign tasks based on meeting discussions
- **Submission Tracking**: Employees submit work via Google Drive links with status tracking
- **Role-Based Access**: Separate dashboards for Managers and Employees

---

## ✨ Key Features

### 🔐 Authentication System
- **Firebase Authentication** with Email/Password and Google OAuth
- **Two User Roles**: Manager and Employee with distinct permissions
- **Human-Readable IDs**: Unique IDs like `MTAI001`, `MTAI002` for easy reference
- **Secure JWT Verification**: All API endpoints verify Firebase tokens

### 📹 Meeting Management
- **File Upload**: Support for audio (MP3, WAV, M4A) and video (MP4, MOV, WebM) files
- **Cloudinary Storage**: Secure cloud storage for media files with progress tracking
- **Real-Time Status**: Live status updates via Firestore listeners
- **Meeting History**: Complete history with filtering and search capabilities

### 🎙️ AI-Powered Transcription
- **AssemblyAI Integration**: Industry-leading speech-to-text accuracy
- **Speaker Diarization**: Automatic detection of multiple speakers
- **Webhook Processing**: Asynchronous processing with webhook callbacks
- **Formatted Transcripts**: Timestamped, speaker-labeled transcripts

### 🗺️ Speaker Mapping (Human-in-the-Loop)
- **Intuitive UI**: Easy dropdown-based speaker-to-employee mapping
- **Validation**: Prevents duplicate assignments and manager self-assignment
- **Participant Tracking**: Automatically links meeting participants

### ✅ Task Management
- **Manual Task Creation**: Managers create tasks with full control
- **Priority Levels**: Critical, High, Medium, Low with visual indicators
- **Status Tracking**: Pending → In Progress → Completed → Blocked
- **Due Dates**: Optional deadline tracking with overdue indicators
- **File Requirements**: Option to require file attachments per task

### 📤 Task Submission System
- **Text Responses**: Employees provide detailed text explanations
- **Google Drive Integration**: Submit work via Google Drive share links
- **Link Validation**: Validates Google Drive/Docs URLs
- **Sharing Confirmation**: Ensures proper sharing permissions before submission
- **Submission History**: Complete audit trail of all submissions

### 📊 Dashboard Analytics
- **Manager Dashboard**: Total meetings, processing status, task statistics
- **Employee Dashboard**: Assigned tasks, pending work, completion stats
- **Recent Activity**: Quick access to recent meetings and tasks
- **Quick Actions**: One-click access to common operations

### 🎨 Modern UI/UX
- **Responsive Design**: Fully responsive across desktop, tablet, and mobile
- **Tailwind CSS 4**: Modern utility-first styling with gradients
- **Loading States**: Skeleton loaders and progress indicators
- **Toast Notifications**: Real-time feedback for all operations
- **Accessibility**: ARIA labels and keyboard navigation support

---

## 🛠️ Tech Stack

| Category | Technology | Purpose |
|----------|------------|---------|
| **Frontend** | React 19 + TypeScript | Component-based UI with type safety |
| **Styling** | Tailwind CSS 4 | Utility-first responsive design |
| **Build Tool** | Vite 6 | Fast development and optimized builds |
| **Routing** | React Router 7 | Client-side navigation |
| **Auth** | Firebase Auth | Email/Password + Google OAuth |
| **Database** | Firebase Firestore | Real-time NoSQL database |
| **File Storage** | Cloudinary | Media file uploads and streaming |
| **Transcription** | AssemblyAI | Speech-to-text with speaker diarization |
| **Backend** | Vercel Serverless | Node.js API functions |
| **HTTP Client** | Axios | API requests with interceptors |

---

## 🏗️ System Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      FRONTEND (React SPA)                     │
│    React 19 • TypeScript • Tailwind CSS 4 • Vite • React Router │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│              VERCEL SERVERLESS API (9 Endpoints)             │
│  ┌─────────────────┬────────────────┬─────────────────────┐  │
│  │  orchestrator   │   create-task  │  webhook/assemblyai │  │
│  │  submit-task    │   update-task  │  save-speaker-map   │  │
│  │  reset-meeting  │   health       │                     │  │
│  └─────────────────┴────────────────┴─────────────────────┘  │
└───────────────────────────┬──────────────────────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│    FIREBASE     │ │   ASSEMBLYAI    │ │   CLOUDINARY    │
│  ┌───────────┐  │ │  ┌───────────┐  │ │  ┌───────────┐  │
│  │   Auth    │  │ │  │  Speech   │  │ │  │  Media    │  │
│  │  (Users)  │  │ │  │  to Text  │  │ │  │  Storage  │  │
│  ├───────────┤  │ │  ├───────────┤  │ │  │  (Audio/  │  │
│  │ Firestore │  │ │  │  Speaker  │  │ │  │  Video)   │  │
│  │  (Data)   │  │ │  │Diarization│  │ │  └───────────┘  │
│  └───────────┘  │ │  └───────────┘  │ │                 │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

### Data Flow

1. **Meeting Upload Flow**:
   ```
   User uploads file → Cloudinary stores media → Firestore saves metadata
   → Orchestrator triggers AssemblyAI → Webhook receives transcript
   → Status: needs_mapping
   ```

2. **Task Assignment Flow**:
   ```
   Manager maps speakers → Status: completed → Manager creates tasks
   → Tasks assigned to employees → Employees receive notifications
   ```

3. **Task Submission Flow**:
   ```
   Employee views task → Uploads to Google Drive → Shares link
   → Submits via API → Manager reviews submission
   ```

---

## 📁 Project Structure

```
meettask-ai/
├── api/                              # Vercel Serverless Functions
│   ├── _lib/                         # Shared utilities
│   │   ├── firebaseAdmin.ts          # Firebase Admin SDK setup
│   │   ├── verifyToken.ts            # JWT verification helper
│   │   └── types.ts                  # API type definitions
│   ├── webhook/
│   │   └── assemblyai.ts             # AssemblyAI webhook handler
│   ├── orchestrator.ts               # Meeting processing orchestrator
│   ├── create-task.ts                # Task creation (managers)
│   ├── update-task.ts                # Task status updates
│   ├── submit-task.ts                # Task submission (employees)
│   ├── save-speaker-mapping.ts       # Speaker-to-employee mapping
│   ├── reset-meeting.ts              # Reset meeting for reprocessing
│   └── health.ts                     # Health check endpoint
│
├── components/                       # Reusable React Components
│   ├── Layout.tsx                    # App layout with sidebar/navigation
│   ├── ProtectedRoute.tsx            # Auth guard for routes
│   └── ToastContainer.tsx            # Toast notification system
│
├── contexts/
│   └── AuthContext.tsx               # Authentication state & methods
│
├── hooks/
│   ├── useMeetings.ts                # Meetings data & helpers
│   └── useToast.ts                   # Toast notification hook
│
├── lib/
│   └── firebase.ts                   # Firebase client configuration
│
├── pages/                            # Route Page Components
│   ├── LandingPage.tsx               # Public landing page
│   ├── LoginPage.tsx                 # Auth page (login/signup)
│   ├── Dashboard.tsx                 # Role-based dashboard
│   ├── UploadPage.tsx                # Meeting upload (managers)
│   ├── MeetingsPage.tsx              # Meeting list view
│   ├── MeetingDetailsPage.tsx        # Meeting details & task assignment
│   ├── TasksPage.tsx                 # Employee task view & submission
│   ├── TaskManagerPage.tsx           # Manager task overview
│   └── ProfilePage.tsx               # User profile settings
│
├── services/
│   └── api.ts                        # Axios API client
│
├── src/
│   └── index.css                     # Global styles & Tailwind imports
│
├── types.ts                          # Global TypeScript definitions
├── App.tsx                           # Main app component with routes
├── index.tsx                         # React entry point
├── index.html                        # HTML template
├── vite.config.ts                    # Vite configuration
├── tailwind.config.js                # Tailwind CSS configuration
├── tsconfig.json                     # TypeScript configuration
├── vercel.json                       # Vercel deployment config
└── package.json                      # Dependencies & scripts
```

---

## 🔄 User Workflows

### Manager Workflow

```
1. SIGN UP/LOGIN
   └── Create account as "Manager" role
   
2. UPLOAD MEETING
   └── Upload audio/video file → Automatic transcription starts
   
3. WAIT FOR PROCESSING
   └── Status: uploaded → processing → transcribing → needs_mapping
   
4. MAP SPEAKERS
   └── Assign Speaker A, B, C to actual employees (dropdown selection)
   
5. CREATE TASKS
   └── From meeting details page, create tasks:
       • Title & description
       • Assign to employee
       • Set priority (Critical/High/Medium/Low)
       • Optional due date
       • Optional file requirement
   
6. TRACK PROGRESS
   └── View task statuses, review employee submissions
```

### Employee Workflow

```
1. SIGN UP/LOGIN
   └── Create account as "Employee" role
   
2. VIEW ASSIGNED TASKS
   └── Dashboard shows all assigned tasks with priorities
   
3. WORK ON TASK
   └── View task details, related meeting transcript (if participant)
   
4. SUBMIT WORK
   └── Upload file to personal Google Drive
       • Right-click → Share → "Anyone with the link"
       • Set permission to "Viewer"
       • Copy link
   └── Paste link in submission form
   └── Add text description
   └── Confirm sharing checkbox
   └── Submit
   
5. TRACK STATUS
   └── View submission history and status updates
```

---

## 🔌 API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/health` | GET | No | Health check |
| `/api/orchestrator` | POST | Yes | Start meeting transcription |
| `/api/webhook/assemblyai` | POST | No* | AssemblyAI callback |
| `/api/save-speaker-mapping` | POST | Yes | Save speaker-to-employee mapping |
| `/api/create-task` | POST | Yes | Create new task (manager only) |
| `/api/update-task` | POST | Yes | Update task status |
| `/api/submit-task` | POST | Yes | Submit task work (employee only) |
| `/api/reset-meeting` | POST | Yes | Reset meeting for reprocessing |

*Webhook uses AssemblyAI's verification instead of user auth

---

## 🗃️ Database Schema

### Firestore Collections

```
/users/{mtaiId}
├── uid: string              # Firebase Auth UID
├── mtaiId: string           # MTAI001, MTAI002, etc.
├── email: string
├── name: string
├── role: 'manager' | 'employee'
├── authProviders: ['google' | 'password']
├── photoURL?: string
├── createdAt: Timestamp
└── updatedAt: Timestamp

/meetings/{meetingId}
├── title: string
├── userId: string           # Creator's Firebase UID
├── creatorMtaiId: string
├── creatorName: string
├── fileUrl: string
├── fileType: 'audio' | 'video'
├── status: 'uploaded' | 'processing' | 'transcribing' | 'needs_mapping' | 'completed' | 'error'
├── speakers: ['A', 'B', 'C']
├── speakerMapping: { A: 'MTAI001', B: 'MTAI002' }
├── speakerCount: number
├── duration: number
├── taskCount: number
├── errorMessage?: string
├── createdAt: Timestamp
└── updatedAt: Timestamp

/transcripts/{meetingId}
├── meetingId: string
├── text: string             # Raw transcript
├── formattedTranscript: string
├── utterances: SpeakerUtterance[]
├── speakerMapping: object
├── speakerCount: number
├── wordCount: number
├── confidence: number
├── createdAt: Timestamp
└── updatedAt: Timestamp

/tasks/{taskId}
├── taskId: string           # TASK001, TASK002, etc.
├── meetingId: string
├── meetingTitle: string
├── creatorId: string
├── creatorMtaiId: string
├── creatorName: string
├── assignedTo: string       # Employee MTAI ID
├── assignedToName: string
├── assignedToEmail: string
├── title: string
├── description: string
├── priority: 'critical' | 'high' | 'medium' | 'low'
├── status: 'pending' | 'in_progress' | 'completed' | 'blocked'
├── requiresFile: boolean
├── dueDate?: string
├── submissionText?: string
├── submissionFileUrl?: string
├── submissionFileName?: string
├── submittedAt?: Timestamp
├── createdAt: Timestamp
├── updatedAt: Timestamp
└── completedAt?: Timestamp

/counters/users
└── lastId: number           # For MTAI ID generation

/counters/tasks
└── lastId: number           # For TASK ID generation
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js v18 or higher
- npm or yarn
- Firebase project with Auth and Firestore enabled
- AssemblyAI account with API key
- Cloudinary account with upload preset

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/meettask-ai.git
   cd meettask-ai
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. **Run development server**
   ```bash
   npm run dev
   ```

5. **Open in browser**
   ```
   http://localhost:5173
   ```

---

## 🔐 Environment Variables

Create a `.env` file in the root directory:

```env
# ========================================
# FIREBASE CLIENT (Frontend)
# ========================================
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# ========================================
# FIREBASE ADMIN (Backend APIs)
# ========================================
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your_project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# ========================================
# ASSEMBLYAI
# ========================================
ASSEMBLYAI_API_KEY=your_assemblyai_api_key

# ========================================
# CLOUDINARY
# ========================================
VITE_CLOUDINARY_CLOUD_NAME=your_cloud_name
VITE_CLOUDINARY_UPLOAD_PRESET=your_upload_preset
```

---

## 🌐 Deployment

### Deploy to Vercel

1. **Install Vercel CLI**
   ```bash
   npm i -g vercel
   ```

2. **Deploy**
   ```bash
   vercel --prod
   ```

3. **Configure Environment Variables**
   - Go to Vercel Dashboard → Project Settings → Environment Variables
   - Add all variables from `.env`

4. **Configure AssemblyAI Webhook**
   - Set webhook URL in your orchestrator:
     ```
     https://your-app.vercel.app/api/webhook/assemblyai
     ```

### Vercel Configuration (`vercel.json`)

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "/api/:path*" },
    { "source": "/(.*)", "destination": "/" }
  ]
}
```

---

## 🔒 Security

### Authentication Security
- Firebase JWT tokens verified on all protected endpoints
- Token expiration and refresh handled automatically
- Role-based access control (RBAC) enforced

### Data Security
- Firestore security rules enforce ownership checks
- Users can only access their own data
- Managers can only modify their own meetings/tasks

### API Security
- All endpoints validate authentication tokens
- CORS headers configured for production domains
- Input validation on all request bodies
- No sensitive data in client-side storage

### File Security
- Cloudinary unsigned uploads restricted to specific presets
- Google Drive links validated before acceptance
- No direct file storage on application servers

---

## 👥 User Roles & Permissions

| Feature | Manager | Employee |
|---------|:-------:|:--------:|
| Upload meetings | ✅ | ❌ |
| View all meetings | ✅ | ❌ |
| View assigned meetings | ✅ | ✅ |
| Map speakers | ✅ | ❌ |
| Create tasks | ✅ | ❌ |
| View all tasks | ✅ | ❌ |
| View assigned tasks | ✅ | ✅ |
| Update task status | ✅ | ✅ (own) |
| Submit work | ❌ | ✅ |
| View submissions | ✅ | ✅ (own) |
| Reset meetings | ✅ | ❌ |

---

## 📝 File Submission Guidelines

Employees submit work via Google Drive share links:

1. **Upload** file to your Google Drive
2. **Right-click** the file → **Share**
3. **Change** to "Anyone with the link"
4. **Set permission** to "Viewer" (read-only)
5. **Copy** the link
6. **Paste** in MeetTask AI submission form
7. **Check** the sharing confirmation box
8. **Submit**

### Supported Link Formats
- `drive.google.com/file/d/...`
- `docs.google.com/document/d/...`
- `docs.google.com/spreadsheets/d/...`
- `docs.google.com/presentation/d/...`

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [AssemblyAI](https://www.assemblyai.com/) for speech-to-text API
- [Firebase](https://firebase.google.com/) for authentication and database
- [Cloudinary](https://cloudinary.com/) for media storage
- [Vercel](https://vercel.com/) for serverless deployment
- [Tailwind CSS](https://tailwindcss.com/) for styling utilities

---

<p align="center">
  <strong>Built with ❤️ using React, Firebase, and AI</strong>
  <br><br>
  <a href="#-meettask-ai">Back to Top ↑</a>
</p>
