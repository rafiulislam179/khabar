'use strict';
/**
 * Personal goals advisor (runs on the phone; goals are stored ONLY on this phone).
 * Pure functions, fixed rules — no AI decides the advice. Not medical advice.
 */
(function (root) {
  const GOALS = {
    weight: { bn: 'ওজন কমানো', icon: '⚖️' },
    salt: { bn: 'লবণ কমানো (প্রেশার)', icon: '🧂' },
    sugar: { bn: 'চিনি কমানো (ডায়াবেটিস)', icon: '🍬' },
    heart: { bn: 'হার্ট ভালো রাখা (তেল/চর্বি কম)', icon: '❤️' },
    healthy: { bn: 'সাধারণ সুস্থ থাকা', icon: '🌿' },
  };
  const RANK = { GREEN: 0, AMBER: 1, RED: 2 };
  const LEVEL_TO_RATING = { low: 'GREEN', med: 'AMBER', high: 'RED' };

  const BN = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
  const bn = (n) => String(Math.round(n)).replace(/\d/g, (d) => BN[d]);

  /** Keep only valid values (data from localStorage is not trusted). */
  function cleanProfile(p) {
    const r = p && typeof p === 'object' ? p : {};
    const goals = Array.isArray(r.goals) ? [...new Set(r.goals.filter((g) => GOALS[g]))].slice(0, 3) : [];
    return {
      goals,
      sex: ['male', 'female'].includes(r.sex) ? r.sex : 'skip',
      activity: ['low', 'med', 'high'].includes(r.activity) ? r.activity : 'med',
    };
  }

  /** Rough adult daily calorie guide. Shown as "approx", never as a prescription. */
  function dailyBudget(profile) {
    const p = cleanProfile(profile);
    let kcal = { male: 2400, female: 1900, skip: 2100 }[p.sex];
    kcal += { low: -200, med: 0, high: 300 }[p.activity];
    if (p.goals.includes('weight')) kcal -= 400;
    return Math.max(1400, Math.round(kcal / 50) * 50);
  }

  // Which nutrients matter for which goal.
  const LABEL_KEYS = { weight: ['fat', 'sugar'], salt: ['sodium'], sugar: ['sugar'], heart: ['fat', 'saturated_fat', 'sodium'], healthy: ['sodium', 'sugar', 'fat'] };
  const MEAL_KEYS = { weight: ['oil', 'sugar'], salt: ['salt'], sugar: ['sugar'], heart: ['oil', 'salt'], healthy: ['salt', 'oil', 'sugar'] };
  const NAME = { sodium: 'লবণ', salt: 'লবণ', sugar: 'চিনি', fat: 'চর্বি', saturated_fat: 'স্যাচুরেটেড চর্বি', oil: 'তেল' };

  function joinBn(list) {
    const a = [...new Set(list)];
    return a.length <= 1 ? (a[0] || '') : `${a.slice(0, -1).join(', ')} ও ${a[a.length - 1]}`;
  }

  function worst(list) {
    return list.reduce((w, r) => (RANK[r] > RANK[w] ? r : w), 'GREEN');
  }

  function lineFor(goal, rating, what) {
    const g = GOALS[goal].bn;
    if (rating === 'RED') return `${GOALS[goal].icon} ${g}: ${what} বেশি — এড়িয়ে চলাই ভালো।`;
    if (rating === 'AMBER') return `${GOALS[goal].icon} ${g}: ${what} মাঝারি — অল্প পরিমাণে খান।`;
    return `${GOALS[goal].icon} ${g}: ঠিক আছে।`;
  }

  /** Packet label advice. ratings = { sodium, sugar, fat, saturated_fat } (GREEN/AMBER/RED/UNKNOWN). */
  function adviseLabel(profile, ratings, per100g) {
    const p = cleanProfile(profile);
    if (!p.goals.length) return null;
    const r = ratings || {};
    const lines = [];
    const all = [];
    for (const goal of p.goals) {
      const keys = LABEL_KEYS[goal].filter((k) => RANK[r[k]] !== undefined);
      let rating = worst(keys.map((k) => r[k]));
      const bad = keys.filter((k) => r[k] === rating && rating !== 'GREEN').map((k) => NAME[k]);
      if (goal === 'weight' && per100g && Number(per100g.energy_kcal) >= 450 && rating === 'GREEN') {
        rating = 'AMBER'; bad.push('ক্যালরি');
      }
      if (!keys.length && !(goal === 'weight' && per100g && per100g.energy_kcal != null)) {
        lines.push(`${GOALS[goal].icon} ${GOALS[goal].bn}: যথেষ্ট তথ্য নেই।`);
        continue;
      }
      all.push(rating);
      lines.push(lineFor(goal, rating, joinBn(bad)));
    }
    return { verdict: all.length ? worst(all) : 'UNKNOWN', lines };
  }

  /** Plate advice. items = meal.items from the server (known ones have salt/oil/sugar levels + kcal). */
  function adviseMeal(profile, meal, kcalMax) {
    const p = cleanProfile(profile);
    if (!p.goals.length || !meal || !Array.isArray(meal.items)) return null;
    const known = meal.items.filter((i) => i && i.known);
    if (!known.length) return { verdict: 'UNKNOWN', lines: ['এই খাবারগুলোর তথ্য আমাদের তালিকায় নেই।'] };
    const lines = [];
    const all = [];
    for (const goal of p.goals) {
      let rating = 'GREEN';
      const bad = [];
      for (const k of MEAL_KEYS[goal]) {
        const rr = worst(known.map((i) => LEVEL_TO_RATING[i[k]] || 'GREEN'));
        if (RANK[rr] > RANK[rating]) { rating = rr; bad.length = 0; }
        if (rr === rating && rr !== 'GREEN') bad.push(NAME[k]);
      }
      if (goal === 'weight' && Number.isFinite(kcalMax)) {
        const perMeal = dailyBudget(p) / 3;
        if (kcalMax > perMeal * 1.3) { rating = 'RED'; bad.push('ক্যালরি'); }
        else if (kcalMax > perMeal && rating === 'GREEN') { rating = 'AMBER'; bad.push('ক্যালরি'); }
      }
      all.push(rating);
      lines.push(lineFor(goal, rating, joinBn(bad)));
    }
    if (p.goals.includes('weight') && Number.isFinite(kcalMax)) {
      lines.push(`এক বেলার জন্য আনুমানিক ভালো সীমা: ~${bn(dailyBudget(p) / 3)} ক্যালরি।`);
    }
    return { verdict: worst(all), lines };
  }

  /** Today's food log (per phone). Resets automatically on a new day. */
  function todayKey(d) {
    const x = d || new Date();
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  }
  function cleanLog(log, now) {
    const key = todayKey(now);
    if (!log || typeof log !== 'object' || log.date !== key || !Array.isArray(log.items)) return { date: key, items: [] };
    const items = log.items
      .filter((i) => i && Number.isFinite(i.min) && Number.isFinite(i.max) && i.min >= 0 && i.max >= i.min && i.max < 10000)
      .slice(-20)
      .map((i) => ({ name: String(i.name || '').slice(0, 60), min: i.min, max: i.max }));
    return { date: key, items };
  }
  function logTotal(log) {
    return log.items.reduce((t, i) => ({ min: t.min + i.min, max: t.max + i.max }), { min: 0, max: 0 });
  }

  const api = { GOALS, cleanProfile, dailyBudget, adviseLabel, adviseMeal, todayKey, cleanLog, logTotal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KhabarAdvisor = api;
})(typeof self !== 'undefined' ? self : this);
