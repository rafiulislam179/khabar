'use strict';
const sharp = require('sharp');
const twilio = require('twilio');
const { sanitizeImage, assertTwilioMediaUrl } = require('../src/services/imageService');
const verifyTwilio = require('../src/middleware/verifyTwilio');
const { hashSender } = require('../src/middleware/senderRateLimit');
const Scan = require('../src/models/Scan');
const { buildScanDoc } = require('../src/services/scanRepository');

describe('Image privacy (EXIF / GPS stripping)', () => {
  test('GPS and all EXIF are removed and image is resized to <=1024px', async () => {
    const withGps = await sharp({ create: { width: 2000, height: 1500, channels: 3, background: '#ffffff' } })
      .jpeg()
      .withExif({ IFD0: { Make: 'TestPhone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '23/1 48/1 0/1' } })
      .toBuffer();

    const before = await sharp(withGps).metadata();
    expect(before.exif).toBeDefined(); // proves the test image really had EXIF

    const out = await sanitizeImage(withGps);
    const after = await sharp(Buffer.from(out.base64, 'base64')).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.width).toBe(1024);
    expect(out.mimeType).toBe('image/jpeg');
  });

  test('non-image data is rejected', async () => {
    await expect(sanitizeImage(Buffer.from('not an image'))).rejects.toMatchObject({ code: 'NOT_AN_IMAGE' });
  });

  test('empty buffer is rejected', async () => {
    await expect(sanitizeImage(Buffer.alloc(0))).rejects.toMatchObject({ code: 'EMPTY_IMAGE' });
  });
});

describe('SSRF guard', () => {
  test('only https://api.twilio.com is allowed', () => {
    expect(() => assertTwilioMediaUrl('https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1')).not.toThrow();
    expect(() => assertTwilioMediaUrl('http://api.twilio.com/x')).toThrow();
    expect(() => assertTwilioMediaUrl('https://evil.com/x')).toThrow();
    expect(() => assertTwilioMediaUrl('https://api.twilio.com.evil.com/x')).toThrow();
    expect(() => assertTwilioMediaUrl('http://169.254.169.254/latest')).toThrow();
  });
});

describe('Twilio signature validation', () => {
  const TOKEN = 'test_auth_token';
  const BASE = 'https://example.ngrok-free.app';
  const params = { From: 'whatsapp:+8801000000000', NumMedia: '0', Body: 'hi' };

  beforeAll(() => {
    process.env.TWILIO_AUTH_TOKEN = TOKEN;
    process.env.PUBLIC_BASE_URL = BASE;
  });

  function run(signature) {
    const req = { originalUrl: '/webhook', body: params, get: () => signature };
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, send() { return this; } };
    let nextCalled = false;
    verifyTwilio(req, res, () => { nextCalled = true; });
    return { res, nextCalled };
  }

  test('valid Twilio signature passes', () => {
    const sig = twilio.getExpectedTwilioSignature(TOKEN, `${BASE}/webhook`, params);
    expect(run(sig).nextCalled).toBe(true);
  });
  test('forged signature is rejected with 403', () => {
    const { res, nextCalled } = run('forged-signature');
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });
  test('missing signature is rejected with 403', () => {
    const { res, nextCalled } = run(undefined);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });
});

describe('No PII stored', () => {
  test('sender hash is one-way and stable', () => {
    process.env.RATE_LIMIT_HASH_SECRET = 'secret';
    const h = hashSender('whatsapp:+8801712345678');
    expect(h).toHaveLength(64);
    expect(h).toBe(hashSender('whatsapp:+8801712345678'));
    expect(h).not.toContain('8801712345678');
  });

  test('schema REJECTS extra fields like phone or image', () => {
    const base = buildScanDoc({
      per100g: { sodium_mg: 680 },
      ruleResults: { sodium: 'RED', sugar: 'GREEN', fat: 'RED', saturated_fat: 'RED', overall: 'RED', rules_version: 't' },
    });
    expect(() => new Scan({ ...base, phone: '+8801712345678' })).toThrow();
    expect(() => new Scan({ ...base, image: 'base64...' })).toThrow();
  });

  test('a valid anonymous scan document passes validation', async () => {
    const doc = new Scan(buildScanDoc({
      per100g: { sodium_mg: 680, salt_g: 1.7 },
      ruleResults: { sodium: 'RED', sugar: 'GREEN', fat: 'RED', saturated_fat: 'RED', overall: 'RED', rules_version: 't' },
    }));
    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.anonymous_scan_id).toMatch(/^[0-9a-f-]{36}$/);
    const keys = Object.keys(doc.toObject());
    expect(keys.sort()).toEqual(['_id', 'anonymous_scan_id', 'channel', 'nutrient_values', 'rule_engine_results', 'timestamp'].sort());
  });
});
