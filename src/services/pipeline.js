'use strict';
const { extractNutrients } = require('./extractNutrients');
const {
  PipelineError, sanityCheckEnergy, toPer100g, sodiumToSalt, saltToSodium, assertPlausiblePer100g,
} = require('./nutritionMath');
const { evaluateNutrients } = require('./ruleEngine');
const { buildBanglaExplanation } = require('./explain');
const { remember, productKey, consensus } = require('./productMemory');
const { estimateMeal } = require('./meal');

/**
 * image -> Gemini extract -> sanity check -> per-100 g -> salt -> rule engine -> Bangla text.
 * `deps` lets tests inject a fake extractor (no network).
 */
async function runPipeline(image, { mode = 'general' } = {}, deps = {}) {
  const extract = deps.extract || extractNutrients;
  const extracted = await extract(image);

  if (extracted.kind === 'cooked_meal') {
    const meal = estimateMeal(extracted.dishes);
    if (!meal) throw new PipelineError('NOTHING_FOUND', 'No dish recognised');
    return { type: 'meal', meal, replyText: meal.tip };
  }
  if (extracted.kind === 'frying_oil') throw new PipelineError('OIL_SOON', 'Oil check not ready');
  if (extracted.kind === 'product_front') {
    const known = await lookupProduct(deps.productStore, extracted);
    if (!known) throw new PipelineError('NEED_BACK_LABEL', 'Front of pack, unknown product');
    return finishLabel(known.per100g, { name: extracted.product_name, brand: extracted.brand, scan_count: known.scanCount, from_memory: true }, mode, deps);
  }
  if (extracted.kind === 'other') throw new PipelineError('NOTHING_FOUND', 'Nothing recognisable');
  if (!extracted.label_found) throw new PipelineError('NOT_A_LABEL', 'No nutrition table found');

  const sanity = sanityCheckEnergy(extracted);
  if (!sanity.ok) throw new PipelineError('SANITY_FAILED', 'Energy does not match macros');

  const per100g = toPer100g(extracted);
  if (per100g.sodium_mg == null && per100g.salt_g != null) per100g.sodium_mg = saltToSodium(per100g.salt_g);
  if (per100g.salt_g == null && per100g.sodium_mg != null) per100g.salt_g = sodiumToSalt(per100g.sodium_mg);

  assertPlausiblePer100g(per100g);

  // Product memory: same product -> same (median) values across scans.
  let product = null;
  let values = per100g;
  if (deps.productStore) {
    try {
      const mem = await remember(deps.productStore, extracted, per100g);
      if (mem) {
        values = mem.per100g;
        if (values.sodium_mg != null) values.salt_g = sodiumToSalt(values.sodium_mg);
        product = { name: extracted.product_name, brand: extracted.brand, scan_count: mem.scanCount };
      }
    } catch (err) {
      console.error('[memory] failed:', err.name); // never block the user's result
    }
  }
  if (!product && extracted.product_name) {
    product = { name: extracted.product_name, brand: extracted.brand, scan_count: null };
  }

  return finishLabel(values, product, mode, deps);
}

async function finishLabel(values, product, mode, deps) {
  const ruleResults = evaluateNutrients(values);
  const replyText = await buildBanglaExplanation(ruleResults, values, { mode, picker: deps.picker });
  return { type: 'label', replyText, per100g: values, ruleResults, product };
}

/** Front-of-pack: only answer if this exact product was label-scanned before. Never invent numbers. */
async function lookupProduct(store, identity) {
  if (!store) return null;
  const key = productKey(identity);
  if (!key) return null;
  try {
    const doc = await store.findByKey(key);
    if (!doc || !Array.isArray(doc.readings) || !doc.readings.length) return null;
    const per100g = consensus(doc.readings);
    if (per100g.salt_g == null && per100g.sodium_mg != null) per100g.salt_g = sodiumToSalt(per100g.sodium_mg);
    return { per100g, scanCount: doc.scan_count || doc.readings.length };
  } catch (err) {
    console.error('[memory] lookup failed:', err.name);
    return null;
  }
}

module.exports = { runPipeline };
