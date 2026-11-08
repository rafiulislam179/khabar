'use strict';
const A = require('../public/advisor');
const { estimateMeal } = require('../src/services/meal');

describe('profile cleaning (phone storage is not trusted)', () => {
  test('junk -> safe defaults', () => {
    expect(A.cleanProfile(null)).toEqual({ goals: [], sex: 'skip', activity: 'med' });
    expect(A.cleanProfile({ goals: ['hack', 'salt', 'salt'], sex: 'x', activity: 9 })).toEqual({ goals: ['salt'], sex: 'skip', activity: 'med' });
  });
  test('max 3 goals', () => {
    expect(A.cleanProfile({ goals: ['weight', 'salt', 'sugar', 'heart'] }).goals).toHaveLength(3);
  });
});

describe('daily budget', () => {
  test('values', () => {
    expect(A.dailyBudget({})).toBe(2100);
    expect(A.dailyBudget({ sex: 'male', activity: 'high' })).toBe(2700);
    expect(A.dailyBudget({ sex: 'female', activity: 'low', goals: ['weight'] })).toBe(1400);
  });
  test('never below 1400', () => {
    expect(A.dailyBudget({ sex: 'female', activity: 'low', goals: ['weight'] })).toBeGreaterThanOrEqual(1400);
  });
});

describe('label advice', () => {
  const chips = { sodium: 'RED', sugar: 'GREEN', fat: 'RED', saturated_fat: 'RED' };
  test('no goals -> null', () => expect(A.adviseLabel({}, chips)).toBeNull());
  test('salt goal + salty chips -> RED mentions লবণ', () => {
    const r = A.adviseLabel({ goals: ['salt'] }, chips);
    expect(r.verdict).toBe('RED');
    expect(r.lines[0]).toContain('লবণ');
  });
  test('sugar goal + low-sugar chips -> GREEN', () => {
    expect(A.adviseLabel({ goals: ['sugar'] }, chips).verdict).toBe('GREEN');
  });
  test('weight goal: high-calorie but green ratings -> AMBER', () => {
    const g = { sodium: 'GREEN', sugar: 'GREEN', fat: 'GREEN', saturated_fat: 'GREEN' };
    const r = A.adviseLabel({ goals: ['weight'] }, g, { energy_kcal: 500 });
    expect(r.verdict).toBe('AMBER');
    expect(r.lines[0]).toContain('ক্যালরি');
  });
  test('all UNKNOWN ratings -> UNKNOWN, no crash', () => {
    const u = { sodium: 'UNKNOWN', sugar: 'UNKNOWN', fat: 'UNKNOWN', saturated_fat: 'UNKNOWN' };
    const r = A.adviseLabel({ goals: ['salt', 'sugar'] }, u, {});
    expect(r.verdict).toBe('UNKNOWN');
    expect(r.lines).toHaveLength(2);
  });
  test('missing ratings object does not crash', () => {
    expect(A.adviseLabel({ goals: ['heart'] }, undefined).verdict).toBe('UNKNOWN');
  });
});

describe('meal advice', () => {
  test('rice + dal for sugar goal -> GREEN', () => {
    const meal = estimateMeal([{ dish_id: 'rice', portion: 'medium' }, { dish_id: 'dal', portion: 'medium' }]);
    expect(A.adviseMeal({ goals: ['sugar'] }, meal, meal.total.max).verdict).toBe('GREEN');
  });
  test('jilapi for sugar goal -> RED', () => {
    const meal = estimateMeal([{ dish_id: 'jilapi', portion: 'medium' }]);
    const r = A.adviseMeal({ goals: ['sugar'] }, meal, meal.total.max);
    expect(r.verdict).toBe('RED');
    expect(r.lines[0]).toContain('চিনি');
  });
  test('large biryani for weight goal -> RED + per-meal limit line', () => {
    const meal = estimateMeal([{ dish_id: 'biryani', portion: 'large' }]);
    const r = A.adviseMeal({ goals: ['weight'] }, meal, meal.total.max);
    expect(r.verdict).toBe('RED');
    expect(r.lines.join(' ')).toContain('এক বেলার');
  });
  test('weight goal: small low-oil meal under budget -> GREEN', () => {
    const meal = estimateMeal([{ dish_id: 'ruti', portion: 'small' }, { dish_id: 'salad', portion: 'small' }]);
    expect(A.adviseMeal({ goals: ['weight'] }, meal, meal.total.max).verdict).toBe('GREEN');
  });
  test('only unknown dishes -> UNKNOWN', () => {
    const meal = estimateMeal([{ dish_id: 'other', portion: 'small' }]);
    expect(A.adviseMeal({ goals: ['salt'] }, meal, NaN).verdict).toBe('UNKNOWN');
  });
  test('no goals -> null', () => expect(A.adviseMeal({}, estimateMeal([{ dish_id: 'rice', portion: 'small' }]), 200)).toBeNull());
});

describe("today's log", () => {
  const now = new Date(2026, 10, 8, 13);
  test('old day resets', () => {
    expect(A.cleanLog({ date: '2026-11-07', items: [{ name: 'x', min: 1, max: 2 }] }, now).items).toEqual([]);
  });
  test('junk items dropped, total sums', () => {
    const log = A.cleanLog({ date: '2026-11-08', items: [{ name: 'a', min: 100, max: 200 }, { min: -5, max: 3 }, { min: 'x' }, null, { name: 'b', min: 300, max: 400 }] }, now);
    expect(log.items).toHaveLength(2);
    expect(A.logTotal(log)).toEqual({ min: 400, max: 600 });
  });
  test('garbage log -> empty', () => expect(A.cleanLog('nope', now).items).toEqual([]));
});
