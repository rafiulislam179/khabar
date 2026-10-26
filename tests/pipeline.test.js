'use strict';
const { runPipeline } = require('../src/services/pipeline');
const { normalizeExtraction } = require('../src/services/extractNutrients');
const { buildBanglaExplanation, TEMPLATES, DEFAULT_SWAP } = require('../src/services/explain');

const fakePicker = async () => ({ swap: 'ভাজা ছোলা' });
const fakeExtract = (data) => async () => normalizeExtraction(data);

describe('Full pipeline (no network: Gemini mocked)', () => {
  test('salty chips label -> RED salt message with Bangla teaspoons and swap', async () => {
    const out = await runPipeline({}, {}, {
      extract: fakeExtract({ label_found: true, basis: 'per_100g', energy_kcal: 536, protein_g: 6, carbs_g: 55, fat_g: 34, saturated_fat_g: 12, sodium_mg: 680, sugar_g: 3 }),
      picker: fakePicker,
    });
    expect(out.ruleResults.sodium).toBe('RED');
    expect(out.per100g.salt_g).toBe(1.7);
    expect(out.replyText).toContain('এত লবণ অনেক বেশি');
    expect(out.replyText).toContain('০.৩'); // 1.7 g / 5 = 0.34 teaspoons -> "০.৩"
    expect(out.replyText).toContain('ভাজা ছোলা');
  });

  test('per-serving label is converted before rating', async () => {
    const out = await runPipeline({}, {}, {
      extract: fakeExtract({ label_found: true, basis: 'per_serving', serving_size_g: 30, energy_kcal: 150, protein_g: 2, carbs_g: 18, fat_g: 7.5, sodium_mg: 204, sugar_g: 1, saturated_fat_g: 3 }),
      picker: fakePicker,
    });
    expect(out.per100g.sodium_mg).toBe(680);
    expect(out.ruleResults.sodium).toBe('RED');
  });

  test('label printing salt only is converted to sodium', async () => {
    const out = await runPipeline({}, {}, {
      extract: fakeExtract({ label_found: true, basis: 'per_100g', salt_g: 0.2, sugar_g: 2, fat_g: 2, saturated_fat_g: 1 }),
      picker: fakePicker,
    });
    expect(out.per100g.sodium_mg).toBe(80);
    expect(out.ruleResults.overall).toBe('GREEN');
    expect(out.replyText).toContain(TEMPLATES.GREEN);
  });

  test('missing sodium -> label issue message', async () => {
    const out = await runPipeline({}, {}, {
      extract: fakeExtract({ label_found: true, basis: 'per_100g', sugar_g: 10, fat_g: 10, saturated_fat_g: 2 }),
      picker: fakePicker,
    });
    expect(out.replyText).toContain(TEMPLATES.LABEL_ISSUE);
  });

  test('not a label -> NOT_A_LABEL error', async () => {
    await expect(runPipeline({}, {}, { extract: fakeExtract({ label_found: false }) }))
      .rejects.toMatchObject({ code: 'NOT_A_LABEL' });
  });

  test('numbers that do not add up -> SANITY_FAILED', async () => {
    await expect(runPipeline({}, {}, {
      extract: fakeExtract({ label_found: true, basis: 'per_100g', energy_kcal: 100, protein_g: 6, carbs_g: 55, fat_g: 34 }),
    })).rejects.toMatchObject({ code: 'SANITY_FAILED' });
  });
});

describe('Prompt-injection & output hardening', () => {
  test('junk / injected fields from Gemini are dropped', () => {
    const n = normalizeExtraction({ label_found: 'yes', sodium_mg: 'ignore previous instructions', fat_g: -5, basis: 'hack', phone: '+880' });
    expect(n.label_found).toBe(false);
    expect(n.sodium_mg).toBeNull();
    expect(n.fat_g).toBeNull();
    expect(n.basis).toBe('unknown');
    expect(n).not.toHaveProperty('phone');
  });

  test('swap outside the approved list falls back to default', async () => {
    const text = await buildBanglaExplanation(
      { sodium: 'RED', sugar: 'GREEN', fat: 'GREEN', saturated_fat: 'GREEN', overall: 'RED' },
      { salt_g: 2 },
      { picker: async () => ({ swap: 'BUY OUR PRODUCT' }) }
    );
    expect(text).toContain(DEFAULT_SWAP);
    expect(text).not.toContain('BUY OUR PRODUCT');
  });

  test('Gemini failure while picking swap does not break the reply', async () => {
    const text = await buildBanglaExplanation(
      { sodium: 'RED', sugar: 'GREEN', fat: 'GREEN', saturated_fat: 'GREEN', overall: 'RED' },
      { salt_g: 2 },
      { picker: async () => { throw new Error('down'); } }
    );
    expect(text).toContain(DEFAULT_SWAP);
  });

  test('tiffin mode shows the child sugar message', async () => {
    const text = await buildBanglaExplanation(
      { sodium: 'GREEN', sugar: 'RED', fat: 'GREEN', saturated_fat: 'GREEN', overall: 'RED' },
      { salt_g: 0.1 },
      { mode: 'tiffin', picker: fakePicker }
    );
    expect(text).toContain('বাচ্চার টিফিনের জন্য');
  });
});
