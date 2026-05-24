const express = require('express');
const router  = express.Router();
const { verifyToken } = require('../middleware/verifyToken');

// ── Shared email sender helper ─────────────────────────────
async function sendEmail({ to, subject, html }) {
  const response = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({
      from: 'Sellnook <noreply@sellnook.com>',
      to:   Array.isArray(to) ? to : [to],
      subject,
      html
    })
  });
  const data = await response.json();
  if (!response.ok) {
    console.error('Resend error:', response.status, JSON.stringify(data));
    throw new Error(data.message || 'Failed to send email');
  }
  return data;
}

// ── Shared email wrapper ───────────────────────────────────
function emailWrapper(content) {
  return `
    <div style="font-family:'Inter',sans-serif;max-width:520px;margin:0 auto;padding:40px 24px;background:#fafaf9;">
      <div style="font-size:1.2rem;font-weight:700;color:#1a1a1a;margin-bottom:32px;font-family:'Syne',sans-serif;">
        sell<span style="color:#e8734a;">nook</span>
      </div>
      ${content}
      <div style="margin-top:32px;padding:16px;background:#fff;border:1px solid #e8e8e5;border-radius:8px;font-size:0.78rem;color:#888;line-height:1.6;">
        To ensure you receive order updates and important notifications, please add <strong>noreply@sellnook.com</strong> to your contacts.
      </div>
      <div style="margin-top:24px;padding-top:24px;border-top:1px solid #e8e8e5;font-size:0.75rem;color:#bbb;line-height:1.6;">
        © 2026 Sellnook ·
        <a href="https://sellnook.com/privacy.html" style="color:#bbb;">Privacy Policy</a> ·
        <a href="https://sellnook.com/terms.html" style="color:#bbb;">Terms of Service</a> ·
        <a href="mailto:support@sellnook.com" style="color:#bbb;">Contact Support</a><br>
        You are receiving this email because you have an account at sellnook.com.<br>
        <a href="https://sellnook.com" style="color:#bbb;">Unsubscribe from marketing emails</a>
      </div>
    </div>
  `;
}

function btn(text, url) {
  return `<a href="${url}" style="display:inline-block;padding:12px 24px;background:#1a1a1a;color:#fff;border-radius:8px;font-size:0.875rem;font-weight:600;text-decoration:none;margin-top:20px;">${text}</a>`;
}

