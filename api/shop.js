const express = require('express');
const router = express.Router();
const { db } = require('../firebase');

// ── In-memory cache for free-seller UID prefix → doc ID mapping ──
// Rebuilt on-demand, expires after 10 minutes to stay fresh.
let prefixCache = null;
let prefixCacheExpiry = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

async function getPrefixCache() {
  const now = Date.now();
  if (prefixCache && now < prefixCacheExpiry) return prefixCache;

  const allUsers = await db.collection('users').get();
  const cache = new Map();
  allUsers.docs.forEach(d => {
    const prefix = d.id.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
    cache.set(prefix, d);
  });

  prefixCache = cache;
  prefixCacheExpiry = now + CACHE_TTL_MS;
  return cache;
}

// Invalidates the cache when a new user signs up or updates shopUrl
function invalidatePrefixCache() {
  prefixCache = null;
  prefixCacheExpiry = 0;
}

// ── GET /api/shop/:identifier ──────────────────────────────
// Resolves a shop URL (custom or numeric) to seller profile + listings
// Pro sellers: /api/shop/janesc
// Free sellers: /api/shop/a7f3k9b2
router.get('/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;

    // First try matching shopUrl (Pro sellers) — indexed query
    let userSnap = await db.collection('users')
      .where('shopUrl', '==', identifier)
      .limit(1)
      .get();

    // If not found by shopUrl, try matching by UID prefix (free sellers)
    if (userSnap.empty) {
      const cache = await getPrefixCache();
      const match = cache.get(identifier) || null;
      if (match) {
        userSnap = { empty: false, docs: [match] };
      }
    }

    // If still not found
    if (userSnap.empty) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    const userDoc = userSnap.docs[0];
    const userData = userDoc.data();
    const sellerId = userDoc.id;

    // Get seller's active listings
    const listingsSnap = await db.collection('listings')
      .where('sellerId', '==', sellerId)
      .where('status', '==', 'active')
      .orderBy('createdAt', 'desc')
      .get();

    const listings = listingsSnap.docs.map(d => {
      const l = d.data();
      return {
        id: d.id,
        title: l.title,
        price: l.price,
        category: l.category,
        condition: l.condition,
        images: l.images || [],
        shopIdentifier: l.shopIdentifier,
        itemIdentifier: l.itemIdentifier,
        visibleAt: l.visibleAt,
        createdAt: l.createdAt
      };
    });

    // Build shop profile
    const shop = {
      sellerId,
      shopName: userData.shopName || userData.displayName || 'Seller',
      shopUrl: userData.shopUrl || identifier,
      shopBio: userData.shopBio || '',
      shopCity: userData.shopCity || '',
      shopState: userData.shopState || '',
      shopZip: userData.shopZip || '',
      shopCarrier: userData.shopCarrier || '',
      sellerPhoto: userData.photoURL || userData.sellerPhoto || '',
      bannerColor: userData.bannerColor || '#1a1a1a',
      isPro: userData.isPro || false,
      identifier,
      totalListings: listings.length,
      totalSales: userData.totalSales || 0,
      rating: userData.rating || null,
      memberSince: userData.createdAt || null,
    layout: userData.layout || { order: ['banner', 'stats', 'categories', 'featured'], theme: 'modern' }
    };

    res.json({ shop, listings });

  } catch (e) {
    console.error('Shop route error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.invalidatePrefixCache = invalidatePrefixCache;
