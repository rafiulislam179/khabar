'use strict';
const { saltToTeaspoons } = require('./nutritionMath');

/** Pipeline output -> JSON for the web app. */
function toWebResponse(out) {
  if (out.type === 'meal') return { type: 'meal', message: out.replyText, meal: out.meal };
  const { replyText, per100g, ruleResults, product } = out;
  return {
    type: 'label',
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
}

module.exports = { toWebResponse };
