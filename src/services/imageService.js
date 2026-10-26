'use strict';
const sharp = require('sharp');

const MAX_BYTES = 5 * 1024 * 1024; // Twilio WhatsApp image limit
const DOWNLOAD_TIMEOUT_MS = 10000;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_INPUT_PIXELS = 40_000_000; // decompression-bomb guard

sharp.cache(false);

class ImageError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** SSRF guard: only download from Twilio's API host. */
function assertTwilioMediaUrl(mediaUrl) {
  let u;
  try {
    u = new URL(mediaUrl);
  } catch {
    throw new ImageError('BAD_MEDIA_URL', 'Invalid media URL');
  }
  if (u.protocol !== 'https:' || u.hostname !== 'api.twilio.com') {
    throw new ImageError('BAD_MEDIA_URL', 'Media URL not from Twilio');
  }
}

/**
 * Download Twilio media into a Buffer (never to disk).
 * Node's fetch drops the Authorization header on cross-origin redirects,
 * so Twilio credentials are not sent to the storage host.
 */
async function downloadMediaToBuffer(mediaUrl) {
  assertTwilioMediaUrl(mediaUrl);
  const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(mediaUrl, {
      headers: { Authorization: `Basic ${auth}` },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res.ok) throw new ImageError('DOWNLOAD_FAILED', `Media download failed: ${res.status}`);

    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > MAX_BYTES) throw new ImageError('TOO_LARGE', 'Image too large');

    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > MAX_BYTES) throw new ImageError('TOO_LARGE', 'Image too large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    if (err.name === 'AbortError') throw new ImageError('DOWNLOAD_TIMEOUT', 'Media download timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Strip ALL metadata (EXIF/GPS/ICC/XMP), fix orientation, resize to <=1024px wide, re-encode JPEG. */
async function sanitizeImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ImageError('EMPTY_IMAGE', 'Empty image');
  }
  let meta;
  try {
    meta = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new ImageError('NOT_AN_IMAGE', 'Unreadable image');
  }
  if (!meta.width || !meta.height) throw new ImageError('NOT_AN_IMAGE', 'Unreadable image');

  let clean;
  try {
    clean = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate() // apply EXIF orientation before metadata is dropped
      .resize({ width: 1024, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer(); // no .withMetadata() => all metadata stripped
  } catch {
    throw new ImageError('NOT_AN_IMAGE', 'Unreadable image');
  }
  return { base64: clean.toString('base64'), mimeType: 'image/jpeg', bytes: clean.length };
}

async function fetchAndSanitize(mediaUrl, contentType) {
  if (contentType && !ALLOWED_TYPES.has(String(contentType).toLowerCase())) {
    throw new ImageError('UNSUPPORTED_TYPE', 'Unsupported media type');
  }
  const raw = await downloadMediaToBuffer(mediaUrl);
  return sanitizeImage(raw);
}

module.exports = { fetchAndSanitize, sanitizeImage, downloadMediaToBuffer, assertTwilioMediaUrl, ImageError };
