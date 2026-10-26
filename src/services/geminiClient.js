'use strict';
const { GoogleGenAI } = require('@google/genai');

const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 45000;
let ai = null;
function getClient() {
  if (!ai) ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return ai;
}
const model = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';

class GeminiError extends Error {
  constructor(message) {
    super(message);
    this.code = 'GEMINI_FAILED';
  }
}

/**
 * Call Gemini and return parsed JSON.
 * Pattern (@google/genai): ai.models.generateContent({ model, contents, config }) -> response.text
 * (`text` is a getter in current versions; the function form is handled as a fallback.)
 */
async function generateJson({ parts, systemInstruction, responseSchema }) {
  const call = getClient().models.generateContent({
    model: model(),
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema,
      temperature: 0,
      // Newer models 'think' before answering and that counts against this limit,
      // so keep it generous or the JSON answer comes back empty.
      maxOutputTokens: 8192,
    },
  });

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new GeminiError('Gemini timeout')), TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([call, timeout]);
    const text = typeof response.text === 'function' ? response.text() : response.text;
    if (!text) {
      const finish = response?.candidates?.[0]?.finishReason || 'unknown';
      throw new GeminiError(`Empty Gemini response (finishReason: ${finish})`);
    }
    return JSON.parse(text);
  } catch (err) {
    if (err instanceof GeminiError) {
      console.error('[gemini]', err.message, '| model:', model());
      throw err;
    }
    // Log the API's reason (e.g. invalid key, unknown model, quota) — never image/user content.
    const status = err.status || err.code || '';
    const reason = String(err.message || err.name).slice(0, 300);
    console.error('[gemini] call failed:', status, reason, '| model:', model());
    throw new GeminiError(`Gemini call failed: ${err.name}`);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { generateJson, GeminiError };
