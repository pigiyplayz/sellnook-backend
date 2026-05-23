const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { db } = require('../firebase');

// ── POST /api/reviews/submit ───────────────────────────────
router.post('/submit', verifyToken, async (req, res) => {
  const { orderId, listingId, sellerId, rating, title, body } = req.body;

  if (!orderId || !listingId || !sellerId || !rating) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be 1–5' });
  }

  try {
    const { uid, email } = req.user;
    // Verify order exists and belongs to buyer and is delivered
    const orderDoc = await db.collection('orders').doc(orderId).get();
    if (!orderDoc.exists) return res.status(404).json({ error: 'Order not found' });
    const order = orderDoc.data();
    if (order.buyerId !== uid) return res.status(403).json({ error: 'Not authorized' });
    if (order.status !== 'delivered') return res.status(400).json({ error: 'Can only review delivered orders' });

    // Check no existing review for this order
    const existing = await db.collection('reviews')
      .where('orderId', '==', orderId)
      .where('buyerId', '==', uid)
      .get();
    if (!existing.empty) return res.status(400).json({ error: 'You already reviewed this order' });

    const now = new Date().toISOString();
    const review = {
      orderId,
      listingId,
      sellerId,
      buyerId: uid,
      buyerEmail: email,
      buyerName: order.buyerName || '',
      listingTitle: order.itemTitle || '',
      listingImage: order.itemImage || null,
      rating: parseInt(rating),
      title: title?.trim() || '',
      body: body?.trim() || '',
      createdAt: now,
      helpful: 0,
      verified: true // verified purchase
    };

    const ref = await db.collection('reviews').add(review);

    // Update listing average rating using transaction for atomicity
    await db.runTransaction(async (t) => {
      const listingDoc = await t.get(db.collection('listings').doc(listingId));
      const current = listingDoc.exists ? listingDoc.data() : {};
      const oldCount = current.reviewCount || 0;
      const oldAvg = current.avgRating || 0;
      const newCount = oldCount + 1;
      const newAvg = ((oldAvg * oldCount) + parseInt(rating)) / newCount;

      t.update(db.collection('listings').doc(listingId), {
        avgRating: parseFloat(newAvg.toFixed(1)),
        reviewCount: newCount
      });
    });

    // Update seller's overall rating using transaction
    await db.runTransaction(async (t) => {
      const sellerDoc = await t.get(db.collection('users').doc(sellerId));
      const current = sellerDoc.exists ? sellerDoc.data() : {};
      const oldCount = current.reviewCount || 0;
      const oldAvg = current.rating || 0;
      const newCount = oldCount + 1;
      const newAvg = ((oldAvg * oldCount) + parseInt(rating)) / newCount;

      t.update(db.collection('users').doc(sellerId), {
        rating: parseFloat(newAvg.toFixed(1)),
        reviewCount: newCount
      });
    });

    // Mark order as reviewed
    await db.collection('orders').doc(orderId).update({ reviewed: true });

    // Notify seller
    try {
      const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || 'https://sellnook-backend.onrender.com';
      await fetch(`${BACKEND_URL}/api/email/review-received`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerEmail: order.sellerEmail,
          sellerName: order.sellerName,
          listingTitle: order.itemTitle,
          rating,
          reviewTitle: title || '',
          reviewBody: body || ''
        })
      });
    } catch (e) { console.error('Review email error:', e); }

    res.json({ success: true, reviewId: ref.id });

  } catch (e) {
    console.error('Submit review error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/reviews/listing/:id ───────────────────────────
router.get('/listing/:id', async (req, res) => {
  try {
    const snap = await db.collection('reviews')
      .where('listingId', '==', req.params.id)
      .get();
    const reviews = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ reviews });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/reviews/seller/:id ────────────────────────────
router.get('/seller/:id', async (req, res) => {
  try {
    const snap = await db.collection('reviews')
      .where('sellerId', '==', req.params.id)
      .get();
    const reviews = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ reviews });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
