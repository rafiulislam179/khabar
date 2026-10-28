'use strict';
const { extractNutrients } = require('./extractNutrients');
const {
  PipelineError, sanityCheckEnergy, toPer100g, sodiumToSalt, saltToSodium, assertPlausiblePer100g,
} = require('./nutritionMath');
const { evaluateNutrients } = require('./ruleEngine');
const { buildBanglaExplanation } = require('./explain');
const { remember } = require('./productMemory');

/**
 * image -> Gemini extract -> sanity check -> per-100 g -> salt -> rule engine -> Bangla text.
 * `deps` lets tests inject a fake extractor (no network).
 */
async function runPipeline(image, { mode = 'general' } = {}, deps = {}) {
  const extract = deps.extract || extractNutrients;
  const extracted = await extract(image);

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

  const ruleResults = evaluateNutrients(values);
  const replyText = await buildBanglaExplanation(ruleResults, values, { mode, picker: deps.picker });
  return { replyText, per100g: values, ruleResults, product };
}

module.exports = { runPipeline };
