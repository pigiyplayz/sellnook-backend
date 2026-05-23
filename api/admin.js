const express = require('express');
const router = express.Router();
const { verifyToken, devOnly } = require('../middleware/verifyToken');
const { db } = require('../firebase');

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── Gemini helper ──────────────────────────────────────────
async function askGemini(prompt, systemPrompt = '') {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in environment');

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048 }
  };

  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Gemini API error');
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

const SELLNOOK_SYSTEM = `You are an AI assistant for Sellnook, an online marketplace platform admin panel. You help the admin (Austin) manage and grow the platform.

You have full context about the platform and can help with anything — analyzing listings, reviewing users, drafting emails, giving business advice, answering questions, writing content, suggesting features, resolving disputes, and general conversation.

Sellnook's prohibited items include: weapons, firearms, drugs, counterfeit goods, hazardous materials, live animals, adult content, IP-infringing items, stolen goods, explosives, and anything illegal in the US. Flag these if you see them but use common sense — don't be overly aggressive about borderline cases.

Be helpful, conversational, and practical. Give real actionable advice. Don't be overly cautious or add unnecessary warnings. Austin is the platform owner so treat him as a trusted admin who can handle direct honest responses.`;

// All admin routes require authentication + dev-only access
router.use(verifyToken, devOnly);

