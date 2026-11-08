'use strict';
const { remember, productKey, median, memoryStore, MAX_READINGS } = require('../src/services/productMemory');
const { runPipeline } = require('../src/services/pipeline');
const { normalizeExtraction } = require('../src/services/extractNutrients');

const id = { brand: 'Mr. Twist', product_name: 'Potato Crackers', net_weight_g: 22 };

describe('Product key', () => {
  test('same product with different spacing/case -> same key', () => {
    expect(productKey(id)).toBe(productKey({ brand: 'MR TWIST', product_name: 'potato-crackers ', net_weight_g: 22 }));
  });
  test('different pack size -> different key', () => {
    expect(productKey(id)).not.toBe(productKey({ ...id, net_weight_g: 50 }));
  });
  test('Bangla names work', () => {
    expect(productKey({ brand: 'প্রাণ', product_name: 'চানাচুর', net_weight_g: 150 })).toContain('চানাচুর');
  });
  test('no product name -> not cached', () => {
    expect(productKey({ brand: 'X', product_name: null })).toBeNull();
  });
});

describe('Median', () => {
  test('odd count', () => expect(median([700, 650, 900])).toBe(700));
  test('even count', () => expect(median([600, 700])).toBe(650));
  test('ignores nulls', () => expect(median([null, 5, undefined, 7, 6])).toBe(6));
});

describe('Consistency across repeat scans', () => {
  test('one bad AI reading is outvoted by the median', async () => {
    const store = memoryStore();
    await remember(store, id, { sodium_mg: 680, fat_g: 34 });
    await remember(store, id, { sodium_mg: 690, fat_g: 34 });
    const third = await remember(store, id, { sodium_mg: 2100, fat_g: 3.4 }); // misread
    expect(third.per100g.sodium_mg).toBe(690);
    expect(third.per100g.fat_g).toBe(34);
    expect(third.scanCount).toBe(3);
  });

  test('keeps only the last readings', async () => {
    const store = memoryStore();
    for (let i = 0; i < 9; i++) await remember(store, id, { sodium_mg: 600 + i });
    const doc = await store.findByKey(productKey(id));
    expect(doc.readings).toHaveLength(MAX_READINGS);
  });

  test('full pipeline: same product scanned with noisy reads gives the SAME colours', async () => {
    const store = memoryStore();
    const reads = [680, 640, 720, 655, 700]; // AI noise around the true value
    const outcomes = [];
    for (const sodium of reads) {
      const out = await runPipeline({}, {}, {
        productStore: store,
        picker: async () => ({ swap: 'মুড়ি' }),
        extract: async () => normalizeExtraction({
          label_found: true, basis: 'per_100g', product_name: 'Potato Crackers', brand: 'Mr. Twist', net_weight_g: 22,
          energy_kcal: 536, protein_g: 6, carbs_g: 55, fat_g: 34, saturated_fat_g: 12, sugar_g: 3, sodium_mg: sodium,
        }),
      });
      outcomes.push(out);
    }
    // After 3 scans the answer settles on the median
    expect(outcomes[2].per100g.sodium_mg).toBe(680);
    expect(new Set(outcomes.map((o) => o.ruleResults.overall)).size).toBe(1);
    expect(outcomes[4].product.scan_count).toBe(5);
  });

  test('store failure never blocks the user result', async () => {
    const broken = { findByKey: async () => { throw new Error('db down'); }, upsert: async () => {} };
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const out = await runPipeline({}, {}, {
      productStore: broken,
      picker: async () => ({ swap: 'মুড়ি' }),
      extract: async () => normalizeExtraction({ label_found: true, basis: 'per_100g', product_name: 'X chips', sodium_mg: 100, fat_g: 2, sugar_g: 1, saturated_fat_g: 1 }),
    });
    expect(out.ruleResults.overall).toBe('GREEN');
  });
});

describe('Product text from AI is cleaned', () => {
  test('markup and huge strings are stripped', () => {
    const n = normalizeExtraction({ product_name: '<script>alert(1)</script>Chips', brand: 'x'.repeat(500) });
    expect(n.product_name).not.toMatch(/[<>]/);
    expect(n.brand.length).toBeLessThanOrEqual(80);
  });
});
