const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { db, auth } = require('../firebase');

const PRO_FREE_SLOTS = 10;
const CPC_RATE = 0.25; // $0.25 per click for paid promoted

// ── POST /api/promoted/promote — promote a listing ─────────
router.post('/promote', verifyToken, async (req, res) => {
  const { listingId } = req.body;
  if (!listingId) return res.status(400).json({ error: 'Listing ID required' });

  try {
    const { uid, email } = req.user;
    // Get user profile to check Pro status
    const userDoc = await db.collection('users').doc(uid).get();
    const isPro = userDoc.exists && userDoc.data().isPro;

    // Count current promoted listings
    const currentSnap = await db.collection('promoted')
      .where('sellerId', '==', uid)
      .where('active', '==', true)
      .get();
    const currentCount = currentSnap.docs.length;

    // Check if already promoted
    const existing = currentSnap.docs.find(d => d.data().listingId === listingId);
    if (existing) return res.status(400).json({ error: 'Listing is already promoted' });

    // Determine if free slot or paid
    const isFreeSlot = isPro && currentCount < PRO_FREE_SLOTS;

    const now = new Date().toISOString();
    const promoted = {
      listingId,
      sellerId: uid,
      sellerEmail: email,
      isPro,
      isFreeSlot,
      cpcRate: isFreeSlot ? 0 : CPC_RATE,
      clicks: 0,
      spend: 0,
      active: true,
      startedAt: now,
      updatedAt: now
    };

    const ref = await db.collection('promoted').add(promoted);

    // Mark listing as promoted
    await db.collection('listings').doc(listingId).update({
      promoted: true,
      promotedAt: now
    });

    res.json({
      success: true,
      promotedId: ref.id,
      isFreeSlot,
      freeSlots: isPro ? Math.max(0, PRO_FREE_SLOTS - currentCount - 1) : 0,
      cpcRate: isFreeSlot ? 0 : CPC_RATE,
      message: isFreeSlot
        ? `Promoted for free (${PRO_FREE_SLOTS - currentCount - 1} free slots remaining)`
        : `Promoted at $${CPC_RATE}/click`
    });

  } catch (e) {
    console.error('Promote error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/promoted/click — record a click ──────────────
router.post('/click', async (req, res) => {
  const { listingId } = req.body;
  if (!listingId) return res.status(400).json({ error: 'Listing ID required' });

  try {
    const snap = await db.collection('promoted')
      .where('listingId', '==', listingId)
      .where('active', '==', true)
      .limit(1)
      .get();

    if (!snap.empty) {
      const promoDoc = snap.docs[0];
      const promo = promoDoc.data();
      const cpcRate = promo.cpcRate || 0;

      // Use atomic FieldValue.increment for click counting
      const admin = require('firebase-admin');
      await db.collection('promoted').doc(promoDoc.id).update({
        clicks: admin.firestore.FieldValue.increment(1),
        spend: admin.firestore.FieldValue.increment(cpcRate),
        updatedAt: new Date().toISOString()
      });

      // Atomically increment listing views
      await db.collection('listings').doc(listingId).update({
        views: admin.firestore.FieldValue.increment(1)
      });
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/promoted/:id — stop promoting ──────────────
router.delete('/:id', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;
    const doc = await db.collection('promoted').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });
    if (doc.data().sellerId !== uid) return res.status(403).json({ error: 'Not authorized' });

    await db.collection('promoted').doc(req.params.id).update({ active: false });
    await db.collection('listings').doc(doc.data().listingId).update({ promoted: false });

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/promoted/seller — get seller's promoted listings
router.get('/seller', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;
    const snap = await db.collection('promoted')
      .where('sellerId', '==', uid)
      .orderBy('startedAt', 'desc')
      .get();
    res.json({ promoted: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
