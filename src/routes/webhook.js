'use strict';
const express = require('express');
const verifyTwilio = require('../middleware/verifyTwilio');
const { senderRateLimit } = require('../middleware/senderRateLimit');
const { fetchAndSanitize } = require('../services/imageService');
const { sendWhatsAppReply } = require('../services/twilioService');
const { userMessageFor } = require('../services/errorMessages');

const router = express.Router();

const MSG_SEND_PHOTO = 'Please send a photo of the nutrition label. / পুষ্টি-তালিকার ছবি পাঠান।';
const EMPTY_TWIML = '<Response></Response>';

// Replaceable pipeline hook (set in server.js).
let processScan = async () => 'স্ক্যান গ্রহণ করা হয়েছে।';
function setScanProcessor(fn) {
  processScan = fn;
}

async function handleIncoming(body) {
  const from = body.From; // in memory only
  const numMedia = Number.parseInt(body.NumMedia, 10) || 0;

  if (numMedia < 1) {
    await sendWhatsAppReply(from, MSG_SEND_PHOTO);
    return;
  }

  // Only the FIRST image is processed (caps cost).
  const image = await fetchAndSanitize(body.MediaUrl0, body.MediaContentType0);
  const replyText = await processScan(image, { channel: 'whatsapp' });
  await sendWhatsAppReply(from, replyText);
}

router.post('/', verifyTwilio, senderRateLimit, (req, res) => {
  // Acknowledge immediately (Twilio times out after ~15s and would retry).
  res.status(200).type('text/xml').send(EMPTY_TWIML);

  const { From, NumMedia, MediaUrl0, MediaContentType0 } = req.body || {};
  setImmediate(async () => {
    try {
      await handleIncoming({ From, NumMedia, MediaUrl0, MediaContentType0 });
    } catch (err) {
      console.error('[webhook] failed:', err.code || err.name); // code only, no PII
      try {
        await sendWhatsAppReply(From, userMessageFor(err));
      } catch (sendErr) {
        console.error('[webhook] could not send error reply:', sendErr.code || sendErr.name);
      }
    }
  });
});

module.exports = { router, setScanProcessor, handleIncoming };
