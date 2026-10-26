'use strict';

class PipelineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // NOT_A_LABEL | SANITY_FAILED | BASIS_UNKNOWN
  }
}

const TOLERANCE = 0.2; // 20%

function round(v, dp) {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

/** Check energy ≈ 4*protein + 4*carbs + 9*fat (±20%). Missing values => not checked, not blocked. */
function sanityCheckEnergy({ energy_kcal, protein_g, carbs_g, fat_g }) {
  const vals = [energy_kcal, protein_g, carbs_g, fat_g];
  if (vals.some((v) => v === null || v === undefined || !Number.isFinite(v))) {
    return { ok: true, checked: false };
  }
  const calculated = 4 * protein_g + 4 * carbs_g + 9 * fat_g;
  if (energy_kcal === 0 && calculated === 0) return { ok: true, checked: true, calculated, deviation: 0 };
  if (energy_kcal === 0) return { ok: false, checked: true, calculated, deviation: 1 };

  const deviation = round(Math.abs(energy_kcal - calculated) / energy_kcal, 6);
  return { ok: deviation <= TOLERANCE, checked: true, calculated, deviation };
}

const CONVERTIBLE = ['energy_kcal', 'protein_g', 'carbs_g', 'fat_g', 'saturated_fat_g', 'sodium_mg', 'salt_g', 'sugar_g'];

/** Per serving -> per 100 g: (value / serving_size_g) * 100. */
function toPer100g(n) {
  if (n.basis === 'per_100g') return { ...n, basis: 'per_100g' };
  if (n.basis !== 'per_serving' || !Number.isFinite(n.serving_size_g) || n.serving_size_g <= 0) {
    throw new PipelineError('BASIS_UNKNOWN', 'Cannot determine per-100g values');
  }
  const out = { ...n, basis: 'per_100g' };
  for (const key of CONVERTIBLE) {
    if (Number.isFinite(n[key])) out[key] = round((n[key] / n.serving_size_g) * 100, 2);
  }
  return out;
}

/** Salt (g) = Sodium (mg) * 2.5 / 1000. 400 mg sodium -> 1 g salt. */
function sodiumToSalt(sodium_mg) {
  if (!Number.isFinite(sodium_mg) || sodium_mg < 0) return null;
  return round((sodium_mg * 2.5) / 1000, 3);
}

/** Sodium (mg) = Salt (g) * 1000 / 2.5 (labels that print salt only). */
function saltToSodium(salt_g) {
  if (!Number.isFinite(salt_g) || salt_g < 0) return null;
  return round((salt_g * 1000) / 2.5, 1);
}

/** Teaspoons = Salt (g) / 5. */
function saltToTeaspoons(salt_g) {
  if (!Number.isFinite(salt_g) || salt_g < 0) return null;
  return round(salt_g / 5, 2);
}

/** Physically impossible per-100 g values mean a misread label. */
function assertPlausiblePer100g(n) {
  for (const k of ['protein_g', 'carbs_g', 'fat_g', 'saturated_fat_g', 'sugar_g', 'salt_g']) {
    if (Number.isFinite(n[k]) && n[k] > 100) throw new PipelineError('SANITY_FAILED', `${k} > 100g/100g`);
  }
  if (Number.isFinite(n.saturated_fat_g) && Number.isFinite(n.fat_g) && n.saturated_fat_g > n.fat_g + 0.5) {
    throw new PipelineError('SANITY_FAILED', 'saturated fat > total fat');
  }
  if (Number.isFinite(n.sugar_g) && Number.isFinite(n.carbs_g) && n.sugar_g > n.carbs_g + 0.5) {
    throw new PipelineError('SANITY_FAILED', 'sugar > carbs');
  }
  if (Number.isFinite(n.energy_kcal) && n.energy_kcal > 950) {
    throw new PipelineError('SANITY_FAILED', 'energy > 950 kcal/100g');
  }
}

module.exports = {
  PipelineError, sanityCheckEnergy, toPer100g, sodiumToSalt, saltToSodium, saltToTeaspoons, assertPlausiblePer100g,
};
