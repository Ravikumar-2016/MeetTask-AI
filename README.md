<p align="center">
  <img src="https://img.shields.io/badge/React-19.2-61DAFB?style=for-the-badge&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Firebase-12.8-FFCA28?style=for-the-badge&logo=firebase&logoColor=black" alt="Firebase" />
  <img src="https://img.shields.io/badge/Tailwind-4.1-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white" alt="Tailwind" />
  <img src="https://img.shields.io/badge/Vite-6.2-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Vercel-Deployed-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel" />
</p>

# 🎯 MeetTask AI

> **Transform meeting recordings into actionable tasks with intelligent transcription and speaker diarization.**

MeetTask AI is a full-stack enterprise application that streamlines the meeting-to-task workflow. Managers upload meeting recordings, the system transcribes them with speaker identification, and tasks can be manually assigned to team members based on the meeting content.

---

## ✨ Features

### 🔐 Authentication & Authorization
- **Multi-provider Auth**: Email/Password and Google OAuth via Firebase
- **Role-based Access**: Manager and Employee roles with distinct permissions
- **Email Verification**: Secure signup flow with email verification
- **Human-readable IDs**: Unique MTAI IDs (e.g., `MTAI001`) for easy reference

### 📹 Meeting Management
- **Upload Support**: Audio (MP3, WAV, M4A) and Video (MP4, MOV, WebM) files
- **Cloud Storage**: Cloudinary integration for secure media storage
- **Real-time Status**: Live updates on processing status via Firestore

### 🎙️ Intelligent Transcription
- **AssemblyAI Integration**: Professional-grade speech-to-text
- **Speaker Diarization**: Automatic speaker identification (Speaker A, B, C...)
- **Speaker Mapping**: Map detected speakers to registered employees
- **Webhook Processing**: Asynchronous transcription with webhook callbacks

### ✅ Task Management
- **Manual Task Creation**: Managers create tasks based on meeting content
- **Priority Levels**: Critical, High, Medium, Low
- **Status Tracking**: Pending → In Progress → Completed / Blocked
- **Employee Submissions**: File uploads and text responses via Cloudinary
- **Due Date Management**: Track deadlines and overdue tasks

### 📊 Dashboards
- **Manager Dashboard**: Overview of all meetings, tasks, and team performance
- **Employee Dashboard**: Personal task list with pending items
- **Real-time Updates**: Firestore listeners for instant data sync

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│  React 19 + TypeScript + Tailwind CSS 4 + Vite                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    VERCEL SERVERLESS API                         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │ createMeeting│ │ transcribe   │ │ create-task  │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │process-meeting│ │ update-task │ │ submit-task  │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │save-speaker- │ │ reset-meeting│ │ orchestrator │            │
│  │   mapping    │ └──────────────┘ └──────────────┘            │
│  └──────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐
│   FIREBASE       │ │   ASSEMBLYAI     │ │   CLOUDINARY     │
│  • Auth          │ │  • Transcription │ │  • Media Storage │
│  • Firestore     │ │  • Diarization   │ │  • File Uploads  │
│  • Admin SDK     │ │  • Webhooks      │ │                  │
└──────────────────┘ └──────────────────┘ └──────────────────┘
```

---

## 🛠️ Tech Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 19.2 | UI Framework |
| TypeScript | 5.8 | Type Safety |
| Tailwind CSS | 4.1 | Styling |
| Vite | 6.2 | Build Tool |
| React Router | 7.13 | Navigation |

### Backend & Services
| Technology | Purpose |
|------------|---------|
| Vercel Serverless Functions | API Endpoints |
| Firebase Auth | Authentication |
| Firebase Firestore | Database |
| Firebase Admin SDK | Server-side Auth |
| AssemblyAI | Speech-to-Text & Diarization |
| Cloudinary | Media & File Storage |

### Additional Libraries
| Library | Purpose |
|---------|---------|
| Axios | HTTP Client |
| @google/generative-ai | Gemini AI (optional features) |
| OpenAI SDK | GPT Integration (optional) |
| Resend | Email Notifications |

---

## 📁 Project Structure

```
meettask-ai/
├── api/                        # Vercel Serverless Functions
│   ├── _lib/                   # Shared utilities
│   │   ├── firebaseAdmin.ts    # Firebase Admin initialization
│   │   ├── verifyToken.ts      # JWT verification
│   │   ├── speakerMapper.ts    # Speaker mapping logic
│   │   └── types.ts            # API types
│   ├── webhook/
│   │   └── assemblyai.ts       # AssemblyAI webhook handler
│   ├── createMeeting.ts        # Create new meeting
│   ├── transcribe.ts           # Start transcription
│   ├── process-meeting.ts      # Process meeting workflow
│   ├── save-speaker-mapping.ts # Save speaker assignments
│   ├── create-task.ts          # Create task
│   ├── update-task.ts          # Update task status
│   ├── submit-task.ts          # Employee task submission
│   ├── reset-meeting.ts        # Reset meeting status
│   ├── orchestrator.ts         # Workflow orchestration
│   └── health.ts               # Health check endpoint
│
├── components/                 # React Components
│   ├── Layout.tsx              # Main layout wrapper
│   └── ProtectedRoute.tsx      # Auth route guard
│
├── contexts/
│   └── AuthContext.tsx         # Authentication context
│
├── hooks/
│   └── useMeetings.ts          # Meetings data hook
│
├── lib/
│   ├── firebase.ts             # Firebase client config
│   └── firebaseAdmin.ts        # Admin SDK config
│
├── pages/                      # Page Components
│   ├── Dashboard.tsx           # Main dashboard
│   ├── ManagerDashboard.tsx    # Manager-specific view
│   ├── MeetingsPage.tsx        # Meetings list
│   ├── MeetingDetailsPage.tsx  # Meeting detail view
│   ├── TasksPage.tsx           # Employee task view
│   ├── TaskManagerPage.tsx     # Manager task management
│   ├── UploadPage.tsx          # Meeting upload
│   ├── ProfilePage.tsx         # User profile
│   ├── LoginPage.tsx           # Authentication
│   └── LandingPage.tsx         # Public landing
│
├── services/
│   ├── api.ts                  # API client functions
│   └── aiPipeline.ts           # AI processing utilities
│
├── types.ts                    # Global TypeScript types
├── App.tsx                     # Main App component
├── index.tsx                   # Entry point
└── index.html                  # HTML template
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18+ 
- **npm** or **yarn**
- **Firebase Project** with Auth & Firestore enabled
- **AssemblyAI Account** for transcription
- **Cloudinary Account** for media storage
- **Vercel Account** for deployment (optional)

