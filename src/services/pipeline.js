'use strict';
const { extractNutrients } = require('./extractNutrients');
const {
  PipelineError, sanityCheckEnergy, toPer100g, sodiumToSalt, saltToSodium, assertPlausiblePer100g,
} = require('./nutritionMath');
const { evaluateNutrients } = require('./ruleEngine');
const { buildBanglaExplanation } = require('./explain');

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

  const ruleResults = evaluateNutrients(per100g);
  const replyText = await buildBanglaExplanation(ruleResults, per100g, { mode, picker: deps.picker });
  return { replyText, per100g, ruleResults };
}

module.exports = { runPipeline };
