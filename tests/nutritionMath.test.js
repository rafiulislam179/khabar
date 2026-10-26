'use strict';
const {
  sanityCheckEnergy, toPer100g, sodiumToSalt, saltToSodium, saltToTeaspoons, assertPlausiblePer100g, PipelineError,
} = require('../src/services/nutritionMath');
const { evaluateNutrients, validateRules } = require('../src/services/ruleEngine');
const { userMessageFor, MESSAGES } = require('../src/services/errorMessages');

describe('Salt conversion', () => {
  test('400 mg sodium = 1 g salt', () => expect(sodiumToSalt(400)).toBe(1));
  test('0 mg sodium = 0 g salt', () => expect(sodiumToSalt(0)).toBe(0));
  test('1516 mg sodium (instant noodles) = 3.79 g salt', () => expect(sodiumToSalt(1516)).toBeCloseTo(3.79, 2));
  test('1 g salt = 0.2 teaspoons', () => expect(saltToTeaspoons(1)).toBe(0.2));
  test('5 g salt = 1 teaspoon', () => expect(saltToTeaspoons(5)).toBe(1));
  test('salt -> sodium round trip', () => expect(saltToSodium(sodiumToSalt(680))).toBeCloseTo(680, 0));
  test('invalid inputs return null', () => {
    expect(sodiumToSalt(-1)).toBeNull();
    expect(sodiumToSalt(NaN)).toBeNull();
    expect(saltToTeaspoons(null)).toBeNull();
  });
});

describe('Unit conversion (per serving -> per 100 g)', () => {
  test('30 g serving with 150 kcal = 500 kcal/100 g', () => {
    const out = toPer100g({ basis: 'per_serving', serving_size_g: 30, energy_kcal: 150, sodium_mg: 204 });
    expect(out.energy_kcal).toBe(500);
    expect(out.sodium_mg).toBe(680);
    expect(out.basis).toBe('per_100g');
  });
  test('already per 100 g is unchanged', () => {
    expect(toPer100g({ basis: 'per_100g', fat_g: 34 }).fat_g).toBe(34);
  });
  test('nulls stay null', () => {
    expect(toPer100g({ basis: 'per_serving', serving_size_g: 25, sugar_g: null }).sugar_g).toBeNull();
  });
  test('per serving without serving size throws BASIS_UNKNOWN', () => {
    expect(() => toPer100g({ basis: 'per_serving', serving_size_g: null })).toThrow(PipelineError);
    expect(() => toPer100g({ basis: 'unknown' })).toThrow(expect.objectContaining({ code: 'BASIS_UNKNOWN' }));
  });
  test('zero serving size is rejected (no divide by zero)', () => {
    expect(() => toPer100g({ basis: 'per_serving', serving_size_g: 0 })).toThrow();
  });
});

describe('Energy sanity check (±20%)', () => {
  test('matching chips label passes', () => {
    // 4*6 + 4*55 + 9*34 = 550; label 536 -> 2.6% off
    expect(sanityCheckEnergy({ energy_kcal: 536, protein_g: 6, carbs_g: 55, fat_g: 34 }).ok).toBe(true);
  });
  test('exactly 20% off still passes', () => {
    expect(sanityCheckEnergy({ energy_kcal: 500, protein_g: 0, carbs_g: 100, fat_g: 0 }).ok).toBe(true);
  });
  test('just over 20% off fails', () => {
    expect(sanityCheckEnergy({ energy_kcal: 500, protein_g: 0, carbs_g: 99, fat_g: 0 }).ok).toBe(false);
  });
  test('misread label (>20% off) fails', () => {
    expect(sanityCheckEnergy({ energy_kcal: 250, protein_g: 6, carbs_g: 55, fat_g: 34 }).ok).toBe(false);
  });
  test('missing values are skipped, not failed', () => {
    const r = sanityCheckEnergy({ energy_kcal: 500, protein_g: null, carbs_g: 50, fat_g: 20 });
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(false);
  });
  test('energy 0 with real macros fails', () => {
    expect(sanityCheckEnergy({ energy_kcal: 0, protein_g: 5, carbs_g: 50, fat_g: 10 }).ok).toBe(false);
  });
});

describe('Plausibility checks', () => {
  test('fat over 100 g per 100 g is rejected', () => {
    expect(() => assertPlausiblePer100g({ fat_g: 140 })).toThrow(PipelineError);
  });
  test('saturated fat greater than total fat is rejected', () => {
    expect(() => assertPlausiblePer100g({ fat_g: 10, saturated_fat_g: 20 })).toThrow();
  });
  test('normal values pass', () => {
    expect(() => assertPlausiblePer100g({ fat_g: 34, saturated_fat_g: 12, sugar_g: 3, carbs_g: 55 })).not.toThrow();
  });
});

describe('Rule engine (deterministic)', () => {
  const rules = {
    version: 'test',
    nutrients: {
      sodium: { field: 'sodium_mg', green_max: 120, amber_max: 600 },
      sugar: { field: 'sugar_g', green_max: 5, amber_max: 22.5 },
      fat: { field: 'fat_g', green_max: 3, amber_max: 17.5 },
      saturated_fat: { field: 'saturated_fat_g', green_max: 1.5, amber_max: 5 },
    },
  };
  test('chips: red sodium and fat -> overall RED', () => {
    const r = evaluateNutrients({ sodium_mg: 680, sugar_g: 3, fat_g: 34, saturated_fat_g: 12 }, rules);
    expect(r.sodium).toBe('RED');
    expect(r.sugar).toBe('GREEN');
    expect(r.overall).toBe('RED');
  });
  test('boundaries: exactly green_max is GREEN, exactly amber_max is AMBER', () => {
    const r = evaluateNutrients({ sodium_mg: 120, sugar_g: 22.5, fat_g: 3, saturated_fat_g: 1.5 }, rules);
    expect(r.sodium).toBe('GREEN');
    expect(r.sugar).toBe('AMBER');
  });
  test('missing sodium -> UNKNOWN (never GREEN)', () => {
    const r = evaluateNutrients({ sugar_g: 2, fat_g: 2, saturated_fat_g: 1 }, rules);
    expect(r.sodium).toBe('UNKNOWN');
    expect(r.missing).toContain('sodium');
    expect(r.overall).toBe('GREEN');
  });
  test('all missing -> overall UNKNOWN', () => {
    expect(evaluateNutrients({}, rules).overall).toBe('UNKNOWN');
  });
  test('the real rules.json loads and is valid', () => {
    expect(() => evaluateNutrients({ sodium_mg: 100 })).not.toThrow();
  });
  test('broken thresholds are rejected', () => {
    expect(() => validateRules({ nutrients: { sodium: { field: 'sodium_mg', green_max: 600, amber_max: 120 } } })).toThrow();
  });
});

describe('Error message mapping', () => {
  test('sanity failure -> blurry message', () => expect(userMessageFor({ code: 'SANITY_FAILED' })).toBe(MESSAGES.BLURRY));
  test('not a label -> not-a-label message', () => expect(userMessageFor({ code: 'NOT_A_LABEL' })).toBe(MESSAGES.NOT_A_LABEL));
  test('unknown error -> server error (no leaks)', () => {
    expect(userMessageFor(new Error('db password wrong'))).toBe(MESSAGES.SERVER_ERROR);
  });
});