// ── POST /api/admin/scan-listings ─────────────────────────
// Scan all active listings for policy violations
router.post('/scan-listings', async (req, res) => {
  try {
    // Get all active listings
    const snap = await db.collection('listings').where('status', '==', 'active').get();
    const listings = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!listings.length) return res.json({ violations: [], summary: 'No listings to scan.' });

    const listingData = listings.map(l =>
      `ID: ${l.id} | Title: "${l.title}" | Category: ${l.category} | Price: $${l.price} | Description: ${l.description || 'none'}`
    ).join('\n');

    const prompt = `Review these ${listings.length} Sellnook marketplace listings for policy violations, prohibited items, suspicious pricing, misleading descriptions, or anything that should be flagged.

LISTINGS:
${listingData}

Respond in JSON format only — no markdown, no backticks:
{
  "violations": [
    {
      "listingId": "string",
      "title": "string",
      "severity": "high|medium|low",
      "reason": "string",
      "recommendation": "remove|flag|warn|ok"
    }
  ],
  "summary": "string",
  "totalFlagged": number,
  "scanTime": "string"
}`;

    const raw = await askGemini(prompt, SELLNOOK_SYSTEM);
    const cleaned = raw.replace(/```json|```/g, '').trim();

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch (e) {
      result = { violations: [], summary: raw, totalFlagged: 0 };
    }

    // Auto-flag listings with high severity violations in Firestore
    for (const v of result.violations || []) {
      if (v.severity === 'high' && v.recommendation === 'remove') {
        await db.collection('listings').doc(v.listingId).update({
          flagged: true,
          flagReason: v.reason,
          flaggedAt: new Date().toISOString(),
          flaggedBy: 'ai'
        });
      }
    }

    res.json(result);
  } catch (e) {
    console.error('Scan listings error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/admin/scan-users ────────────────────────────
// Scan all users for suspicious activity
router.post('/scan-users', async (req, res) => {
  try {
    const [usersSnap, listingsSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('listings').get()
    ]);

    const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const listings = listingsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Count listings per seller
    const listingCounts = {};
    listings.forEach(l => {
      listingCounts[l.sellerId] = (listingCounts[l.sellerId] || 0) + 1;
    });

    const userData = users.map(u => {
      const count = listingCounts[u.id] || 0;
      return `UID: ${u.id} | Email: ${u.email || 'no email'} | Plan: ${u.isPro ? 'Pro' : 'Free'} | Listings: ${count} | Banned: ${u.banned || false}`;
    }).join('\n');

    const prompt = `Review these ${users.length} Sellnook user accounts for suspicious activity. Look for: unusual listing volumes for new accounts, accounts with no email, duplicate patterns, potential fraud indicators.

USERS:
${userData}

Respond in JSON only — no markdown, no backticks:
{
  "suspicious": [
    {
      "userId": "string",
      "email": "string",
      "reason": "string",
      "severity": "high|medium|low",
      "recommendation": "ban|review|monitor|ok"
    }
  ],
  "summary": "string",
  "totalFlagged": number
}`;

    const raw = await askGemini(prompt, SELLNOOK_SYSTEM);
    const cleaned = raw.replace(/```json|```/g, '').trim();

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch (e) {
      result = { suspicious: [], summary: raw, totalFlagged: 0 };
    }

    res.json(result);
  } catch (e) {
    console.error('Scan users error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/admin/resolve-dispute ──────────────────────
// Get AI recommendation for a dispute
router.post('/resolve-dispute', async (req, res) => {
  const { orderId, buyerClaim, sellerResponse, orderDetails } = req.body;
  if (!buyerClaim) return res.status(400).json({ error: 'Missing dispute details' });

  try {
    const prompt = `A dispute has been opened on Sellnook marketplace.

ORDER DETAILS:
${JSON.stringify(orderDetails || {}, null, 2)}

BUYER'S CLAIM:
${buyerClaim}

SELLER'S RESPONSE:
${sellerResponse || 'No response yet'}

Based on Sellnook's buyer protection policy (30-day window, items must match description, refunds for non-delivery), analyze this dispute and provide a recommended resolution.

Respond in JSON only — no markdown, no backticks:
{
  "recommendation": "refund_buyer|side_with_seller|partial_refund|need_more_info",
  "confidence": "high|medium|low",
  "reasoning": "string",
  "suggestedAction": "string",
  "messageToSeller": "string",
  "messageToBuyer": "string"
}`;

    const raw = await askGemini(prompt, SELLNOOK_SYSTEM);
    const cleaned = raw.replace(/```json|```/g, '').trim();

    let result;
    try { result = JSON.parse(cleaned); }
    catch (e) { result = { recommendation: 'need_more_info', reasoning: raw }; }

    res.json(result);
  } catch (e) {
    console.error('Resolve dispute error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/admin/daily-report ──────────────────────────
// Generate and email a daily summary report
router.post('/daily-report', async (req, res) => {
  try {
    const [usersSnap, listingsSnap, waitlistSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('listings').get(),
      db.collection('waitlist').get()
    ]);

    const users = usersSnap.docs.map(d => d.data());
    const listings = listingsSnap.docs.map(d => d.data());
    const waitlist = waitlistSnap.docs.length;
    const proCount = users.filter(u => u.isPro).length;
    const flagged = listings.filter(l => l.flagged).length;

    const platformData = `
Platform stats as of ${new Date().toLocaleDateString()}:
- Total users: ${users.length}
- Pro sellers: ${proCount}
- Total listings: ${listings.length}
- Flagged listings: ${flagged}
- Waitlist signups: ${waitlist}
- Days until launch: ${Math.ceil((new Date('2026-07-21') - new Date()) / 86400000)}
    `.trim();

    const prompt = `Generate a daily admin summary report for Sellnook marketplace.

${platformData}

Write a concise executive summary covering: platform health, what needs attention today, key metrics to watch, and one actionable recommendation for growth. Keep it under 200 words. Be direct and practical.`;

    const summary = await askGemini(prompt, SELLNOOK_SYSTEM);

    // Send the report via Resend
    const { sendEmail } = require('./email');
    if (typeof sendEmail === 'function') {
      await sendEmail({
        to: 'austin@sellnook.com',
        subject: `Sellnook Daily Report — ${new Date().toLocaleDateString()}`,
        html: `
        <div style="font-family:'Inter',sans-serif;max-width:520px;margin:0 auto;padding:40px 24px;background:#fafaf9;">
          <div style="font-family:'Syne',sans-serif;font-size:1.2rem;font-weight:700;color:#1a1a1a;margin-bottom:24px;">
            sell<span style="color:#e8734a;">nook</span> <span style="font-size:0.8rem;color:#aaa;font-family:'Inter',sans-serif;font-weight:400;">Daily Report</span>
          </div>
          <div style="background:#fff;border:1px solid #e8e8e5;border-radius:12px;padding:20px;margin-bottom:20px;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div style="text-align:center;padding:12px;background:#fafaf9;border-radius:8px;">
                <div style="font-size:1.6rem;font-weight:700;font-family:'Syne',sans-serif;">${users.length}</div>
                <div style="font-size:0.72rem;color:#aaa;text-transform:uppercase;letter-spacing:1px;">Users</div>
              </div>
              <div style="text-align:center;padding:12px;background:#fafaf9;border-radius:8px;">
                <div style="font-size:1.6rem;font-weight:700;font-family:'Syne',sans-serif;color:#e8734a;">${listings.length}</div>
                <div style="font-size:0.72rem;color:#aaa;text-transform:uppercase;letter-spacing:1px;">Listings</div>
              </div>
              <div style="text-align:center;padding:12px;background:#fafaf9;border-radius:8px;">
                <div style="font-size:1.6rem;font-weight:700;font-family:'Syne',sans-serif;color:#2d9e6b;">${waitlist}</div>
                <div style="font-size:0.72rem;color:#aaa;text-transform:uppercase;letter-spacing:1px;">Waitlist</div>
              </div>
              <div style="text-align:center;padding:12px;background:#fafaf9;border-radius:8px;">
                <div style="font-size:1.6rem;font-weight:700;font-family:'Syne',sans-serif;">${proCount}</div>
                <div style="font-size:0.72rem;color:#aaa;text-transform:uppercase;letter-spacing:1px;">Pro Sellers</div>
              </div>
            </div>
          </div>
          <h2 style="font-family:'Syne',sans-serif;font-size:1rem;font-weight:700;margin-bottom:12px;">AI Summary</h2>
          <p style="font-size:0.875rem;color:#555;line-height:1.7;white-space:pre-wrap;">${summary}</p>
          ${flagged > 0 ? `<div style="background:#fff4ee;border:1px solid #fde68a;border-radius:8px;padding:14px;margin-top:16px;font-size:0.82rem;color:#92400e;">⚠️ ${flagged} listing${flagged > 1 ? 's' : ''} flagged for review — check the admin panel.</div>` : ''}
          <div style="margin-top:24px;">
            <a href="https://sellnook.com/admin.html" style="display:inline-block;padding:11px 22px;background:#1a1a1a;color:#fff;border-radius:8px;font-size:0.875rem;font-weight:600;text-decoration:none;">Open Admin Panel →</a>
          </div>
          <div style="margin-top:32px;padding-top:20px;border-top:1px solid #e8e8e5;font-size:0.72rem;color:#bbb;">
            ${new Date().toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })} · Sellnook Admin
          </div>
        </div>`
      });
    }

    res.json({ success: true, summary, stats: { users: users.length, listings: listings.length, waitlist, proCount, flagged } });

  } catch (e) {
    console.error('Daily report error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/admin/chat ───────────────────────────────────
// General AI chat with platform context
router.post('/chat', async (req, res) => {
  const { message, history, platformData } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  try {
    const contextPrompt = `You are an AI moderation assistant for Sellnook marketplace.

Current platform data:
${JSON.stringify(platformData || {}, null, 2)}

${history?.length ? `Conversation history:\n${history.map(h => `${h.role}: ${h.content}`).join('\n')}\n` : ''}

User message: ${message}`;

    const reply = await askGemini(contextPrompt, SELLNOOK_SYSTEM);
    res.json({ reply });
  } catch (e) {
    console.error('AI chat error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
