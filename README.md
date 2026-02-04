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
