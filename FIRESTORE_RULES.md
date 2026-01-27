# Firestore Security Rules Setup

## Important: Set Up Firestore Rules

The "Missing or insufficient permissions" error occurs because Firestore has default restrictive security rules. You need to update them in the Firebase Console.

## Steps to Fix:

### 1. Go to Firebase Console
- Visit: https://console.firebase.google.com
- Select your project: **meettask-ai**

### 2. Navigate to Firestore Database
- Click on **Firestore Database** in the left sidebar
- Click on the **Rules** tab

### 3. Update Security Rules

Replace the existing rules with these development-friendly rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Users collection - authenticated users can read/write their own data
    match /users/{userId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Meetings collection - users can only access their own meetings
    match /meetings/{meetingId} {
      allow read: if request.auth != null && request.auth.uid == resource.data.userId;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.userId;
      allow update, delete: if request.auth != null && request.auth.uid == resource.data.userId;
    }
    
    // Tasks collection - users can only access tasks from their meetings
    match /tasks/{taskId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 4. Publish the Rules
- Click **Publish** button
- Wait for confirmation

## For Production (Later):

When deploying to production, use stricter rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper function to check if user is authenticated
    function isAuthenticated() {
      return request.auth != null;
    }
    
    // Helper function to check if user owns the resource
    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }
    
    // Users collection
    match /users/{userId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated() && request.auth.uid == userId;
      allow update: if isOwner(userId);
      allow delete: if false; // Prevent user deletion from client
    }
    
    // Meetings collection
    match /meetings/{meetingId} {
      allow read: if isAuthenticated() && resource.data.userId == request.auth.uid;
      allow create: if isAuthenticated() && 
                       request.resource.data.userId == request.auth.uid &&
                       request.resource.data.keys().hasAll(['title', 'date', 'status', 'userId']);
      allow update: if isOwner(resource.data.userId) &&
                       request.resource.data.userId == resource.data.userId; // Prevent ownership change
      allow delete: if isOwner(resource.data.userId);
    }
    
    // Tasks collection
    match /tasks/{taskId} {
      allow read: if isAuthenticated();
      allow create: if isAuthenticated() &&
                       request.resource.data.keys().hasAll(['meetingId', 'title', 'status']);
      allow update, delete: if isAuthenticated();
    }
  }
}
```

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
