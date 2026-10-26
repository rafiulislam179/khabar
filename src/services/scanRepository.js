'use strict';
const Scan = require('../models/Scan');

const ALLOWED_NUTRIENTS = ['energy_kcal', 'protein_g', 'carbs_g', 'fat_g', 'saturated_fat_g', 'sugar_g', 'sodium_mg', 'salt_g'];

/** Build the scan document from an allow-list only (no PII can slip in). */
function buildScanDoc({ per100g, ruleResults, channel = 'whatsapp' }) {
  const nutrient_values = {};
  for (const k of ALLOWED_NUTRIENTS) {
    nutrient_values[k] = Number.isFinite(per100g?.[k]) ? per100g[k] : null;
  }
  return {
    channel,
    nutrient_values,
    rule_engine_results: {
      sodium: ruleResults.sodium,
      sugar: ruleResults.sugar,
      fat: ruleResults.fat,
      saturated_fat: ruleResults.saturated_fat,
      overall: ruleResults.overall,
      rules_version: ruleResults.rules_version,
    },
  };
}

/** Save one anonymous scan. Never throws: a DB failure must not block the user's answer. */
async function saveAnonymousScan(input) {
  try {
    const doc = await Scan.create(buildScanDoc(input));
    return doc.anonymous_scan_id;
  } catch (err) {
    console.error('[db] save failed:', err.name);
    return null;
  }
}

module.exports = { saveAnonymousScan, buildScanDoc };
