
# MeetTask AI

MeetTask AI is a production-grade React application designed to help teams turn meeting recordings into actionable tasks using AI.

## Features

- **Modern Authentication**: Firebase-powered Login (Email/Password & Google).
- **Intelligent Dashboard**: At-a-glance view of meetings and task statuses.
- **Automated Processing**: Upload audio/video meetings for AI transcription and task extraction.
- **Task Management**: Track action items, owners, and deadlines in a centralized view.
- **Responsive UI**: Fully optimized for mobile, tablet, and desktop using Tailwind CSS.

## Tech Stack

- **React 18** (Functional components, Hooks, Context API)
- **TypeScript** for type safety
- **Tailwind CSS** for modern styling
- **Firebase** for Authentication and Firestore
- **Axios** for API communication
- **React Router 6** for navigation

## Getting Started

### 1. Prerequisites
- Node.js (v16+)
- npm or yarn

### 2. Environment Variables
Create a `.env` file in the root directory and add your Firebase credentials:
```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_APP_ID=your_app_id
```

### 3. Installation
```bash
npm install
```

### 4. Running Development Server
```bash
npm run dev
```

## Folder Structure
- `src/components`: Reusable UI elements and layout components.
- `src/contexts`: React Context providers (Auth).
- `src/lib`: Configuration files (Firebase).
- `src/pages`: Individual page components.
- `src/services`: API and data handling logic.
- `src/types.ts`: Global TypeScript definitions.
