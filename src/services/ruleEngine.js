'use strict';
const fs = require('fs');
const path = require('path');

const RULES_PATH = process.env.RULES_PATH || path.join(__dirname, '..', 'config', 'rules.json');
const RANK = { UNKNOWN: -1, GREEN: 0, AMBER: 1, RED: 2 };

let cachedRules = null;

/** Validate rules.json so a typo can never produce wrong colours silently. */
function validateRules(rules) {
  if (!rules || typeof rules !== 'object' || !rules.nutrients) {
    throw new Error('rules.json: missing "nutrients" object');
  }
  for (const [name, r] of Object.entries(rules.nutrients)) {
    const ok =
      typeof r.field === 'string' &&
      Number.isFinite(r.green_max) &&
      Number.isFinite(r.amber_max) &&
      r.green_max >= 0 &&
      r.amber_max > r.green_max;
    if (!ok) throw new Error(`rules.json: invalid thresholds for "${name}"`);
  }
  return rules;
}

/** Load rules from disk. Call with force=true to hot-reload after editing the file. */
function loadRules(force = false) {
  if (cachedRules && !force) return cachedRules;
  const raw = fs.readFileSync(RULES_PATH, 'utf8');
  cachedRules = Object.freeze(validateRules(JSON.parse(raw)));
  return cachedRules;
}

function rateValue(value, { green_max, amber_max }) {
  if (value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) < 0) {
    return 'UNKNOWN';
  }
  const v = Number(value);
  if (v <= green_max) return 'GREEN';
  if (v <= amber_max) return 'AMBER';
  return 'RED';
}

/**
 * Deterministic rule engine. The AI NEVER decides colours; only this function does.
 * @param {object} nutrientsJson - values PER 100 g
 * @param {object} [rules] - optional rules object (for tests); defaults to rules.json
 */
function evaluateNutrients(nutrientsJson, rules = loadRules()) {
  if (!nutrientsJson || typeof nutrientsJson !== 'object') {
    throw new TypeError('evaluateNutrients: nutrientsJson must be an object');
  }

  const result = { rules_version: rules.version, missing: [] };
  let worst = 'UNKNOWN';
  let anyKnown = false;

  for (const [name, threshold] of Object.entries(rules.nutrients)) {
    const rating = rateValue(nutrientsJson[threshold.field], threshold);
    result[name] = rating;
    if (rating === 'UNKNOWN') {
      result.missing.push(name);
    } else {
      anyKnown = true;
      if (RANK[rating] > RANK[worst]) worst = rating;
    }
  }

  result.overall = anyKnown ? worst : 'UNKNOWN';
  return result;
}

module.exports = { evaluateNutrients, loadRules, rateValue, validateRules };
