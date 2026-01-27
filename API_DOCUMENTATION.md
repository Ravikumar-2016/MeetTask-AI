# MeetTask AI - Backend API Documentation

## Overview

MeetTask AI uses Vercel Serverless Functions for the backend. All API endpoints require Firebase authentication via Bearer token.

## Authentication

All API endpoints require a valid Firebase ID token in the `Authorization` header:

```
Authorization: Bearer <firebase-id-token>
```

### Getting the Token (Frontend)

```typescript
import { auth } from './lib/firebase';

const token = await auth.currentUser?.getIdToken();

const response = await fetch('/api/endpoint', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify(data)
});
```

---

## API Endpoints

### 1. Create Meeting

**POST** `/api/createMeeting`

Creates a new meeting record after the user uploads audio/video to Cloudinary.

#### Request Body

```json
{
  "title": "Weekly Team Standup",
  "audioUrl": "https://res.cloudinary.com/.../audio.mp3",
  "description": "Optional meeting description",
  "duration": 1800
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | ✅ | Meeting title |
| `audioUrl` | string | ✅ | Cloudinary URL of uploaded audio/video |
| `description` | string | ❌ | Optional meeting description |
| `duration` | number | ❌ | Duration in seconds |

#### Response (201 Created)

```json
{
  "success": true,
  "meeting": {
    "id": "abc123xyz",
    "title": "Weekly Team Standup",
    "userId": "user-uid",
    "audioUrl": "https://res.cloudinary.com/.../audio.mp3",
    "description": "Optional meeting description",
    "duration": 1800,
    "status": "uploaded",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

#### Errors

| Status | Message |
|--------|---------|
| 400 | Missing required field: title |
| 400 | Missing required field: audioUrl |
| 401 | Missing authorization header |
| 401 | Invalid token |
| 405 | Method not allowed |
| 500 | Failed to create meeting |

---

### 2. Transcribe Meeting

**POST** `/api/transcribe`

Transcribes meeting audio using OpenAI Whisper API.

#### Request Body

```json
{
  "meetingId": "abc123xyz"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `meetingId` | string | ✅ | ID of the meeting to transcribe |

#### Response (200 OK)

```json
{
  "success": true,
  "meetingId": "abc123xyz",
  "transcript": "Full transcript text here...",
  "wordCount": 1250
}
```

#### Process Flow

1. Verifies user token and meeting ownership
2. Downloads audio from Cloudinary URL
3. Sends to OpenAI Whisper for transcription
4. Saves transcript to `transcripts/{meetingId}` collection
5. Updates meeting status to `processing`

#### Errors

| Status | Message |
|--------|---------|
| 400 | Missing required field: meetingId |
| 401 | Invalid token |
| 403 | Not authorized to access this meeting |
| 404 | Meeting not found |
| 500 | Failed to transcribe audio |
| 500 | Failed to download audio file |

---

### 3. Extract Tasks

**POST** `/api/extractTasks`

Extracts action items from a meeting transcript using Google Gemini AI.

#### Request Body

```json
{
  "meetingId": "abc123xyz"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `meetingId` | string | ✅ | ID of the meeting to extract tasks from |

#### Response (200 OK)

```json
{
  "success": true,
  "meetingId": "abc123xyz",
  "taskCount": 5,
  "tasks": [
    {
      "id": "task123",
      "title": "Review Q4 budget proposal",
      "description": "Detailed description of the task",
      "priority": "high",
      "assignee": "John",
      "dueDate": "2024-01-20",
      "status": "pending",
      "meetingId": "abc123xyz",
      "createdAt": "2024-01-15T10:35:00.000Z"
    }
  ]
}
```

#### Process Flow

1. Verifies user token
2. Retrieves transcript from `transcripts/{meetingId}`
3. Sends transcript to Google Gemini with task extraction prompt
4. Parses AI response into structured tasks
5. Saves tasks to `tasks` collection
6. Updates meeting status to `completed`

#### Errors

| Status | Message |
|--------|---------|
| 400 | Missing required field: meetingId |
| 401 | Invalid token |
| 404 | Transcript not found. Please transcribe the meeting first. |
| 500 | Failed to extract tasks |

---

## Meeting Status Flow

```
uploaded → processing → completed
                ↓
              error
```

| Status | Description |
|--------|-------------|
| `uploaded` | Audio uploaded, ready for transcription |
| `processing` | Transcription in progress or task extraction |
| `completed` | All processing complete, tasks extracted |
| `error` | An error occurred during processing |

---

## Data Models

### Meeting

```typescript
interface Meeting {
  id: string;
  userId: string;
  title: string;
  audioUrl: string;
  description?: string;
  duration?: number;
  status: 'uploaded' | 'processing' | 'completed' | 'error';
  createdAt: Date;
  updatedAt?: Date;
}
```

### Transcript

```typescript
interface Transcript {
  id: string;           // Same as meetingId
  meetingId: string;
  text: string;
  wordCount: number;
  createdAt: Date;
}
```

### Task

```typescript
interface Task {
  id: string;
  meetingId: string;
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'in-progress' | 'completed';
  assignee?: string;
  dueDate?: string;
  createdAt: Date;
}
```

---

## Environment Variables

Required environment variables for the backend (set in Vercel dashboard):

```env
# Firebase Admin SDK (from service account JSON)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# OpenAI API (for Whisper transcription)
OPENAI_API_KEY=sk-...

# Google Gemini API (for task extraction)
GEMINI_API_KEY=AIza...
```

### Getting Firebase Service Account Credentials

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project → **Project Settings** (gear icon)
3. Go to **Service Accounts** tab
4. Click **Generate New Private Key**
5. Download the JSON file
6. Copy values to environment variables:
   - `project_id` → `FIREBASE_PROJECT_ID`
   - `client_email` → `FIREBASE_CLIENT_EMAIL`
   - `private_key` → `FIREBASE_PRIVATE_KEY`

### Getting API Keys

**OpenAI API Key:**
1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Create a new secret key
3. Copy to `OPENAI_API_KEY`

**Google Gemini API Key:**
1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Create an API key
3. Copy to `GEMINI_API_KEY`

---

## Frontend Integration Example

```typescript
// services/api.ts

const API_BASE = '/api';

async function getAuthHeaders(): Promise<HeadersInit> {
  const { auth } = await import('../lib/firebase');
  const token = await auth.currentUser?.getIdToken();
  
  if (!token) {
    throw new Error('Not authenticated');
  }
  
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

export async function createMeeting(data: {
  title: string;
  audioUrl: string;
  description?: string;
  duration?: number;
}) {
  const response = await fetch(`${API_BASE}/createMeeting`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify(data)
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create meeting');
  }
  
  return response.json();
}

export async function transcribeMeeting(meetingId: string) {
  const response = await fetch(`${API_BASE}/transcribe`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ meetingId })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to transcribe');
  }
  
  return response.json();
}

export async function extractTasks(meetingId: string) {
  const response = await fetch(`${API_BASE}/extractTasks`, {
    method: 'POST',
    headers: await getAuthHeaders(),
    body: JSON.stringify({ meetingId })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to extract tasks');
  }
  
  return response.json();
}
```

---

## Deployment

### Deploy to Vercel

1. Push code to GitHub
2. Connect repo to Vercel
3. Add environment variables in Vercel dashboard:
   - Project Settings → Environment Variables
   - Add all required variables
4. Deploy

### Local Development

```bash
# Install Vercel CLI
npm i -g vercel

# Run locally (with env vars from .env.local)
vercel dev
```

---

## Troubleshooting

### Common Errors

**"Invalid token"**
- Token may have expired (1 hour lifetime)
- Call `auth.currentUser.getIdToken(true)` to force refresh

**"Not authorized to access this meeting"**
- User is trying to access another user's meeting
- Check that `meetingId` belongs to the authenticated user

**"Transcript not found"**
- Must call `/api/transcribe` before `/api/extractTasks`
- Check that transcription completed successfully

**"Failed to download audio file"**
- Cloudinary URL may be invalid or expired
- Check that file was uploaded correctly

### Debug Mode

Check Vercel function logs:
```bash
vercel logs your-project.vercel.app
```
