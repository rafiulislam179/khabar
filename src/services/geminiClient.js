'use strict';
const { GoogleGenAI } = require('@google/genai');

const TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 45000;
// If Google is busy (503) or rate-limits (429), wait and retry, then try backup models.
const RETRYABLE = new Set([429, 500, 503, 504]);
const RETRIES_PER_MODEL = 2;

let ai = null;
function getClient() {
  if (!ai) ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return ai;
}
// For tests only.
function __setClientForTests(fake) {
  ai = fake;
}

/** Primary model first, then comma-separated backups from GEMINI_FALLBACK_MODELS. */
function modelList() {
  const primary = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
  const backups = (process.env.GEMINI_FALLBACK_MODELS || 'gemini-flash-latest,gemini-flash-lite-latest')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([primary, ...backups])];
}

class GeminiError extends Error {
  constructor(message) {
    super(message);
    this.code = 'GEMINI_FAILED';
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function statusOf(err) {
  const s = Number(err && (err.status || err.code));
  if (Number.isFinite(s)) return s;
  const m = /"code"\s*:\s*(\d{3})/.exec(String(err && err.message));
  return m ? Number(m[1]) : 0;
}

async function callOnce(model, { parts, systemInstruction, responseSchema }) {
  const call = getClient().models.generateContent({
    model,
    contents: [{ role: 'user', parts }],
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema,
      temperature: 0,
      // Newer models "think" first and that counts against this limit; keep it generous.
      maxOutputTokens: 8192,
    },
  });

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { status: 504 })), TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([call, timeout]);
    const text = typeof response.text === 'function' ? response.text() : response.text;
    if (!text) {
      const finish = response?.candidates?.[0]?.finishReason || 'unknown';
      throw Object.assign(new Error(`Empty response (finishReason: ${finish})`), { status: 0 });
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call Gemini and return parsed JSON, with retries + model fallback.
 * Logs the API's reason (status/message) but never image or user content.
 */
async function generateJson(request) {
  let lastErr;
  for (const model of modelList()) {
    for (let attempt = 1; attempt <= RETRIES_PER_MODEL; attempt++) {
      try {
        return await callOnce(model, request);
      } catch (err) {
        lastErr = err;
        const status = statusOf(err);
        const reason = String(err.message || err.name).slice(0, 200);
        console.error(`[gemini] ${model} attempt ${attempt} failed:`, status || '', reason);

        if (!RETRYABLE.has(status)) break; // e.g. bad key (400/403) or not found (404): try next model / stop
        if (attempt < RETRIES_PER_MODEL) await sleep(1500 * attempt);
      }
    }
  }
  throw new GeminiError(`Gemini failed on all models: ${lastErr ? lastErr.name : 'unknown'}`);
}

module.exports = { generateJson, GeminiError, modelList, __setClientForTests };