### Environment Variables

Create a `.env` file in the root directory:

```env
# Firebase Client
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id

# Firebase Admin (for API functions)
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=your_service_account_email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# AssemblyAI
ASSEMBLYAI_API_KEY=your_assemblyai_key

# Cloudinary (Frontend - unsigned uploads)
VITE_CLOUDINARY_CLOUD_NAME=your_cloud_name
VITE_CLOUDINARY_UPLOAD_PRESET=meeting_uploads

# App URL (for webhooks)
VITE_APP_URL=https://your-app.vercel.app
```

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/meettask-ai.git
cd meettask-ai

# Install dependencies
npm install

# Start development server
npm run dev
```

### Build for Production

```bash
npm run build
npm run preview
```

---

## 🔄 Workflow

### Meeting Processing Flow

```
1. Manager uploads meeting file
   └─▶ File uploaded to Cloudinary
   └─▶ Meeting document created in Firestore (status: 'uploaded')

2. Transcription initiated
   └─▶ AssemblyAI processes audio with speaker diarization
   └─▶ Meeting status: 'transcribing'

3. Webhook receives transcription
   └─▶ Transcript saved to Firestore
   └─▶ Speakers extracted (A, B, C...)
   └─▶ Meeting status: 'needs_mapping'

4. Manager maps speakers
   └─▶ Assigns Speaker A → Employee MTAI001
   └─▶ Assigns Speaker B → Employee MTAI002
   └─▶ Meeting status: 'completed'

5. Manager creates tasks
   └─▶ Assigns tasks to mapped employees
   └─▶ Employees receive tasks in their dashboard
```

---

## 👥 User Roles

### Manager
- ✅ Upload meeting recordings
- ✅ View all meetings and transcripts
- ✅ Map speakers to employees
- ✅ Create and assign tasks
- ✅ Monitor team task progress
- ✅ Access manager dashboard

### Employee
- ✅ View assigned tasks
- ✅ Update task status
- ✅ Submit work (text/files)
- ✅ View meeting transcripts (where assigned)
- ✅ Access employee dashboard

---

## 📡 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/createMeeting` | POST | Create new meeting |
| `/api/transcribe` | POST | Start transcription |
| `/api/process-meeting` | POST | Process meeting workflow |
| `/api/save-speaker-mapping` | POST | Save speaker assignments |
| `/api/create-task` | POST | Create new task |
| `/api/update-task` | POST | Update task status |
| `/api/submit-task` | POST | Submit task work |
| `/api/reset-meeting` | POST | Reset meeting status |
| `/api/webhook/assemblyai` | POST | AssemblyAI webhook |

---

## 🔒 Security

- **Firebase Auth**: Secure authentication with email verification
- **JWT Verification**: All API endpoints verify Firebase ID tokens
- **Role-based Access**: Firestore rules enforce role permissions
- **Environment Variables**: Sensitive keys stored securely

---

## 🚢 Deployment

### Vercel (Recommended)

1. Connect your GitHub repository to Vercel
2. Add environment variables in Vercel dashboard
3. Deploy automatically on push

```bash
# Manual deployment
npm i -g vercel
vercel --prod
```

### Important Notes

- Vercel Hobby plan supports max **12 serverless functions**
- Configure AssemblyAI webhook URL: `https://your-app.vercel.app/api/webhook/assemblyai`

---

## 📄 License

This project is licensed under the MIT License.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📧 Support

For support, please open an issue in the GitHub repository.

---

<p align="center">
  Built with ❤️ using React, Firebase, and AssemblyAI
</p>
