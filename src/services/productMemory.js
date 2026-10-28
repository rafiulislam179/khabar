'use strict';
/**
 * Product memory: makes repeat scans of the same product consistent.
 * - Identity key = brand + name + pack weight (normalised).
 * - Keeps the last MAX_READINGS label readings (per 100 g).
 * - The answer shown is the MEDIAN of stored readings per nutrient, so one bad AI read
 *   can't swing the result, and the value settles after a few scans.
 */
const MAX_READINGS = 5;
const FIELDS = ['energy_kcal', 'protein_g', 'carbs_g', 'fat_g', 'saturated_fat_g', 'sugar_g', 'sodium_mg', 'salt_g'];

function normalise(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '') // drop spaces/punctuation, keep Bangla + English letters/digits
    .slice(0, 80);
}

/** Returns null if we can't identify the product reliably (then nothing is cached). */
function productKey({ brand, product_name, net_weight_g }) {
  const b = normalise(brand);
  const n = normalise(product_name);
  if (!n || n.length < 2) return null;
  const w = Number.isFinite(net_weight_g) && net_weight_g > 0 ? Math.round(net_weight_g) : 'na';
  return `${b || 'nobrand'}|${n}|${w}`;
}

function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round(((v[mid - 1] + v[mid]) / 2) * 100) / 100;
}

/** Median per field across readings. */
function consensus(readings) {
  const out = {};
  for (const f of FIELDS) out[f] = median(readings.map((r) => r[f]));
  return out;
}

function pickReading(per100g) {
  const r = {};
  for (const f of FIELDS) r[f] = Number.isFinite(per100g[f]) ? per100g[f] : null;
  return r;
}

/**
 * store: { findByKey(key) -> doc|null, upsert(key, update) -> doc }
 * Returns { per100g (consensus), scanCount, key } or null if product not identifiable.
 */
async function remember(store, identity, per100g) {
  const key = productKey(identity);
  if (!key) return null;

  const existing = await store.findByKey(key);
  const readings = [...((existing && existing.readings) || []), pickReading(per100g)].slice(-MAX_READINGS);
  const scanCount = ((existing && existing.scan_count) || 0) + 1;

  await store.upsert(key, {
    brand: identity.brand ? String(identity.brand).slice(0, 80) : null,
    name: String(identity.product_name).slice(0, 120),
    net_weight_g: Number.isFinite(identity.net_weight_g) ? identity.net_weight_g : null,
    readings,
    scan_count: scanCount,
    last_seen: new Date(),
  });

  const agreed = consensus(readings);
  // Keep any field the consensus couldn't fill from this scan.
  const merged = { ...per100g };
  for (const f of FIELDS) if (agreed[f] != null) merged[f] = agreed[f];
  return { per100g: merged, scanCount, key };
}

/** MongoDB-backed store. */
function mongoStore(Product) {
  return {
    findByKey: (key) => Product.findOne({ key }).lean(),
    upsert: (key, update) =>
      Product.findOneAndUpdate(
        { key },
        { $set: update, $setOnInsert: { key, first_seen: new Date() } },
        { upsert: true, new: true, runValidators: true }
      ).lean(),
  };
}

/** In-memory store (tests / fallback). */
function memoryStore() {
  const m = new Map();
  return {
    findByKey: async (key) => m.get(key) || null,
    upsert: async (key, update) => {
      const doc = { ...(m.get(key) || { key }), ...update };
      m.set(key, doc);
      return doc;
    },
  };
}

module.exports = { remember, productKey, consensus, median, mongoStore, memoryStore, MAX_READINGS };
