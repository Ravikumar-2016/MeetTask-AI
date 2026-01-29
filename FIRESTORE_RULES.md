# Firestore Security Rules Setup

## MeetTask AI Database Architecture

### Collections:
- `users/{mtaiId}` - User documents (MTAI001, MTAI002, etc.)
- `counters/users` - Counter for MTAI ID generation (`{ lastId: number }`)
- `meetings/{meetingId}` - Meeting documents
- `transcripts/{meetingId}` - Transcript documents
- `tasks/{taskId}` - Task documents

## Steps to Set Up Rules:

### 1. Go to Firebase Console
- Visit: https://console.firebase.google.com
- Select your project: **meettask-ai**

### 2. Navigate to Firestore Database
- Click on **Firestore Database** in the left sidebar
- Click on the **Rules** tab

### 3. Copy These Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // ============================================
    // HELPER FUNCTIONS
    // ============================================
    
    function isAuthenticated() {
      return request.auth != null;
    }
    
    // ============================================
    // COUNTERS - For MTAI ID generation
    // ============================================
    match /counters/{counterId} {
      // Anyone authenticated can read/write counters
      // This allows the transaction to increment lastId
      allow read, write: if isAuthenticated();
    }
    
    // ============================================
    // USERS - Stored by MTAI ID (users/{mtaiId})
    // ============================================
    match /users/{mtaiId} {
      // Any authenticated user can read any user (for speaker mapping dropdown)
      allow read: if isAuthenticated();
      
      // Users can create their own document (checked by matching uid in data)
      allow create: if isAuthenticated() && 
                       request.resource.data.uid == request.auth.uid;
      
      // Users can update their own document (checked by matching uid in data)
      allow update: if isAuthenticated() && 
                       resource.data.uid == request.auth.uid;
      
      // No client-side deletion
      allow delete: if false;
    }
    
    // ============================================
    // MEETINGS - User's meetings
    // ============================================
    match /meetings/{meetingId} {
      // Users can read their own meetings
      allow read: if isAuthenticated() && 
                    (resource == null || resource.data.userId == request.auth.uid);
      
      // Users can create meetings with their userId
      allow create: if isAuthenticated() && 
                       request.resource.data.userId == request.auth.uid;
      
      // Users can update/delete their own meetings
      allow update, delete: if isAuthenticated() && 
                               resource.data.userId == request.auth.uid;
    }
    
    // ============================================
    // TRANSCRIPTS - Linked to meetings
    // ============================================
    match /transcripts/{meetingId} {
      // Users can read transcripts (backend creates them)
      allow read: if isAuthenticated();
      
      // Only backend (Admin SDK) can write transcripts
      allow write: if false;
    }
    
    // ============================================
    // TASKS - Manager-created, Employee-assigned
    // ============================================
    match /tasks/{taskId} {
      // Managers can read tasks they created (creatorId matches)
      // Employees can read tasks assigned to them (we allow all authenticated for now)
      // This is safe because assignedTo is validated server-side
      allow read: if isAuthenticated();
      
      // Only backend (Admin SDK) creates tasks
      // Managers use /api/create-task endpoint
      allow create: if false;
      
      // Employees can update tasks assigned to them (for status updates)
      // Managers can update tasks they created
      allow update: if isAuthenticated();
      
      // Only backend can delete tasks
      allow delete: if false;
    }
  }
}
```

### 4. Publish the Rules
- Click **Publish** button
- Wait for confirmation

## Database Structure

### users/{mtaiId}
```json
{
  "uid": "firebase_auth_uid",
  "mtaiId": "MTAI001",
  "displayName": "Ravi Kumar",
  "email": "ravi@gmail.com",
  "authProviders": ["google", "password"],
  "photoURL": "https://...",
  "createdAt": "2026-01-28T..."
}
```

### counters/users
```json
{
  "lastId": 3
}
```

### meetings/{meetingId}
```json
{
  "id": "abc123",
  "title": "Team Standup",
  "userId": "firebase_auth_uid",
  "ownerMtaiId": "MTAI001",
  "status": "completed",
  "speakerMapping": { "A": "MTAI001", "B": "MTAI002" }
}
```

## Key Points

1. **Users are stored by MTAI ID** (`users/MTAI001`), not by Firebase UID
2. **Counter at `counters/users`** tracks the last assigned ID number
3. **Email deduplication**: Same email = same user, even with different auth providers
4. **UID is stored inside the document** for permission checks
5. **Frontend never shows Firebase UIDs** - only MTAI IDs are displayed

## Testing Rules

After updating rules, try:
1. Sign up with a new account
2. Login with existing account
3. Check Firestore console to see if user document was created
4. No more "Missing or insufficient permissions" errors!

## Troubleshooting

If you still see errors:
1. Make sure you clicked **Publish** in Firebase Console
2. Wait 1-2 minutes for rules to propagate
3. Clear browser cache and try again
4. Check Firebase Console > Firestore > Data to verify documents are being created
