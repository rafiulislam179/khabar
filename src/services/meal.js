'use strict';
/**
 * Cooked-meal estimate (restaurant / home food).
 * The AI only NAMES dishes (from a fixed list) and guesses a portion size.
 * All calories and colours come from dishes.json + fixed rules here, never from the AI.
 * Numbers are shown as RANGES because photo-only estimates are rough.
 */
const DATA = require('../config/dishes.json');

const BY_ID = new Map(DATA.dishes.map((d) => [d.id, d]));
const PORTIONS = ['small', 'medium', 'large'];
const MAX_DISHES = 6;
const LEVEL_BN = { low: 'কম', med: 'মাঝারি', high: 'বেশি' };

function round10(n) { return Math.round(n / 10) * 10; }

/** kcal range for a dish at a portion (or explicit piece count). */
function kcalRange(dish, portion, pieces) {
  const idx = Math.max(0, PORTIONS.indexOf(portion));
  let amount = dish.portions[idx];
  if (dish.unit === 'piece' && Number.isInteger(pieces) && pieces >= 1 && pieces <= 20) amount = pieces;
  const factor = dish.unit === 'g' ? amount / 100 : amount;
  return { min: round10(dish.kcal[0] * factor), max: round10(dish.kcal[1] * factor), amount };
}

/** Fixed rule: 2+ "high" = RED, 1 high or 2+ "med" = AMBER, else GREEN. */
function dishVerdict(dish) {
  const lv = [dish.salt, dish.oil, dish.sugar];
  const highs = lv.filter((x) => x === 'high').length;
  const meds = lv.filter((x) => x === 'med').length;
  if (highs >= 2) return 'RED';
  if (highs === 1 || meds >= 2) return 'AMBER';
  return 'GREEN';
}

const RANK = { GREEN: 0, AMBER: 1, RED: 2 };

function tipFor(items) {
  const known = items.filter((i) => i.known);
  if (known.some((i) => i.oil === 'high')) return 'তেল বেশি — পরের বেলা ভাজা খাবার বাদ দিন, সাথে সালাদ/শসা খান।';
  if (known.some((i) => i.sugar === 'high')) return 'চিনি বেশি — মিষ্টি অর্ধেক করুন, পরে পানি খান।';
  if (known.some((i) => i.salt === 'high')) return 'লবণ বেশি — আজ বাড়তি লবণ/আচার নয়, পানি বেশি খান।';
  return 'ভালো পছন্দ! প্লেটের অর্ধেক সবজি রাখার চেষ্টা করুন।';
}

/** Build the meal result from the AI's dish list. Unknown dishes are listed without numbers. */
function estimateMeal(dishes) {
  const list = (Array.isArray(dishes) ? dishes : []).slice(0, MAX_DISHES);
  const items = [];
  for (const d of list) {
    const dish = BY_ID.get(d && d.dish_id);
    const portion = PORTIONS.includes(d && d.portion) ? d.portion : 'medium';
    if (!dish) {
      const name = d && typeof d.other_name === 'string' ? d.other_name : null;
      items.push({ id: 'other', known: false, name: name || 'অচেনা খাবার', portion });
      continue;
    }
    const pieces = Number.isInteger(d.pieces) ? d.pieces : null;
    const r = kcalRange(dish, portion, pieces);
    items.push({
      id: dish.id, known: true, name: dish.bn, unit: dish.unit, portion, amount: r.amount,
      portions: dish.portions, kcal_per_unit: dish.kcal,
      kcal_min: r.min, kcal_max: r.max,
      salt: dish.salt, oil: dish.oil, sugar: dish.sugar, verdict: dishVerdict(dish),
    });
  }
  if (!items.length) return null;
  const known = items.filter((i) => i.known);
  const overall = known.length
    ? known.reduce((w, i) => (RANK[i.verdict] > RANK[w] ? i.verdict : w), 'GREEN')
    : 'UNKNOWN';
  const total = {
    min: known.reduce((s, i) => s + i.kcal_min, 0),
    max: known.reduce((s, i) => s + i.kcal_max, 0),
  };
  return { items, overall, total, tip: tipFor(items), dishes_version: DATA.version };
}

module.exports = { estimateMeal, kcalRange, dishVerdict, DISH_IDS: [...BY_ID.keys()], LEVEL_BN, PORTIONS };