function infoBox(rows) {
  return `
    <div style="background:#fff;border:1px solid #e8e8e5;border-radius:12px;padding:20px;margin:20px 0;">
      ${rows.map(([label, value]) => `
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0ee;font-size:0.875rem;">
          <span style="color:#888;">${label}</span>
          <span style="color:#1a1a1a;font-weight:500;">${value}</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ── 1. Waitlist welcome ────────────────────────────────────
router.post('/waitlist', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    await sendEmail({
      to: email,
      subject: "Welcome to the Sellnook waitlist",
      html: emailWrapper(`
        <h1 style="font-family:'Syne',sans-serif;font-size:1.6rem;font-weight:700;color:#1a1a1a;margin-bottom:12px;letter-spacing:-0.5px;">You're on the list!</h1>
        <p style="font-size:0.95rem;color:#555;line-height:1.7;margin-bottom:20px;">Thanks for signing up for the Sellnook waitlist. We're building a marketplace for independent sellers — and you'll be first to know when we launch.</p>
        ${infoBox([
          ['Early access', 'July 7, 2026'],
          ['Full launch', 'July 21, 2026 at 5pm']
        ])}
        <p style="font-size:0.875rem;color:#888;line-height:1.7;">Create your account now to be ready on day one.</p>
        ${btn('Create your account →', 'https://sellnook.com/signup.html')}
      `)
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 2. Welcome email (account created) ────────────────────
router.post('/welcome', async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    await sendEmail({
      to: email,
      subject: `Welcome to Sellnook${name ? ', ' + name : ''}!`,
      html: emailWrapper(`
        <h1 style="font-family:'Syne',sans-serif;font-size:1.6rem;font-weight:700;color:#1a1a1a;margin-bottom:12px;letter-spacing:-0.5px;">Welcome to Sellnook${name ? ', ' + name.split(' ')[0] : ''}! 👋</h1>
        <p style="font-size:0.95rem;color:#555;line-height:1.7;margin-bottom:20px;">Your account is all set. We're still building — the marketplace opens on July 21, 2026. In the meantime your dashboard is ready to explore.</p>
        ${infoBox([
          ['Account', email],
          ['Early access', 'July 7, 2026'],
          ['Full launch', 'July 21, 2026 at 5pm']
        ])}
        <p style="font-size:0.875rem;color:#888;line-height:1.7;">If you want to start selling early, upgrade to Pro from your dashboard.</p>
        ${btn('Go to Dashboard →', 'https://sellnook.com/dashboard.html')}
      `)
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 3. Order confirmation (buyer) ─────────────────────────
router.post('/order-confirmation', async (req, res) => {
  const { email, name, orderId, items, total, address, estimatedDelivery } = req.body;
  if (!email || !orderId) return res.status(400).json({ error: 'Missing fields' });
  try {
    await sendEmail({
      to: email,
      subject: `Your Sellnook order #${orderId} is confirmed`,
      html: emailWrapper(`
        <h1 style="font-family:'Syne',sans-serif;font-size:1.5rem;font-weight:700;color:#1a1a1a;margin-bottom:8px;">Order confirmed! ✓</h1>
        <p style="font-size:0.95rem;color:#555;line-height:1.7;margin-bottom:20px;">Thanks${name ? ', ' + name.split(' ')[0] : ''}! Your order has been placed and the seller has been notified.</p>
        ${infoBox([
          ['Order ID', `#${orderId}`],
          ['Total', `$${parseFloat(total || 0).toFixed(2)}`],
          ['Shipping to', address || '—'],
          ['Est. delivery', estimatedDelivery || 'See tracking when shipped']
        ])}
        <p style="font-size:0.875rem;color:#888;line-height:1.7;">You'll receive another email with tracking information once the seller ships your order. You have 30 days after delivery to report any issues.</p>
        ${btn('View Order →', `https://sellnook.com/dashboard.html`)}
      `)
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 4. Order notification (seller) ────────────────────────
router.post('/order-notify-seller', async (req, res) => {
  const { sellerEmail, shopName, orderId, itemTitle, quantity, total, buyerName, shippingAddress } = req.body;
  if (!sellerEmail || !orderId) return res.status(400).json({ error: 'Missing fields' });
  try {
    await sendEmail({
      to: sellerEmail,
      subject: `New order received on Sellnook - #${orderId}`,
      html: emailWrapper(`
        <h1 style="font-family:'Syne',sans-serif;font-size:1.5rem;font-weight:700;color:#1a1a1a;margin-bottom:8px;">You have a new order! 🎉</h1>
        <p style="font-size:0.95rem;color:#555;line-height:1.7;margin-bottom:20px;">Someone just purchased from ${shopName || 'your shop'}. Ship it within your stated processing time.</p>
        ${infoBox([
          ['Order ID', `#${orderId}`],
          ['Item', itemTitle || '—'],
          ['Quantity', quantity || '1'],
          ['Your payout', `$${parseFloat(total || 0).toFixed(2)}`],
          ['Ship to', shippingAddress || '—'],
          ['Buyer', buyerName || 'Anonymous']
        ])}
        <p style="font-size:0.875rem;color:#888;line-height:1.7;">Go to your seller dashboard to mark the order as shipped and add a tracking number.</p>
        ${btn('View Order in Dashboard →', 'https://sellnook.com/seller-dashboard.html')}
      `)
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 5. Shipping confirmation (buyer) ──────────────────────
router.post('/shipping-confirmation', async (req, res) => {
  const { email, name, orderId, itemTitle, trackingNumber, carrier, estimatedDelivery } = req.body;
  if (!email || !orderId) return res.status(400).json({ error: 'Missing fields' });
  try {
    await sendEmail({
      to: email,
      subject: `Your Sellnook order #${orderId} has shipped`,
      html: emailWrapper(`
        <h1 style="font-family:'Syne',sans-serif;font-size:1.5rem;font-weight:700;color:#1a1a1a;margin-bottom:8px;">Your order shipped! 📦</h1>
        <p style="font-size:0.95rem;color:#555;line-height:1.7;margin-bottom:20px;">Great news${name ? ', ' + name.split(' ')[0] : ''}! Your order is on its way.</p>
        ${infoBox([
          ['Order ID', `#${orderId}`],
          ['Item', itemTitle || '—'],
          ['Carrier', carrier || '—'],
          ['Tracking number', trackingNumber || '—'],
          ['Est. delivery', estimatedDelivery || '—']
        ])}
        <p style="font-size:0.875rem;color:#888;line-height:1.7;">Use the tracking number above to follow your package. Once it arrives you'll have 30 days to report any issues.</p>
        ${btn('Track your order →', `https://sellnook.com/dashboard.html`)}
      `)
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 6. Pro subscription confirmation ──────────────────────
router.post('/pro-confirmation', async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    await sendEmail({
      to: email,
      subject: "Your Sellnook Pro subscription is active",
      html: emailWrapper(`
        <h1 style="font-family:'Syne',sans-serif;font-size:1.5rem;font-weight:700;color:#1a1a1a;margin-bottom:8px;">You're a Pro Seller! ⭐</h1>
        <p style="font-size:0.95rem;color:#555;line-height:1.7;margin-bottom:20px;">Welcome to Pro${name ? ', ' + name.split(' ')[0] : ''}! Your subscription is active and all Pro features are unlocked.</p>
        <div style="background:#1a1a1a;border-radius:12px;padding:24px;margin:20px 0;">
          <div style="color:#e8734a;font-size:0.75rem;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px;">Your Pro features</div>
          ${['4% transaction fee (vs 8% free)', 'Unlimited listings & 10 photos each', 'Custom shop URL — sellnook.com/yourname', 'Verified seller badge on all listings', 'Advanced analytics dashboard', 'Discount codes for your shop', 'Early payout on demand', 'Priority customer support'].map(f =>
            `<div style="font-size:0.875rem;color:rgba(255,255,255,0.8);padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.08);">✓ ${f}</div>`
          ).join('')}
        </div>
        <p style="font-size:0.875rem;color:#888;line-height:1.7;">Head to your seller dashboard to set up your shop and start listing.</p>
        ${btn('Go to Seller Dashboard →', 'https://sellnook.com/seller-dashboard.html')}
      `)
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 7. Dispute opened notification ────────────────────────
router.post('/dispute-opened', async (req, res) => {
  const { email, name, orderId, role, reason } = req.body;
  if (!email || !orderId) return res.status(400).json({ error: 'Missing fields' });
  const isSeller = role === 'seller';
  try {
    await sendEmail({
      to: email,
      subject: `Dispute opened on Sellnook order #${orderId}`,
      html: emailWrapper(`
        <h1 style="font-family:'Syne',sans-serif;font-size:1.5rem;font-weight:700;color:#1a1a1a;margin-bottom:8px;">Dispute opened ⚠️</h1>
        <p style="font-size:0.95rem;color:#555;line-height:1.7;margin-bottom:20px;">
          ${isSeller
            ? `A buyer has opened a dispute on order #${orderId}. You have 48 hours to respond.`
            : `Your dispute for order #${orderId} has been opened. Our team will review it within 3 business days.`
          }
        </p>
        ${infoBox([
          ['Order ID', `#${orderId}`],
          ['Reason', reason || '—'],
          ['Response deadline', isSeller ? '48 hours from now' : 'N/A'],
          ['Resolution', 'Within 3 business days']
        ])}
        <p style="font-size:0.875rem;color:#888;line-height:1.7;">
          ${isSeller
            ? 'Go to your dashboard to respond with photos and details. Sellers who respond promptly get better outcomes.'
            : 'We\'ll email you once a decision has been made. You can check the status in your dashboard.'
          }
        </p>
        ${btn('View Dispute →', 'https://sellnook.com/dashboard.html')}
      `)
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 8. Review received (seller) ───────────────────────────
router.post('/review-received', async (req, res) => {
  const { email, shopName, reviewerName, rating, reviewText, itemTitle } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  const stars = '★'.repeat(rating || 5) + '☆'.repeat(5 - (rating || 5));
  try {
    await sendEmail({
      to: email,
      subject: `New ${rating}-star review for ${shopName || 'your shop'}`,
      html: emailWrapper(`
        <h1 style="font-family:'Syne',sans-serif;font-size:1.5rem;font-weight:700;color:#1a1a1a;margin-bottom:8px;">You got a new review! ⭐</h1>
        <p style="font-size:0.95rem;color:#555;line-height:1.7;margin-bottom:20px;">${reviewerName || 'A buyer'} left a review on <strong>${itemTitle || 'your listing'}</strong>.</p>
        <div style="background:#fff;border:1px solid #e8e8e5;border-radius:12px;padding:24px;margin:20px 0;">
          <div style="color:#e8734a;font-size:1.2rem;letter-spacing:2px;margin-bottom:12px;">${stars}</div>
          <div style="font-size:0.95rem;color:#555;line-height:1.7;font-style:italic;">"${reviewText || 'No comment left.'}"</div>
          <div style="font-size:0.78rem;color:#bbb;margin-top:12px;">— ${reviewerName || 'Anonymous buyer'}</div>
        </div>
        <p style="font-size:0.875rem;color:#888;line-height:1.7;">You can respond to this review from your seller dashboard.</p>
        ${btn('View & Respond →', 'https://sellnook.com/seller-dashboard.html')}
      `)
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Offer received (seller notification) ──────────────────
router.post('/offer-received', async (req, res) => {
  const { sellerEmail, sellerName, listingTitle, offerAmount, listPrice, offerId, autoAccepted } = req.body;
  try {
    await sendEmail({
      to:      sellerEmail,
      subject: autoAccepted ? `Offer auto-accepted on "${listingTitle}"` : `New offer on "${listingTitle}"`,
      html: emailWrapper(`
        <h2 style="font-family:'Syne',sans-serif;font-size:1.2rem;font-weight:700;margin-bottom:8px;">
          ${autoAccepted ? '✅ Offer auto-accepted!' : '💰 You have a new offer'}
        </h2>
        <p style="font-size:0.875rem;color:#555;margin-bottom:20px;">
          Hi ${sellerName}, someone made an offer on <strong>${listingTitle}</strong>.
        </p>
        <div style="background:#fff;border:1px solid #e8e8e5;border-radius:8px;padding:16px;margin-bottom:20px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:0.875rem;">
            <span style="color:#888;">List price</span><span style="font-weight:600;">$${parseFloat(listPrice).toFixed(2)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:0.875rem;">
            <span style="color:#888;">Offer amount</span><span style="font-weight:700;color:#2d9e6b;">$${parseFloat(offerAmount).toFixed(2)}</span>
          </div>
        </div>
        ${autoAccepted
          ? `<p style="font-size:0.82rem;color:#2d9e6b;">This offer met your auto-accept threshold and was automatically accepted.</p>`
          : btn('Respond to offer →', `https://sellnook.com/seller-dashboard.html`)
        }
      `)
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Offer update (buyer notification) ─────────────────────
router.post('/offer-update', async (req, res) => {
  const { buyerEmail, listingTitle, offerAmount, action, counterAmount, offerId } = req.body;
  const actionText = action === 'accept' ? '✅ accepted' : action === 'decline' ? '❌ declined' : '↩️ countered';
  try {
    await sendEmail({
      to:      buyerEmail,
      subject: `Your offer on "${listingTitle}" was ${action}ed`,
      html: emailWrapper(`
        <h2 style="font-family:'Syne',sans-serif;font-size:1.2rem;font-weight:700;margin-bottom:8px;">
          Your offer was ${actionText}
        </h2>
        <p style="font-size:0.875rem;color:#555;margin-bottom:16px;">
          Your offer of <strong>$${parseFloat(offerAmount).toFixed(2)}</strong> on <strong>${listingTitle}</strong> was ${action}ed.
        </p>
        ${counterAmount ? `
        <div style="background:#fff4ee;border:1px solid #fde8d4;border-radius:8px;padding:14px;margin-bottom:16px;font-size:0.875rem;">
          The seller countered with <strong style="color:#e8734a;">$${parseFloat(counterAmount).toFixed(2)}</strong>
        </div>
        ${btn('View counter offer →', `https://sellnook.com/dashboard.html`)}
        ` : action === 'accept' ? btn('Complete your purchase →', `https://sellnook.com/cart.html`) : ''}
      `)
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 9. New Message notification (email) ───────────────────
router.post('/new-message', async (req, res) => {
  const { toEmail, toName, fromName, messageSnippet, threadId } = req.body;
  if (!toEmail || !fromName) return res.status(400).json({ error: 'Missing fields' });
  try {
    await sendEmail({
      to: toEmail,
      subject: `New message from ${fromName} on Sellnook`,
      html: emailWrapper(`
        <h1 style="font-family:'Syne',sans-serif;font-size:1.4rem;font-weight:700;color:#1a1a1a;margin-bottom:8px;">New message! 💬</h1>
        <p style="font-size:0.95rem;color:#555;line-height:1.7;margin-bottom:20px;">Hi ${toName || 'User'}, ${fromName} sent you a message.</p>
        <div style="background:#fff;border:1px solid #e8e8e5;border-radius:12px;padding:20px;margin:20px 0;font-style:italic;color:#555;font-size:0.9rem;">
          "${messageSnippet || 'Click below to read your message.'}"
        </div>
        ${btn('Reply in Messages →', `https://sellnook.com/messages.html?thread=${threadId}`)}
      `)
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── 10. Login notification (security email) ────────────────
router.post('/login-notify', async (req, res) => {
  const { email, name, device, location } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    await sendEmail({
      to: email,
      subject: `New sign-in to your Sellnook account`,
      html: emailWrapper(`
        <h1 style="font-family:'Syne',sans-serif;font-size:1.3rem;font-weight:700;color:#1a1a1a;margin-bottom:8px;">New sign-in detected 🔒</h1>
        <p style="font-size:0.95rem;color:#555;line-height:1.7;margin-bottom:20px;">Hi ${name || 'User'}, we noticed a new sign-in to your Sellnook account.</p>
        ${infoBox([
          ['Device', device || 'Unknown Browser'],
          ['Location', location || 'Unknown Location'],
          ['Time', new Date().toLocaleString()]
        ])}
        <p style="font-size:0.875rem;color:#888;line-height:1.7;">If this was you, you can safely ignore this email. If not, please change your password immediately.</p>
        ${btn('Security Settings →', 'https://sellnook.com/dashboard.html')}
      `)
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Email blast (admin only) ───────────────────────────────
router.post('/blast', verifyToken, devOnly, async (req, res) => {
  const { emails, subject, message } = req.body;
  if (!emails?.length || !subject || !message) return res.status(400).json({ error: 'Missing fields' });

  let sent = 0, failed = 0;

  for (const email of emails) {
    try {
      await sendEmail({
        to: email,
        subject,
        html: emailWrapper(`
          <p style="font-size:0.95rem;color:#555;line-height:1.7;white-space:pre-wrap;">${message.replace(/\n/g,'<br>')}</p>
          ${btn('Visit Sellnook →', 'https://sellnook.com')}
        `)
      });
      sent++;
    } catch (e) {
      console.error(`Blast failed for ${email}:`, e.message);
      failed++;
    }
  }

  res.json({ success: true, sent, failed });
});

module.exports = router;
module.exports.sendEmail = sendEmail;
