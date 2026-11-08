'use strict';
const { estimateMeal, kcalRange, dishVerdict } = require('../src/services/meal');
const { runPipeline } = require('../src/services/pipeline');
const { normalizeExtraction } = require('../src/services/extractNutrients');
const { memoryStore, remember } = require('../src/services/productMemory');
const dishes = require('../src/config/dishes.json');

const fakeExtract = (data) => async () => normalizeExtraction(data);
const fakePicker = async () => ({ swap: 'মুড়ি' });

describe('dishes.json data', () => {
  test('every dish is well-formed', () => {
    const ids = new Set();
    for (const d of dishes.dishes) {
      expect(ids.has(d.id)).toBe(false); ids.add(d.id);
      expect(d.portions).toHaveLength(3);
      expect(d.kcal[0]).toBeLessThanOrEqual(d.kcal[1]);
      expect(['g', 'piece']).toContain(d.unit);
      for (const k of ['salt', 'oil', 'sugar']) expect(['low', 'med', 'high']).toContain(d[k]);
      expect(d.bn.length).toBeGreaterThan(0);
    }
  });
});

describe('meal math', () => {
  const rice = dishes.dishes.find((d) => d.id === 'rice');
  const singara = dishes.dishes.find((d) => d.id === 'singara');
  test('grams dish: medium rice 250 g -> 300-340 kcal', () => {
    expect(kcalRange(rice, 'medium')).toEqual({ min: 300, max: 340, amount: 250 });
  });
  test('piece dish uses pieces when given', () => {
    expect(kcalRange(singara, 'small', 3)).toEqual({ min: 480, max: 630, amount: 3 });
  });
  test('bad pieces ignored', () => {
    expect(kcalRange(singara, 'small', 999).amount).toBe(1);
  });
  test('verdict rules', () => {
    expect(dishVerdict({ salt: 'high', oil: 'high', sugar: 'low' })).toBe('RED');
    expect(dishVerdict({ salt: 'high', oil: 'low', sugar: 'low' })).toBe('AMBER');
    expect(dishVerdict({ salt: 'med', oil: 'med', sugar: 'low' })).toBe('AMBER');
    expect(dishVerdict({ salt: 'med', oil: 'low', sugar: 'low' })).toBe('GREEN');
  });
  test('meal total + worst overall + oil tip', () => {
    const m = estimateMeal([{ dish_id: 'rice', portion: 'medium' }, { dish_id: 'biryani', portion: 'large' }]);
    expect(m.overall).toBe('RED');
    expect(m.total.min).toBe(300 + 1000);
    expect(m.tip).toContain('তেল');
  });
  test('unknown dish has no numbers and does not crash', () => {
    const m = estimateMeal([{ dish_id: 'other', other_name: 'কাবাব', portion: 'medium' }]);
    expect(m.items[0]).toMatchObject({ known: false, name: 'কাবাব' });
    expect(m.overall).toBe('UNKNOWN');
    expect(m.total).toEqual({ min: 0, max: 0 });
  });
  test('empty list -> null', () => expect(estimateMeal([])).toBeNull());
});

describe('extraction normalisation (AI output is not trusted)', () => {
  test('label_found forces nutrition_label', () => {
    expect(normalizeExtraction({ kind: 'cooked_meal', label_found: true }).kind).toBe('nutrition_label');
  });
  test('bad kind -> other; junk dish ids -> other; markup stripped', () => {
    const n = normalizeExtraction({ kind: 'cooked_meal', dishes: [{ dish_id: 'DROP TABLE', other_name: '<script>x</script>', portion: 'huge', pieces: -3 }] });
    expect(n.dishes[0]).toEqual({ dish_id: 'other', other_name: 'script x /script', portion: 'medium', pieces: null });
    expect(normalizeExtraction({ kind: 'hack' }).kind).toBe('other');
  });
  test('max 6 dishes', () => {
    const n = normalizeExtraction({ kind: 'cooked_meal', dishes: Array(10).fill({ dish_id: 'rice', portion: 'small' }) });
    expect(n.dishes).toHaveLength(6);
  });
});

describe('smart scan routing', () => {
  test('meal photo -> type meal', async () => {
    const out = await runPipeline({}, {}, { extract: fakeExtract({ kind: 'cooked_meal', dishes: [{ dish_id: 'singara', portion: 'medium', pieces: 2 }] }) });
    expect(out.type).toBe('meal');
    expect(out.meal.items[0].name).toBe('সিঙ্গারা');
    expect(out.meal.overall).toBe('RED');
  });
  test('meal photo with no dishes -> NOTHING_FOUND', async () => {
    await expect(runPipeline({}, {}, { extract: fakeExtract({ kind: 'cooked_meal', dishes: [] }) })).rejects.toMatchObject({ code: 'NOTHING_FOUND' });
  });
  test('oil photo -> OIL_SOON', async () => {
    await expect(runPipeline({}, {}, { extract: fakeExtract({ kind: 'frying_oil' }) })).rejects.toMatchObject({ code: 'OIL_SOON' });
  });
  test('other -> NOTHING_FOUND', async () => {
    await expect(runPipeline({}, {}, { extract: fakeExtract({ kind: 'other' }) })).rejects.toMatchObject({ code: 'NOTHING_FOUND' });
  });
  test('unknown product front -> NEED_BACK_LABEL (never invents numbers)', async () => {
    const productStore = memoryStore();
    await expect(runPipeline({}, {}, { productStore, extract: fakeExtract({ kind: 'product_front', product_name: 'Chips X', brand: 'B' }) }))
      .rejects.toMatchObject({ code: 'NEED_BACK_LABEL' });
  });
  test('known product front -> label result from memory', async () => {
    const productStore = memoryStore();
    const id = { product_name: 'Potato Crackers', brand: 'Bisk', net_weight_g: 25 };
    await remember(productStore, id, { energy_kcal: 536, fat_g: 34, saturated_fat_g: 12, sodium_mg: 680, sugar_g: 3 });
    const out = await runPipeline({}, {}, { productStore, picker: fakePicker, extract: fakeExtract({ kind: 'product_front', ...id }) });
    expect(out.type).toBe('label');
    expect(out.ruleResults.sodium).toBe('RED');
    expect(out.per100g.salt_g).toBe(1.7);
    expect(out.product.from_memory).toBe(true);
  });
  test('product front without name -> NEED_BACK_LABEL', async () => {
    await expect(runPipeline({}, {}, { productStore: memoryStore(), extract: fakeExtract({ kind: 'product_front' }) }))
      .rejects.toMatchObject({ code: 'NEED_BACK_LABEL' });
  });
});
