const express = require('express');
const router = express.Router();
const { verifyToken, devOnly } = require('../middleware/verifyToken');
const { db, auth: firebaseAuth } = require('../firebase');

// ── Stripe init (lazy — only fails at runtime if key missing) ──
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set');
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// ── POST /api/stripe/connect/create ───────────────────────
// Creates a Stripe Connect account for the seller and returns
// a hosted onboarding URL. Safe to call multiple times —
// reuses existing account if already created.
router.post('/connect/create', verifyToken, async (req, res) => {
  try {
    const stripe = getStripe();
    const { uid, email } = req.user;

    // Check if seller already has a Stripe account
    const userDoc = await db.collection('users').doc(uid).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    let accountId = userData.stripeAccountId;

    // Create new Express account if needed
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true }
        },
        business_type: 'individual',
        metadata: { sellnook_uid: uid }
      });
      accountId = account.id;

      // Save to Firestore
      await db.collection('users').doc(uid).set(
        { stripeAccountId: accountId, stripeConnected: false },
        { merge: true }
      );
    }

    // Generate onboarding link
    const origin = req.headers.origin || 'https://sellnook.com';
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${origin}/seller-dashboard.html?stripe=refresh`,
      return_url: `${origin}/seller-dashboard.html?stripe=success`,
      type: 'account_onboarding'
    });

    res.json({ url: accountLink.url });
  } catch (e) {
    console.error('Stripe connect create error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/stripe/connect/status ────────────────────────
// Returns whether the seller's Connect account is fully set up.
router.get('/connect/status', verifyToken, async (req, res) => {
  try {
    const stripe = getStripe();
    const { uid } = req.user;
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists) return res.json({ connected: false });

    const { stripeAccountId } = userDoc.data();
    if (!stripeAccountId) return res.json({ connected: false });

    const account = await stripe.accounts.retrieve(stripeAccountId);
    const connected = !!(
      account.charges_enabled &&
      account.payouts_enabled &&
      account.details_submitted
    );

    // Sync status to Firestore
    if (connected !== userDoc.data().stripeConnected) {
      await db.collection('users').doc(uid).set(
        { stripeConnected: connected },
        { merge: true }
      );
    }

    res.json({
      connected,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted
    });
  } catch (e) {
    console.error('Stripe connect status error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/stripe/create-payment-intent ────────────────
// Creates a PaymentIntent that automatically splits payment:
// seller receives their cut, platform fee lands in your account.
router.post('/create-payment-intent', verifyToken, async (req, res) => {
  const { listingId, quantity, shippingCost } = req.body;
  if (!listingId) return res.status(400).json({ error: 'listingId required' });

  try {
    const stripe = getStripe();
    const { uid } = req.user;

    // Get listing
    const listingDoc = await db.collection('listings').doc(listingId).get();
    if (!listingDoc.exists) return res.status(404).json({ error: 'Listing not found' });
    const listing = listingDoc.data();

    const qty = parseInt(quantity) || 1;
    const subtotal = listing.price * qty;
    const shipping = parseFloat(shippingCost) || 0;
    const totalFloat = subtotal + shipping;
    const totalCents = Math.round(totalFloat * 100);

    // Platform fee: 8% free, 4% pro
    const feeRate = listing.isPro ? 0.04 : 0.08;
    const feeCents = Math.round(subtotal * feeRate * 100); // fee on item only, not shipping

    // Get seller's Stripe account
    const sellerDoc = await db.collection('users').doc(listing.sellerId).get();
    if (!sellerDoc.exists) return res.status(400).json({ error: 'Seller not found' });

    const { stripeAccountId, stripeConnected } = sellerDoc.data();
    if (!stripeAccountId || !stripeConnected) {
      return res.status(400).json({
        error: 'Seller has not connected their payout account yet. Please try another listing or check back later.'
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: 'usd',
      application_fee_amount: feeCents,
      transfer_data: {
        destination: stripeAccountId
      },
      metadata: {
        listingId,
        buyerId: uid,
        sellerId: listing.sellerId,
        quantity: qty
      }
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      total: totalFloat,
      fee: feeCents / 100,
      sellerPayout: (totalCents - feeCents) / 100
    });
  } catch (e) {
    console.error('Create payment intent error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/stripe/webhook ───────────────────────────────
// Handles Stripe events. Add STRIPE_WEBHOOK_SECRET to Render env vars.
// Webhook URL to register in Stripe dashboard:
// https://sellnook-backend.onrender.com/api/stripe/webhook
// NOTE: This route uses the raw body parser set up in server.js.
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.warn('STRIPE_WEBHOOK_SECRET not set — skipping signature verification');
    return res.json({ received: true });
  }

  let event;
  try {
    const stripe = getStripe();
    // req.body is the raw Buffer set by the express.raw middleware in server.js
    event = stripe.webhooks.constructEvent(req.body, sig, secret);
  } catch (e) {
    console.error('Webhook signature error:', e.message);
    return res.status(400).json({ error: `Webhook error: ${e.message}` });
  }

  try {
    switch (event.type) {

    // Payment confirmed — mark order as paid
    case 'payment_intent.succeeded': {
      const pi = event.data.object;
      const { listingId, buyerId, sellerId, quantity } = pi.metadata;

      // Find the order by listingId + buyerId + status pending
      const snap = await db.collection('orders')
        .where('listingId', '==', listingId)
        .where('buyerId', '==', buyerId)
        .where('paymentStatus', '==', 'pending')
        .limit(1)
        .get();

      if (!snap.empty) {
        const now = new Date().toISOString();
        await snap.docs[0].ref.update({
          paymentStatus: 'paid',
          paymentIntentId: pi.id,
          paidAt: now,
          updatedAt: now,
          timeline: [
            ...(snap.docs[0].data().timeline || []),
            { status: 'paid', timestamp: now, note: 'Payment confirmed by Stripe' }
          ]
        });
      }
      break;
    }

    // Seller finished Connect onboarding
    case 'account.updated': {
      const account = event.data.object;
      const sellnookUid = account.metadata?.sellnook_uid;
      if (!sellnookUid) break;

      const connected = !!(
        account.charges_enabled &&
        account.payouts_enabled &&
        account.details_submitted
      );

      await db.collection('users').doc(sellnookUid).set(
        { stripeConnected: connected },
        { merge: true }
      );
      console.log(`Seller ${sellnookUid} Stripe connected: ${connected}`);
      break;
    }

    // Payment failed — flag the order
    case 'payment_intent.payment_failed': {
      const pi = event.data.object;
      const snap = await db.collection('orders')
        .where('paymentIntentId', '==', pi.id)
        .limit(1)
        .get();
      if (!snap.empty) {
        await snap.docs[0].ref.update({
          paymentStatus: 'failed',
          updatedAt: new Date().toISOString()
        });
      }
      break;
    }

    default:
      // Ignore unhandled events
      break;
    }
  } catch (e) {
    console.error('Webhook handler error:', e);
    // Still return 200 so Stripe doesn't retry
  }

  res.json({ received: true });
});

module.exports = router;
