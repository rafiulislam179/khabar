'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { rateLimit } = require('express-rate-limit');

const app = express();

// Behind ngrok/Render: trust exactly one proxy hop so req.ip is the real client.
app.set('trust proxy', 1);
app.disable('x-powered-by');

// Security headers. CSP allows only our own files; blob:/data: needed for the photo preview.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  })
);

// CORS: the web app is same-origin; extra origins only if listed. Twilio needs no CORS.
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false); // not allowed: browser blocks it, no error page
    },
    methods: ['GET', 'POST'],
  })
);

// Web app (PWA) static files — served BEFORE rate limits so page loads aren't counted.
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    index: 'index.html',
    maxAge: '1h',
    setHeaders(res, filePath) {
      if (filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// Small body limits for form/JSON (photos go through multer with their own 5 MB cap).
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(express.json({ limit: '20kb' }));

// 20 requests / 15 min / IP on everything except the webhook and scan API (they have their own limits).
const ipLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/webhook') || req.path.startsWith('/api/scan'),
  message: { error: 'Too many requests. Please try again later.' },
});
app.use(ipLimiter);

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

app.use('/api/scan', require('./routes/scan').router);

// WhatsApp webhook only if Twilio is configured (web app works without it).
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  app.use('/webhook', require('./routes/webhook').router);
}

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (process.env.NODE_ENV !== 'production') console.error('[app]', err.name || err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
