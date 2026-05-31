const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const app = express();

// ── Environment variable validation ─────────────────────────
const requiredEnvVars = ['RESEND_API_KEY'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingEnvVars.forEach(varName => console.error(`    - ${varName}`));
  console.error('\nPlease set these variables and restart the server.');
  process.exit(1);
}

// ── Security headers ───────────────────────────────────────
app.use(helmet());

// ── Compression ─────────────────────────────────────────────
app.use(compression());

// ── Request ID middleware ────────────────────────────────────
app.use((req, res, next) => {
  req.id = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  
  const startTime = Date.now();
  req.startTime = startTime;
  
  // Log incoming request
  console.log(`[${req.id}] ${req.method} ${req.path} - Started`);
  
  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log(`[${req.id}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
});

// ── Rate limiting ──────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // stricter limit for sensitive endpoints
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

// ── Stripe webhook — raw body parser MUST come before json() ──
// This route needs the raw body for Stripe signature verification.
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// ── Middleware ─────────────────────────────────────────────
app.use(express.json());
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (/^https?:\/\/(localhost|127\.0\.0\.1):\d+/.test(origin) ||
      origin.includes('sellnook.com') ||
      origin.includes('sellnook.onrender.com')) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Apply general rate limiting to all API routes
app.use('/api/', generalLimiter);

// ── Keep-alive ping every 14 minutes ──────────────────────
const BACKEND_URL = process.env.BACKEND_URL || process.env.RENDER_EXTERNAL_URL || 'https://sellnook-backend.onrender.com';
setInterval(async () => {
  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/ping`);
    console.log(`Keep-alive ping OK — ${new Date().toISOString()}`);
  } catch (e) {
    console.error('Keep-alive failed:', e.message);
  }
}, 14 * 60 * 1000);

// ── Routes ─────────────────────────────────────────────────
app.use('/api/auth', require('./api/auth'));
app.use('/api/user', require('./api/user'));
app.use('/api/product', require('./api/product'));

// FIXED: Destructure the .router object out of your email module to satisfy Express middleware criteria
const { router: emailRouter } = require('./api/email');
app.use('/api/email', emailRouter);

app.use('/api/admin', strictLimiter, require('./api/admin')); // extra rate limit on admin
app.use('/api/orders', require('./api/orders'));
app.use('/api/shop', require('./api/shop'));
app.use('/api/shipping', require('./api/shipping'));
app.use('/api/offers', require('./api/offers'));
app.use('/api/promoted', require('./api/promoted'));
app.use('/api/reviews', require('./api/reviews'));
app.use('/api/stripe', require('./api/stripe'));

// ── Global error handler ─────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`[${req.id || 'unknown'}] Error:`, err);
  
  const statusCode = err.statusCode || 500;
  const errorCode = err.code || 'INTERNAL_ERROR';
  
  res.status(statusCode).json({
    error: err.message || 'An unexpected error occurred',
    code: errorCode,
    requestId: req.id
  });
});

// ── 404 handler ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    code: 'NOT_FOUND',
    requestId: req.id
  });
});

// ── Daily report — runs every day at 8am UTC ───────────────
function scheduleDailyReport() {
  const now = new Date();
  const next8am = new Date(now);
  next8am.setUTCHours(8, 0, 0, 0);
  if (next8am <= now) next8am.setUTCDate(next8am.getUTCDate() + 1);
  const msUntil = next8am - now;

  setTimeout(async () => {
    try {
      console.log('Running daily report...');
      await fetch(`${BACKEND_URL}/api/admin/daily-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer internal-cron' // admin now requires auth
        }
      });
    } catch (e) { console.error('Daily report failed:', e.message); }
    scheduleDailyReport();
  }, msUntil);

  console.log(`Daily report scheduled in ${Math.round(msUntil/3600000)}h`);
}
scheduleDailyReport();

// ── Health check ───────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'Sellnook API is running', version: '1.1.0' });
});

// ── Start ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sellnook backend running on port ${PORT}`);
});

module.exports = app;
