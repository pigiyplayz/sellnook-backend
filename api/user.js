const express = require('express');
const router = express.Router();
const { verifyToken, devOnly, DEVELOPER_EMAIL } = require('../middleware/verifyToken');
const { db } = require('../firebase');

// GET /api/user/profile
// Returns the user's profile from Firestore
router.get('/profile', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;
    const doc = await db.collection('users').doc(uid).get();

    if (!doc.exists) {
      return res.json({ profile: null });
    }

    res.json({ profile: doc.data() });
  } catch (e) {
    console.error('Profile fetch error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/user/profile
// Creates or updates the user's profile in Firestore
router.post('/profile', verifyToken, async (req, res) => {
  try {
    const { uid, email } = req.user;
    const { name, address, shopName, shopBio, shopUrl } = req.body;

    const data = {
      uid,
      email,
      updatedAt: new Date().toISOString()
    };

    if (name) data.name = name;
    if (address) data.address = address;
    if (shopName) data.shopName = shopName;
    if (shopBio) data.shopBio = shopBio;
    if (shopUrl) data.shopUrl = shopUrl;

    await db.collection('users').doc(uid).set(data, { merge: true });

    // Invalidate shop prefix cache since user data changed
    try {
      const { invalidatePrefixCache } = require('./shop');
      invalidatePrefixCache();
    } catch (e) { /* shop cache invalidation is non-critical */ }

    res.json({ success: true });
  } catch (e) {
    console.error('Profile update error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/user/set-pro
// Sets a user as Pro — will be called by Stripe webhook later
// For now only the developer can call this
router.post('/set-pro', verifyToken, devOnly, async (req, res) => {
  try {
    const { targetUid, isPro } = req.body;
    if (!targetUid) return res.status(400).json({ error: 'targetUid required' });

    await db.collection('users').doc(targetUid).set({ isPro: !!isPro }, { merge: true });
    res.json({ success: true, uid: targetUid, isPro: !!isPro });
  } catch (e) {
    console.error('Set pro error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
