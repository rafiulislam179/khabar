'use strict';
const twilio = require('twilio');

/**
 * Rejects any request not signed by Twilio.
 * Twilio signs the FULL public URL + all POST params with your Auth Token.
 * Behind ngrok/Render we rebuild the URL from PUBLIC_BASE_URL.
 */
function verifyTwilio(req, res, next) {
  const signature = req.get('X-Twilio-Signature');
  if (!signature) return res.status(403).send('Forbidden');

  const base = (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  const url = `${base}${req.originalUrl}`;

  const valid = twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN, signature, url, req.body || {});
  if (!valid) return res.status(403).send('Forbidden');
  return next();
}

module.exports = verifyTwilio;
