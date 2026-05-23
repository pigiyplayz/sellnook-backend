const express = require('express');
const router  = express.Router();

// ── Weight-based flat rate zones ───────────────────────────
// Based on USPS Priority Mail approximations
const WEIGHT_ZONES = [
  { maxLbs: 0.5,  standard: 4.50,  express: 9.99,  overnight: 24.99 },
  { maxLbs: 1,    standard: 5.50,  express: 11.99, overnight: 27.99 },
  { maxLbs: 2,    standard: 7.50,  express: 14.99, overnight: 32.99 },
  { maxLbs: 5,    standard: 10.99, express: 19.99, overnight: 42.99 },
  { maxLbs: 10,   standard: 14.99, express: 26.99, overnight: 54.99 },
  { maxLbs: 20,   standard: 19.99, express: 36.99, overnight: 72.99 },
  { maxLbs: 70,   standard: 28.99, express: 54.99, overnight: 99.99 },
];

// ── POST /api/shipping/calculate ───────────────────────────
router.post('/calculate', async (req, res) => {
  try {
    const {
      weightLbs,
      sellerShippingPrice, // seller's custom price (optional)
      freeShipping,        // boolean
      sellerCarrier,       // USPS, UPS, FedEx, Other
      toZip,
      fromZip
    } = req.body;

    // Free shipping — return zeros
    if (freeShipping) {
      return res.json({
        options: [
          { method: 'standard',  label: 'Free Standard Shipping',  price: 0,     eta: '5–7 business days' },
          { method: 'express',   label: 'Express Shipping',         price: 12.99, eta: '2–3 business days' },
          { method: 'overnight', label: 'Overnight Shipping',       price: 24.99, eta: 'Next business day'  }
        ],
        source: 'free_shipping'
      });
    }

    // Seller custom price — use that as standard, add express/overnight on top
    if (sellerShippingPrice && parseFloat(sellerShippingPrice) > 0) {
      const base = parseFloat(sellerShippingPrice);
      return res.json({
        options: [
          { method: 'standard',  label: `Standard (${sellerCarrier || 'Seller ships'})`, price: base,              eta: '5–7 business days' },
          { method: 'express',   label: 'Express Upgrade',                                price: base + 8.00,        eta: '2–3 business days' },
          { method: 'overnight', label: 'Overnight Upgrade',                              price: base + 20.00,       eta: 'Next business day'  }
        ],
        source: 'seller_price'
      });
    }

    // Weight-based flat rate
    const weight = parseFloat(weightLbs) || 1;
    const zone   = WEIGHT_ZONES.find(z => weight <= z.maxLbs) || WEIGHT_ZONES[WEIGHT_ZONES.length - 1];

    // Try USPS rate API if credentials available
    // For now use weight zones as fallback
    const options = [
      { method: 'standard',  label: `Standard Shipping (${sellerCarrier || 'USPS'})`, price: zone.standard, eta: '5–7 business days' },
      { method: 'express',   label: `Express Shipping (${sellerCarrier || 'USPS'})`,  price: zone.express,  eta: '2–3 business days' },
      { method: 'overnight', label: `Overnight Shipping`,                               price: zone.overnight,eta: 'Next business day'  }
    ];

    res.json({ options, source: 'weight_zones', weight, zone: `${zone.maxLbs}lb zone` });

  } catch (e) {
    console.error('Shipping calc error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
