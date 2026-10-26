'use strict';
// Test Gemini + full pipeline on ONE local image, without WhatsApp.
// Usage: node scripts/testGemini.js ./samples/chips.jpg
require('dotenv').config({ quiet: true });
const fs = require('fs');
const { sanitizeImage } = require('../src/services/imageService');
const { runPipeline } = require('../src/services/pipeline');

(async () => {
  const file = process.argv[2];
  if (!file) return console.error('Usage: node scripts/testGemini.js <image>');
  const img = await sanitizeImage(fs.readFileSync(file));
  console.time('pipeline');
  const out = await runPipeline(img);
  console.timeEnd('pipeline');
  console.log('\n--- Reply ---\n' + out.replyText);
  console.log('\n--- Per 100 g ---', out.per100g);
  console.log('\n--- Ratings ---', out.ruleResults);
})().catch((e) => console.error('FAILED:', e.code || e.message));
