'use strict';
const mongoose = require('mongoose');

// One record per product (brand + name + pack size). Public product info only — no user data.
const readingSchema = new mongoose.Schema(
  {
    energy_kcal: Number, protein_g: Number, carbs_g: Number, fat_g: Number,
    saturated_fat_g: Number, sugar_g: Number, sodium_mg: Number, salt_g: Number,
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true, maxlength: 200 },
    brand: { type: String, maxlength: 80, default: null },
    name: { type: String, maxlength: 120, default: null },
    net_weight_g: { type: Number, min: 0, max: 100000, default: null },
    readings: { type: [readingSchema], default: [] }, // last few label readings (per 100 g)
    scan_count: { type: Number, default: 0 },
    first_seen: { type: Date, default: Date.now },
    last_seen: { type: Date, default: Date.now },
  },
  { strict: 'throw', versionKey: false }
);

module.exports = mongoose.model('Product', productSchema);
