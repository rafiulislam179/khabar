'use strict';
const twilio = require('twilio');

let client = null;
function getClient() {
  if (!client) client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client;
}

const MAX_LEN = 1500;

/** Send a WhatsApp message. `to` is used only for delivery; never logged or stored. */
async function sendWhatsAppReply(to, body) {
  if (!to || !String(to).startsWith('whatsapp:')) throw new Error('Invalid recipient');
  await getClient().messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to,
    body: String(body || '').slice(0, MAX_LEN),
  });
}

module.exports = { sendWhatsAppReply };
