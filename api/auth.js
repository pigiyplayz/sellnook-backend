const express          = require('express');
const router           = express.Router();
const { verifyToken }  = require('../middleware/verifyToken');
const { db }           = require('../firebase');

// ── Key dates ──────────────────────────────────────────────
const LAUNCH_DATE       = new Date('2026-07-21T17:00:00');
const EARLY_ACCESS_DATE = new Date('2026-07-07T00:00:00');
const DEVELOPER_EMAIL   = 'austinmalick9@gmail.com';
// ───────────────────────────────────────────────────────────

// POST /api/auth/access
// Returns the access level for the currently logged-in user.
// Frontend calls this on every page load to decide what to show.
router.post('/access', verifyToken, async (req, res) => {
  try {
    const { email, uid } = req.user;
    const now            = new Date();

    const isDev         = email === DEVELOPER_EMAIL;
    const isLaunched    = now >= LAUNCH_DATE;
    const isEarlyAccess = now >= EARLY_ACCESS_DATE;

    // Check pro status from Firestore
    let isPro = false;
    try {
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) {
        isPro = userDoc.data().isPro === true;
      }
    } catch (e) {
      // Firestore read failed — fail safe
    }

    // Developer gets everything
    if (isDev) {
      return res.json({
        access:         'developer',
        isDev:          true,
        isPro:          true,
        isLaunched:     true,
        earlyAccess:    true,
        dashboardOpen:  true,
        message:        'Developer access — all features unlocked'
      });
    }

    // After launch
    if (isLaunched) {
      return res.json({
        access:         'launched',
        isDev:          false,
        isPro,
        isLaunched:     true,
        earlyAccess:    true,
        dashboardOpen:  true,
        message:        'Sellnook is live!'
      });
    }

    // Early access window (July 7–21)
    if (isEarlyAccess) {
      return res.json({
        access:         'early',
        isDev:          false,
        isPro,
        isLaunched:     false,
        earlyAccess:    true,
        dashboardOpen:  true,
        message:        'Early access is open'
      });
    }

    // Before early access — dashboard open, everything else locked
    return res.json({
      access:         'coming_soon',
      isDev:          false,
      isPro:          false,
      isLaunched:     false,
      earlyAccess:    false,
      dashboardOpen:  true,   // ← dashboard open to all logged in users now
      message:        'Coming soon — early access opens July 7, 2026'
    });

  } catch (e) {
    console.error('Access check error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/auth/ping — keep-alive endpoint ───────────────
router.get('/ping', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

module.exports = router;
