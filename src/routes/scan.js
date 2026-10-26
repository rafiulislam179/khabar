'use strict';
const express = require('express');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { sanitizeImage, ImageError } = require('../services/imageService');
const { userMessageFor, MESSAGES } = require('../services/errorMessages');

const router = express.Router();

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Memory storage only: the uploaded photo is NEVER written to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1, fields: 2 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(String(file.mimetype).toLowerCase())) return cb(null, true);
    return cb(new ImageError('UNSUPPORTED_TYPE', 'Unsupported media type'));
  },
});

// 20 scans / 15 min / IP for the web app (protects the Gemini budget).
const scanLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, message: 'অনেকবার স্ক্যান করা হয়েছে। ১৫ মিনিট পরে আবার চেষ্টা করুন।' },
});

// Replaceable processor (set in server.js; tests inject a fake).
let processScan = async () => {
  throw Object.assign(new Error('Scan processor not configured'), { code: 'NOT_CONFIGURED' });
};
function setWebScanProcessor(fn) {
  processScan = fn;
}

const STATUS = { NOT_A_LABEL: 422, SANITY_FAILED: 422, BASIS_UNKNOWN: 422, NOT_AN_IMAGE: 400, EMPTY_IMAGE: 400, UNSUPPORTED_TYPE: 400, TOO_LARGE: 413 };

router.post('/', scanLimiter, (req, res) => {
  upload.single('photo')(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        if (uploadErr.code === 'LIMIT_FILE_SIZE') throw new ImageError('TOO_LARGE', 'Image too large');
        throw uploadErr;
      }
      if (!req.file) throw new ImageError('EMPTY_IMAGE', 'No photo uploaded');

      const mode = req.body && req.body.mode === 'tiffin' ? 'tiffin' : 'general';
      const image = await sanitizeImage(req.file.buffer); // strips EXIF/GPS, resizes
      req.file.buffer = null; // drop the original from memory early

      const result = await processScan(image, { channel: 'pwa', mode });
      return res.status(200).json({ ok: true, ...result });
    } catch (err) {
      console.error('[scan] failed:', err.code || err.name); // code only, no content
      return res.status(STATUS[err.code] || 500).json({
        ok: false,
        code: STATUS[err.code] ? err.code : 'SERVER_ERROR',
        message: userMessageFor(err) || MESSAGES.SERVER_ERROR,
      });
    }
  });
});

module.exports = { router, setWebScanProcessor };
