const admin = require('firebase-admin');

// ── Load service account ───────────────────────────────────
// Locally:  place serviceAccountKey.json in this folder
// On Vercel: set FIREBASE_SERVICE_ACCOUNT env variable with the JSON contents
let serviceAccount;

if (process.env.FIREBASE_PRIVATE_KEY) {
  // Option A: Individual environment variables
  serviceAccount = {
    project_id:   process.env.FIREBASE_PROJECT_ID || 'sellnook-1',
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key:  process.env.FIREBASE_PRIVATE_KEY.split('\\n').join('\n').trim()
  };
} else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Option B: Single JSON blob
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT.trim();
    serviceAccount = raw.startsWith('{') 
      ? JSON.parse(raw) 
      : JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
    
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.split('\\n').join('\n').trim();
    }
  } catch (e) {
    console.error('❌ Firebase Config Parse Error:', e.message);
    process.exit(1);
  }
} else {
  // Running locally — read from file
  try {
    serviceAccount = require('./serviceAccountKey.json');
  } catch (e) {
    console.error('❌  Firebase Secret Missing!');
    console.error('    1. For Local Dev: Save your key as sellnook-backend/serviceAccountKey.json');
    console.error('    2. For Render/Production: Add FIREBASE_SERVICE_ACCOUNT environment variable with the JSON string.');
    process.exit(1);
  }
}

// ── Initialize ─────────────────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId:  'sellnook-1'
  });
}

const db   = admin.firestore();
const auth = admin.auth();

/**
 * Standardized helper to create in-app notifications
 */
async function addNotification(userId, { type, title, body, url }) {
  try {
    const ref = db.collection('notifications').doc();
    await ref.set({
      userId,
      type,      // e.g. 'sale', 'offer', 'message', 'system'
      title,
      body,
      url,       // where the notification leads to
      read:      false,
      createdAt: new Date().toISOString()
    });
    return ref.id;
  } catch (e) {
    console.error('Failed to add notification:', e);
    return null;
  }
}

module.exports = { admin, db, auth, addNotification };
