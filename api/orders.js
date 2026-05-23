const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { db } = require('../firebase');

// ── GET /api/orders/buyer — get all orders for buyer ───────
router.get('/buyer', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;
    const snap = await db.collection('orders')
      .where('buyerId', '==', uid)
      .get();
    const orders = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ orders });
  } catch (e) {
    console.error('Get buyer orders error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/orders/seller — get all orders for seller ─────
router.get('/seller', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;
    const snap = await db.collection('orders')
      .where('sellerId', '==', uid)
      .get();
    const orders = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ orders });
  } catch (e) {
    console.error('Get seller orders error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/orders/:id — get single order ─────────────────
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;
    const doc = await db.collection('orders').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Order not found' });

    const order = { id: doc.id, ...doc.data() };

    if (order.buyerId !== uid && order.sellerId !== uid) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    res.json({ order });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/orders/:id/ship — seller marks as shipped ────
router.post('/:id/ship', verifyToken, async (req, res) => {
  const { carrier, trackingNumber, estimatedDelivery } = req.body;
  if (!trackingNumber) return res.status(400).json({ error: 'Tracking number required' });

  try {
    const { uid } = req.user;
    const doc = await db.collection('orders').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Order not found' });

    const order = doc.data();
    if (order.sellerId !== uid) return res.status(403).json({ error: 'Not authorized' });
    if (order.status !== 'processing') return res.status(400).json({ error: 'Order cannot be marked as shipped in its current state' });

    const now = new Date().toISOString();

    await db.collection('orders').doc(req.params.id).update({
      status: 'shipped',
      carrier: carrier || 'Other',
      trackingNumber,
      estimatedDelivery: estimatedDelivery || null,
      shippedAt: now,
      updatedAt: now,
      timeline: [...(order.timeline || []), {
        status: 'shipped',
        timestamp: now,
        note: `Shipped via ${carrier || 'carrier'} — Tracking: ${trackingNumber}`
      }]
    });

    try {
      const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || 'https://sellnook-backend.onrender.com';
      await fetch(`${BACKEND_URL}/api/email/shipping-confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: order.buyerEmail,
          name: order.buyerName,
          orderId: req.params.id,
          itemTitle: order.itemTitle,
          trackingNumber,
          carrier: carrier || 'Other',
          estimatedDelivery: estimatedDelivery || 'See carrier website'
        })
      });
      // In-app notification for buyer
      const { addNotification } = require('../firebase');
      await addNotification(order.buyerId, {
        type: 'shipping',
        title: 'Order Shipped! 📦',
        body: `Your order #${req.params.id.slice(-6)} for "${order.itemTitle}" has been shipped.`,
        url: '/dashboard.html'
      });
    } catch (e) { console.error('Ship notification error:', e); }

    res.json({ success: true });
  } catch (e) {
    console.error('Ship order error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/orders/:id/deliver — mark as delivered ───────
router.post('/:id/deliver', verifyToken, async (req, res) => {
  try {
    const { uid } = req.user;
    const doc = await db.collection('orders').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Order not found' });

    const order = doc.data();
    if (order.buyerId !== uid && order.sellerId !== uid) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const now = new Date().toISOString();

    await db.collection('orders').doc(req.params.id).update({
      status: 'delivered',
      deliveredAt: now,
      updatedAt: now,
      timeline: [...(order.timeline || []), {
        status: 'delivered',
        timestamp: now,
        note: 'Order marked as delivered'
      }]
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/orders/:id/cancel — cancel order ─────────────
router.post('/:id/cancel', verifyToken, async (req, res) => {
  const { reason } = req.body;

  try {
    const { uid } = req.user;
    const doc = await db.collection('orders').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Order not found' });

    const order = doc.data();
    if (order.buyerId !== uid && order.sellerId !== uid) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (order.status === 'shipped' || order.status === 'delivered') {
      return res.status(400).json({ error: 'Cannot cancel an order that has already shipped' });
    }

    const now = new Date().toISOString();
    const cancelledBy = order.buyerId === uid ? 'buyer' : 'seller';

    await db.collection('orders').doc(req.params.id).update({
      status: 'cancelled',
      cancelledBy,
      cancelReason: reason || 'No reason given',
      cancelledAt: now,
      updatedAt: now,
      timeline: [...(order.timeline || []), {
        status: 'cancelled',
        timestamp: now,
        note: `Cancelled by ${cancelledBy}${reason ? ': ' + reason : ''}`
      }]
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/orders/:id/dispute — open a dispute ──────────
router.post('/:id/dispute', verifyToken, async (req, res) => {
  const { reason, details } = req.body;
  if (!reason) return res.status(400).json({ error: 'Reason required' });

  try {
    const { uid } = req.user;
    const doc = await db.collection('orders').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Order not found' });

    const order = doc.data();
    if (order.buyerId !== uid) return res.status(403).json({ error: 'Only the buyer can open a dispute' });

    const now = new Date().toISOString();

    await db.collection('orders').doc(req.params.id).update({
      status: 'disputed',
      disputeReason: reason,
      disputeDetails: details || '',
      disputeOpenedAt: now,
      updatedAt: now,
      timeline: [...(order.timeline || []), {
        status: 'disputed',
        timestamp: now,
        note: `Dispute opened: ${reason}`
      }]
    });

    try {
      const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || 'https://sellnook-backend.onrender.com';
      await fetch(`${BACKEND_URL}/api/email/dispute-opened`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: order.sellerEmail,
          name: order.sellerName,
          orderId: req.params.id,
          role: 'seller',
          reason
        })
      });
      await fetch(`${BACKEND_URL}/api/email/dispute-opened`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: order.buyerEmail,
          name: order.buyerName,
          orderId: req.params.id,
          role: 'buyer',
          reason
        })
      });
    } catch (e) { console.error('Dispute email error:', e); }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/orders/create ────────────────────────────────
// Requires seller to have a connected Stripe account before
// an order can be placed against their listing.
router.post('/create', verifyToken, async (req, res) => {
  const { listingId, quantity, shippingAddress, paymentMethod } = req.body;
  if (!listingId || !shippingAddress) return res.status(400).json({ error: 'Missing required fields' });

  try {
    const { uid, email } = req.user;
    // Get listing
    const listingDoc = await db.collection('listings').doc(listingId).get();
    if (!listingDoc.exists) return res.status(404).json({ error: 'Listing not found' });
    const listing = listingDoc.data();

    // ── Stripe Connect check ───────────────────────────────
    // Block order if seller hasn't connected their payout account.
    // Dev account bypasses this check.
    const DEV_SELLER_UID = 'FwwRLdVU17PbeRHgRtXTAJOB41c2';
    if (listing.sellerId !== DEV_SELLER_UID) {
      const sellerDoc = await db.collection('users').doc(listing.sellerId).get();
      const sellerData = sellerDoc.exists ? sellerDoc.data() : {};
      if (!sellerData.stripeConnected) {
        return res.status(400).json({
          error: 'seller_not_connected',
          message: 'This seller hasn\'t set up their payout account yet. Orders are currently unavailable from this shop.'
        });
      }
    }
    // ──────────────────────────────────────────────────────

    const qty = parseInt(quantity) || 1;
    const total = (listing.price * qty).toFixed(2);
    const feeRate = listing.isPro ? 0.04 : 0.08;
    const fee = (listing.price * qty * feeRate).toFixed(2);
    const sellerPayout = (parseFloat(total) - parseFloat(fee)).toFixed(2);

    const now = new Date().toISOString();
    const order = {
      listingId,
      itemTitle: listing.title || '',
      itemPrice: listing.price || 0,
      itemImage: listing.images?.[0] || null,
      itemCategory: listing.category || '',
      quantity: qty,
      total: parseFloat(total),
      fee: parseFloat(fee),
      sellerPayout: parseFloat(sellerPayout),
      buyerId: uid,
      buyerEmail: email || '',
      buyerName: req.body.buyerName || '',
      sellerId: listing.sellerId || '',
      sellerEmail: listing.sellerEmail || '',
      sellerName: listing.sellerName || '',
      shopName: listing.shopName || '',
      shippingAddress,
      shippingMethod: req.body.shippingMethod || 'standard',
      shippingCost: req.body.shippingCost || 0,
      paymentMethod: paymentMethod || 'stripe',
      paymentStatus: 'pending',
      promoCode: req.body.promoCode || null,
      discount: req.body.discount || 0,
      status: 'processing',
      createdAt: now,
      updatedAt: now,
      timeline: [
        { status: 'placed', timestamp: now, note: 'Order placed by buyer' },
        { status: 'processing', timestamp: now, note: 'Waiting for seller to ship' }
      ]
    };

    const ref = await db.collection('orders').add(order);

    // Send emails
    try {
      const BACKEND_URL = process.env.RENDER_EXTERNAL_URL || 'https://sellnook-backend.onrender.com';
      await fetch(`${BACKEND_URL}/api/email/order-confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          name: req.body.buyerName,
          orderId: ref.id,
          total,
          address: `${shippingAddress.street}, ${shippingAddress.city}, ${shippingAddress.state}`
        })
      });
      await fetch(`${BACKEND_URL}/api/email/order-notify-seller`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellerEmail: listing.sellerEmail,
          shopName: listing.shopName,
          orderId: ref.id,
          itemTitle: listing.title,
          quantity: qty,
          total: sellerPayout,
          buyerName: req.body.buyerName,
          shippingAddress: `${shippingAddress.street}, ${shippingAddress.city}, ${shippingAddress.state}`
        })
      });
    } catch (e) { console.error('Order email error:', e); }

    // In-app notification for seller
    try {
      const { addNotification } = require('../firebase');
      await addNotification(listing.sellerId, {
        type: 'sale',
        title: 'New Order Received! 💰',
        body: `You just sold "${listing.title}" for $${total}.`,
        url: '/seller-dashboard.html'
      });
    } catch (e) { console.error('Sale notification error:', e); }

    res.json({ success: true, orderId: ref.id });
  } catch (e) {
    console.error('Create order error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
