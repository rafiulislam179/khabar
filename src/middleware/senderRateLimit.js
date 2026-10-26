'use strict';
const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');

/** One-way keyed hash: same phone -> same key, phone cannot be recovered. Memory only. */
function hashSender(from) {
  return crypto
    .createHmac('sha256', process.env.RATE_LIMIT_HASH_SECRET || 'dev-only-secret')
    .update(String(from || 'unknown'))
    .digest('hex');
}

// 20 scans / 15 min per WhatsApp sender. Default MemoryStore: nothing written to disk or DB.
const senderRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: false,
  legacyHeaders: false,
  keyGenerator: (req) => hashSender(req.body && req.body.From),
  // Valid empty TwiML so Twilio doesn't retry.
  handler: (req, res) => res.status(200).type('text/xml').send('<Response></Response>'),
});

module.exports = { senderRateLimit, hashSender };
