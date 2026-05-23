const express = require('express');
const router = express.Router();
const { verifyToken, DEVELOPER_EMAIL } = require('../middleware/verifyToken');
const { db, auth } = require('../firebase');

// ── Helper: slugify a title ────────────────────────────────
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 60);
}

// ── GET /api/product/:itemIdentifier/:shopIdentifier ───────
// Resolves a product URL to listing data
router.get('/:itemIdentifier/:shopIdentifier', async (req, res) => {
  try {
    const { itemIdentifier, shopIdentifier } = req.params;

    // Try to find listing by slug fields
    const snap = await db.collection('listings')
      .where('itemIdentifier', '==', itemIdentifier)
      .where('shopIdentifier', '==', shopIdentifier)
      .where('status', '==', 'active')
      .limit(1)
      .get();

    if (snap.empty) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    const listing = { id: snap.docs[0].id, ...snap.docs[0].data() };

    // Don't expose sensitive seller data
    const safe = {
      id: listing.id,
      title: listing.title,
      price: listing.price,
      category: listing.category,
      condition: listing.condition,
      quantity: listing.quantity,
      description: listing.description,
      images: listing.images || [],
      shopName: listing.shopName,
      sellerName: listing.sellerName,
      sellerPhoto: listing.sellerPhoto,
      sellerRating: listing.sellerRating,
      sellerReviews: listing.sellerReviews,
      sellerSales: listing.sellerSales,
      isPro: listing.isPro,
      weight: listing.weight,
      packageSize: listing.packageSize,
      shipsFrom: listing.shipsFrom,
      processingTime: listing.processingTime,
      shipping: listing.shipping,
      createdAt: listing.createdAt,
      shopIdentifier: listing.shopIdentifier,
      itemIdentifier: listing.itemIdentifier
    };

    res.json({ listing: safe });

  } catch (e) {
    console.error('Product route error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/product/generate-url ────────────────────────
// Called when a seller saves a listing — generates the URL identifiers
// and saves them back to the listing document
router.post('/generate-url', verifyToken, async (req, res) => {
  try {
    const { uid, email } = req.user;
    const { listingId } = req.body;
    if (!listingId) return res.status(400).json({ error: 'Missing listingId' });

    // Get the listing
    const listingDoc = await db.collection('listings').doc(listingId).get();
    if (!listingDoc.exists) return res.status(404).json({ error: 'Listing not found' });

    const listing = listingDoc.data();
    if (listing.sellerId !== uid) return res.status(403).json({ error: 'Not authorized' });

    // Get seller's pro status and shop URL
    const userDoc = await db.collection('users').doc(uid).get();
    const user = userDoc.exists ? userDoc.data() : {};
    const isPro = user.isPro === true || email === DEVELOPER_EMAIL;

    // Generate identifiers
    let shopIdentifier, itemIdentifier;

    if (isPro && user.shopUrl) {
      // Pro seller: use custom shop URL + title slug
      shopIdentifier = user.shopUrl;
      itemIdentifier = slugify(listing.title);

      // Check for duplicate slugs and append number if needed
      const existing = await db.collection('listings')
        .where('shopIdentifier', '==', shopIdentifier)
        .where('itemIdentifier', '==', itemIdentifier)
        .get();

      if (!existing.empty && existing.docs[0].id !== listingId) {
        itemIdentifier = `${itemIdentifier}-${listingId.substring(0, 4)}`;
      }
    } else {
      // Free seller: use numeric ID sequences
      shopIdentifier = uid.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8);
      itemIdentifier = listingId.substring(0, 8);
    }

    // Save back to listing
    await db.collection('listings').doc(listingId).update({
      shopIdentifier,
      itemIdentifier,
      isPro,
      updatedAt: new Date().toISOString()
    });

    res.json({
      success: true,
      url: `/item/${itemIdentifier}/${shopIdentifier}`,
      shopIdentifier,
      itemIdentifier
    });

  } catch (e) {
    console.error('Generate URL error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
