const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');

// Ensure firebase-admin is initialized safely
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Handle escaped newline configurations common in hosting providers like Render
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

// ── Google Sign-In / Token Verification Route ────────────────
router.post('/google', async (req, res) => {
  // 1. Destructure token safely (handling both explicit property and destructured nested objects)
  const idToken = req.body.idToken || req.body.token;

  if (!idToken) {
    console.error('❌ Google Authentication failed: Missing idToken in request body.');
    return res.status(400).json({ 
      error: 'Missing identity token', 
      code: 'MISSING_TOKEN' 
    });
  }

  try {
    // 2. Verify the token against Firebase Authorization servers
    console.log('🔄 Attempting to verify Firebase ID token...');
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    const { uid, email, name, picture } = decodedToken;
    console.log(`✅ Token verified successfully for user: ${email} (${uid})`);

    // 3. Perform or supply database sync operations here (Find or Create User)
    // Example payload response to client application:
    return res.status(200).json({
      success: true,
      user: {
        uid,
        email,
        name: name || email.split('@')[0],
        picture: picture || '',
      }
    });

  } catch (error) {
    console.error('❌ Firebase ID Token verification failed:', error.message);
    
    // Clear and explicit status returns to help your frontend show the right messaging
    return res.status(401).json({ 
      error: 'Invalid or expired Google identity token', 
      code: 'INVALID_CREDENTIALS',
      details: error.message 
    });
  }
});

// Simple Keep-Alive ping endpoint required by server.js
router.get('/ping', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

module.exports = router;
