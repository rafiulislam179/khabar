'use strict';
const { generateJson, modelList, __setClientForTests } = require('../src/services/geminiClient');

const req = { parts: [{ text: 'x' }], systemInstruction: 's', responseSchema: {} };
const busy = () => Object.assign(new Error('{"error":{"code":503,"message":"high demand"}}'), {});

beforeAll(() => {
  process.env.GEMINI_MODEL = 'primary-model';
  process.env.GEMINI_FALLBACK_MODELS = 'backup-model';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

test('model list: primary first, then backups, no duplicates', () => {
  expect(modelList()).toEqual(['primary-model', 'backup-model']);
});

test('retries the same model after a 503 and succeeds', async () => {
  let calls = 0;
  __setClientForTests({ models: { generateContent: async () => {
    calls++;
    if (calls === 1) throw busy();
    return { text: '{"ok":true}' };
  } } });
  await expect(generateJson(req)).resolves.toEqual({ ok: true });
  expect(calls).toBe(2);
}, 10000);

test('falls back to the backup model when the primary stays busy', async () => {
  const used = [];
  __setClientForTests({ models: { generateContent: async ({ model }) => {
    used.push(model);
    if (model === 'primary-model') throw busy();
    return { text: '{"ok":"backup"}' };
  } } });
  await expect(generateJson(req)).resolves.toEqual({ ok: 'backup' });
  expect(used).toEqual(['primary-model', 'primary-model', 'backup-model']);
}, 10000);

test('a bad API key (400) is not retried on the same model', async () => {
  const used = [];
  __setClientForTests({ models: { generateContent: async ({ model }) => {
    used.push(model);
    throw Object.assign(new Error('API key not valid'), { status: 400 });
  } } });
  await expect(generateJson(req)).rejects.toMatchObject({ code: 'GEMINI_FAILED' });
  expect(used).toEqual(['primary-model', 'backup-model']);
});
