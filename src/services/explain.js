'use strict';
const { Type } = require('@google/genai');
const { generateJson } = require('./geminiClient');

// EXACT templates from the spec.
// ⚠ Team to confirm: "এত লবণ" may be intended as "এতে লবণ".
const TEMPLATES = {
  RED_SALT: '● এত লবণ অনেক বেশি। প্রায় {x} চা-চামচ লবণ। চেষ্টা করুন: {swap}।',
  RED_SUGAR_TIFFIN: '● বাচ্চার টিফিনের জন্য এতে চিনি বেশি। ফল বা {swap} ভালো বিকল্প।',
  AMBER: '● মাঝারি। মাঝে মাঝে খাওয়া যায়, প্রতিদিন নয়।',
  GREEN: '● লবণ, চিনি ও চর্বি তুলনামূলক কম। ভালো পছন্দ!',
  LABEL_ISSUE: '△ এই প্যাকেটে সোডিয়ামের তথ্য নেই। লেবেল অসম্পূর্ণ।',
};
const BASIS_NOTE = '(প্রতি ১০০ গ্রাম হিসেবে)';

// Gemini may ONLY choose from this approved list.
const SWAP_OPTIONS = ['মুড়ি', 'ভাজা ছোলা', 'বাদাম (লবণ ছাড়া)', 'মৌসুমি ফল', 'দই (চিনি ছাড়া)', 'ঘরে বানানো চিড়া'];
const DEFAULT_SWAP = 'মুড়ি';

const SWAP_SCHEMA = {
  type: Type.OBJECT,
  properties: { swap: { type: Type.STRING, enum: SWAP_OPTIONS } },
  required: ['swap'],
};
const SWAP_SYSTEM = `
You choose ONE healthier Bangladeshi snack swap from the allowed enum list.
Input is structured data only. Never add advice, medical claims, or text outside the schema.
`.trim();

/** Ask Gemini for a swap; any failure -> safe default (never blocks the reply). */
async function pickSwap(ruleResults, reason, picker = generateJson) {
  try {
    const out = await picker({
      systemInstruction: SWAP_SYSTEM,
      responseSchema: SWAP_SCHEMA,
      parts: [{
        text: JSON.stringify({
          reason,
          ratings: {
            sodium: ruleResults.sodium,
            sugar: ruleResults.sugar,
            fat: ruleResults.fat,
            saturated_fat: ruleResults.saturated_fat,
          },
        }),
      }],
    });
    return out && SWAP_OPTIONS.includes(out.swap) ? out.swap : DEFAULT_SWAP;
  } catch {
    return DEFAULT_SWAP;
  }
}

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
function toBanglaNumber(n) {
  const s = Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 });
  return s.replace(/\d/g, (d) => BN_DIGITS[d]);
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
}

/** Build the Bangla reply. Colours come ONLY from the rule engine. */
async function buildBanglaExplanation(ruleResults, per100g, { mode = 'general', picker } = {}) {
  const lines = [];

  if (ruleResults.sodium === 'UNKNOWN') lines.push(TEMPLATES.LABEL_ISSUE);

  if (ruleResults.sodium === 'RED') {
    const tsp = per100g.salt_g != null ? per100g.salt_g / 5 : null;
    const swap = await pickSwap(ruleResults, 'salt', picker);
    lines.push(fill(TEMPLATES.RED_SALT, { x: tsp != null ? toBanglaNumber(tsp) : '?', swap }));
  }

  if (ruleResults.sugar === 'RED' && mode === 'tiffin') {
    const swap = await pickSwap(ruleResults, 'sugar', picker);
    lines.push(fill(TEMPLATES.RED_SUGAR_TIFFIN, { swap }));
  }

  const anyRed = ['sodium', 'sugar', 'fat', 'saturated_fat'].some((k) => ruleResults[k] === 'RED');
  const hasVerdict = lines.some((l) => l.startsWith('●'));
  if (!anyRed) {
    if (ruleResults.overall === 'GREEN') lines.push(TEMPLATES.GREEN);
    else if (ruleResults.overall === 'AMBER') lines.push(TEMPLATES.AMBER);
  } else if (!hasVerdict) {
    // RED only in fat/sugar (general mode): no spec template -> safe AMBER-style advice.
    lines.push(TEMPLATES.AMBER);
  }

  lines.push(BASIS_NOTE);
  return lines.join('\n');
}

module.exports = { buildBanglaExplanation, pickSwap, TEMPLATES, SWAP_OPTIONS, DEFAULT_SWAP, toBanglaNumber };
