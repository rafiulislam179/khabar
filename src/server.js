'use strict';
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { loadRules } = require('./services/ruleEngine');
const { runPipeline } = require('./services/pipeline');
const { saveAnonymousScan } = require('./services/scanRepository');
const { saltToTeaspoons } = require('./services/nutritionMath');
const { mongoStore } = require('./services/productMemory');
const Product = require('./models/Product');

const productStore = mongoStore(Product);

// Required for the web app. Twilio is OPTIONAL (WhatsApp turns on only if its keys exist).
const REQUIRED = ['GEMINI_API_KEY', 'MONGODB_URI'];
const TWILIO_KEYS = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM', 'PUBLIC_BASE_URL', 'RATE_LIMIT_HASH_SECRET'];

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing required env vars: ${missing.join(', ')}`);
  process.exit(1);
}
const twilioEnabled = TWILIO_KEYS.every((k) => process.env[k]);
if (!twilioEnabled) {
  // Make sure the webhook is NOT mounted with half a configuration.
  delete process.env.TWILIO_ACCOUNT_SID;
  delete process.env.TWILIO_AUTH_TOKEN;
}

const app = require('./app');
const { setWebScanProcessor } = require('./routes/scan');

async function scanAndSave(image, ctx) {
  const { replyText, per100g, ruleResults, product } = await runPipeline(
    image, { mode: ctx.mode || 'general' }, { productStore }
  );
  await saveAnonymousScan({ per100g, ruleResults, channel: ctx.channel });
  return { replyText, per100g, ruleResults, product };
}

// Web app: return structured result for the UI.
setWebScanProcessor(async (image, ctx) => {
  const { replyText, per100g, ruleResults, product } = await scanAndSave(image, ctx);
  return {
    message: replyText,
    product: product || null,
    ratings: {
      sodium: ruleResults.sodium,
      sugar: ruleResults.sugar,
      fat: ruleResults.fat,
      saturated_fat: ruleResults.saturated_fat,
      overall: ruleResults.overall,
    },
    per100g: {
      energy_kcal: per100g.energy_kcal ?? null,
      sodium_mg: per100g.sodium_mg ?? null,
      salt_g: per100g.salt_g ?? null,
      salt_tsp: per100g.salt_g != null ? saltToTeaspoons(per100g.salt_g) : null,
      sugar_g: per100g.sugar_g ?? null,
      fat_g: per100g.fat_g ?? null,
      saturated_fat_g: per100g.saturated_fat_g ?? null,
    },
    rules_version: ruleResults.rules_version,
  };
});

// WhatsApp: return text only.
if (twilioEnabled) {
  const { setScanProcessor } = require('./routes/webhook');
  setScanProcessor(async (image, ctx) => (await scanAndSave(image, ctx)).replyText);
}

async function start() {
  loadRules();
  mongoose.set('strictQuery', true);
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('MongoDB connected');
  console.log(`WhatsApp: ${twilioEnabled ? 'ON' : 'OFF (web app only)'}`);
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`Khabar Check listening on port ${port}`));
}

process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection:', reason?.code || reason?.name || 'unknown');
});
process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err.code || err.name);
  process.exit(1);
});

start().catch((err) => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
