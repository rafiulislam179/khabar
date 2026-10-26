'use strict';
const sharp = require('sharp');

// Web-only mode: no Twilio keys -> webhook must NOT be mounted.
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;

const app = require('../src/app');
const { setWebScanProcessor } = require('../src/routes/scan');

let server;
let base;
let received;

beforeAll(async () => {
  setWebScanProcessor(async (image, ctx) => {
    received = { image, ctx };
    return {
      message: '● এত লবণ অনেক বেশি।',
      ratings: { sodium: 'RED', sugar: 'GREEN', fat: 'RED', saturated_fat: 'RED', overall: 'RED' },
      per100g: { salt_g: 1.7, sugar_g: 3, fat_g: 34, saturated_fat_g: 12 },
    };
  });
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

async function photo() {
  return sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#fafafa' } })
    .jpeg()
    .withExif({ IFD0: { Make: 'Phone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '23/1 48/1 0/1' } })
    .toBuffer();
}

test('home page is served with strict security headers', async () => {
  const res = await fetch(`${base}/`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain('খাবার চেক');
  const csp = res.headers.get('content-security-policy');
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("frame-ancestors 'none'");
});

test('PWA files are served', async () => {
  for (const p of ['/manifest.json', '/sw.js', '/app.js', '/styles.css', '/icons/icon-192.png']) {
    expect((await fetch(base + p)).status).toBe(200);
  }
});

test('scan: valid photo returns structured result, GPS stripped before processing', async () => {
  const form = new FormData();
  form.append('photo', new Blob([await photo()], { type: 'image/jpeg' }), 'label.jpg');
  form.append('mode', 'tiffin');
  const res = await fetch(`${base}/api/scan`, { method: 'POST', body: form });
  const data = await res.json();

  expect(res.status).toBe(200);
  expect(data.ok).toBe(true);
  expect(data.ratings.overall).toBe('RED');
  expect(received.ctx).toEqual({ channel: 'pwa', mode: 'tiffin' });

  const meta = await sharp(Buffer.from(received.image.base64, 'base64')).metadata();
  expect(meta.exif).toBeUndefined();
  expect(meta.width).toBe(1024);
});

test('scan: unknown mode falls back to general', async () => {
  const form = new FormData();
  form.append('photo', new Blob([await photo()], { type: 'image/jpeg' }), 'x.jpg');
  form.append('mode', '<script>');
  await fetch(`${base}/api/scan`, { method: 'POST', body: form });
  expect(received.ctx.mode).toBe('general');
});

test('scan: no photo -> 400 with Bangla message', async () => {
  const res = await fetch(`${base}/api/scan`, { method: 'POST', body: new FormData() });
  const data = await res.json();
  expect(res.status).toBe(400);
  expect(data.ok).toBe(false);
  expect(data.message).toMatch(/ছবিটা পরিষ্কার নয়/);
});

test('scan: non-image file is rejected', async () => {
  const form = new FormData();
  form.append('photo', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
  const res = await fetch(`${base}/api/scan`, { method: 'POST', body: form });
  expect(res.status).toBe(400);
});

test('scan: fake "image" with jpeg type but garbage bytes is rejected', async () => {
  const form = new FormData();
  form.append('photo', new Blob(['not really a jpeg'], { type: 'image/jpeg' }), 'x.jpg');
  const res = await fetch(`${base}/api/scan`, { method: 'POST', body: form });
  expect(res.status).toBe(400);
});

test('scan: file over 5 MB is rejected', async () => {
  const form = new FormData();
  form.append('photo', new Blob([Buffer.alloc(5 * 1024 * 1024 + 10)], { type: 'image/jpeg' }), 'big.jpg');
  const res = await fetch(`${base}/api/scan`, { method: 'POST', body: form });
  expect(res.status).toBe(413);
});

test('processor errors map to Bangla, no internals leaked', async () => {
  setWebScanProcessor(async () => { throw Object.assign(new Error('secret db detail'), { code: 'NOT_A_LABEL' }); });
  const form = new FormData();
  form.append('photo', new Blob([await photo()], { type: 'image/jpeg' }), 'x.jpg');
  const res = await fetch(`${base}/api/scan`, { method: 'POST', body: form });
  const data = await res.json();
  expect(res.status).toBe(422);
  expect(data.message).toMatch(/পুষ্টি-তালিকা খুঁজে পাইনি/);
  expect(JSON.stringify(data)).not.toContain('secret db detail');
});

test('webhook is not exposed when Twilio is not configured', async () => {
  const res = await fetch(`${base}/webhook`, { method: 'POST' });
  expect(res.status).toBe(404);
});
