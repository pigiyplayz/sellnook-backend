# Sellnook Backend

Express + Firebase Admin API for Sellnook.

## Setup

### 1. Install dependencies
```
npm install
```

### 2. Add your service account key
- Download your Firebase service account key from:
  Firebase Console → Project Settings → Service Accounts → Generate new private key
- Save the file as `serviceAccountKey.json` in this folder
- This file is in .gitignore — never commit it

### 3. Run locally
```
npm run dev
```

### 4. Deploy to Vercel
```
npm install -g vercel
vercel
```
When prompted:
- Set up and deploy: Y
- Which scope: your account
- Link to existing project: N
- Project name: sellnook-backend
- Directory: ./
- Override settings: N

### 5. Add environment variable on Vercel
Since serviceAccountKey.json can't be committed, on Vercel you set it as an environment variable:
1. Go to vercel.com → your project → Settings → Environment Variables
2. Add each field from your serviceAccountKey.json as individual variables
   OR paste the whole JSON as FIREBASE_SERVICE_ACCOUNT
3. Update firebase.js to read from process.env if serviceAccountKey.json not found

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | / | None | Health check |
| POST | /api/auth/access | Bearer token | Get user access level |
| GET | /api/user/profile | Bearer token | Get user profile |
| POST | /api/user/profile | Bearer token | Update user profile |
| POST | /api/user/set-pro | Bearer token (dev only) | Set pro status |
