const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { db } = require('../firebase');

// ── POST /api/offers/make — buyer makes an offer ───────────
router.post('/make', verifyToken, async (req, res) => {
  const { listingId, offerAmount, message } = req.body;
  if (!listingId || !offerAmount) return res.status(400).json({ error: 'Missing fields' });

  try {
    const { uid, email } = req.user;
    const listingDoc = await db.collection('listings').doc(listingId).get();
    if (!listingDoc.exists) return res.status(404).json({ error: 'Listing not found' });

    const listing = listingDoc.data();
    const offerAmt = parseFloat(offerAmount);
    const listPrice = parseFloat(listing.price);

    if (offerAmt <= 0) return res.status(400).json({ error: 'Offer must be greater than $0' });
    if (offerAmt >= listPrice) return res.status(400).json({ error: 'Offer must be less than the listing price' });

    const now = new Date().toISOString();

    // Check auto-accept threshold — always boolean
    const autoAccept = !!(listing.autoAcceptPrice && offerAmt >= parseFloat(listing.autoAcceptPrice));

    const offer = {
      listingId,
      listingTitle: listing.title || '',
      listingPrice: listPrice,
      listingImage: listing.images?.[0] || null,
      buyerId: uid,
      buyerEmail: email || '',
      sellerId: listing.sellerId || '',
      sellerEmail: listing.sellerEmail || '',
      sellerName: listing.sellerName || '',
      shopName: listing.shopName || '',
      offerAmount: offerAmt,
      message: message || '',
      status: autoAccept ? 'accepted' : 'pending',
      autoAccepted: autoAccept,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
    };

    const ref = await db.collection('offers').add(offer);

    // Notify seller via email
    try {
      const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || 'https://sellnook-backend.onrender.com';
      await fetch(`${BACKEND_URL}/api/email/offer-received`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerEmail: listing.sellerEmail,
          sellerName: listing.sellerName,
          listingTitle: listing.title,
          offerAmount: offerAmt,
          listPrice,
          offerId: ref.id,
          autoAccepted
        })
      });
    } catch (e) { console.error('Offer email error:', e); }

    // In-app notification for seller
    try {
      const { addNotification } = require('../firebase');
      await addNotification(listing.sellerId, {
        type: 'offer',
        title: autoAccept ? 'Offer Auto-Accepted! ✅' : 'New Offer Received! 💰',
        body: `Someone made a $${offerAmt.toFixed(2)} offer on "${listing.title}".`,
        url: '/seller-dashboard.html'
      });
    } catch (e) { console.error('Offer notification error:', e); }

    res.json({ success: true, offerId: ref.id, autoAccepted, status: offer.status });

  } catch (e) {
    console.error('Make offer error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/offers/:id/respond — seller responds ─────────
router.post('/:id/respond', verifyToken, async (req, res) => {
  const { action, counterAmount, message } = req.body;
  if (!['accept', 'decline', 'counter'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  try {
    const { uid } = req.user;
    const offerDoc = await db.collection('offers').doc(req.params.id).get();
    if (!offerDoc.exists) return res.status(404).json({ error: 'Offer not found' });

    const offer = offerDoc.data();
    if (offer.sellerId !== uid) return res.status(403).json({ error: 'Not authorized' });
    if (offer.status !== 'pending') return res.status(400).json({ error: 'Offer is no longer pending' });

    const now = new Date().toISOString();
    let updates = { status: action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'countered', updatedAt: now };
    if (action === 'counter') {
      if (!counterAmount) return res.status(400).json({ error: 'Counter amount required' });
      updates.counterAmount = parseFloat(counterAmount);
      updates.counterMessage = message || '';
    }

    await db.collection('offers').doc(req.params.id).update(updates);

    // Notify buyer
    try {
      const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || 'https://sellnook-backend.onrender.com';
      await fetch(`${BACKEND_URL}/api/email/offer-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          buyerEmail: offer.buyerEmail,
          listingTitle: offer.listingTitle,
          offerAmount: offer.offerAmount,
          action,
          counterAmount: updates.counterAmount || null,
          offerId: req.params.id
        })
      });
    } catch (e) { console.error('Offer update email error:', e); }

    // In-app notification for buyer
    try {
      const { addNotification } = require('../firebase');
      const actionText = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'countered';
      await addNotification(offer.buyerId, {
        type: 'offer',
        title: `Offer ${actionText}! 💰`,
        body: `Your offer of $${offer.offerAmount.toFixed(2)} on "${offer.listingTitle}" was ${actionText}.`,
        url: '/dashboard.html'
      });
    } catch (e) { console.error('Offer status notification error:', e); }

    res.json({ success: true });

  } catch (e) {
    console.error('Respond offer error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/offers/:id/counter-accept — buyer accepts counter
router.post('/:id/counter-accept', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;
    const offerDoc = await db.collection('offers').doc(req.params.id).get();
    if (!offerDoc.exists) return res.status(404).json({ error: 'Offer not found' });
    const offer = offerDoc.data();
    if (offer.buyerId !== uid) return res.status(403).json({ error: 'Not authorized' });

    await db.collection('offers').doc(req.params.id).update({
      status: 'accepted',
      finalAmount: offer.counterAmount,
      updatedAt: new Date().toISOString()
    });

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/offers/buyer — get buyer's offers ─────────────
router.get('/buyer', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;
    const snap = await db.collection('offers')
      .where('buyerId', '==', uid)
      .orderBy('createdAt', 'desc')
      .get();
    res.json({ offers: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── GET /api/offers/seller — get seller's offers ───────────
router.get('/seller', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;
    const snap = await db.collection('offers')
      .where('sellerId', '==', uid)
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .get();
    res.json({ offers: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
