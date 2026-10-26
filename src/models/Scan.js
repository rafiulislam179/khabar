'use strict';
const mongoose = require('mongoose');
const crypto = require('crypto');

const RATING = ['GREEN', 'AMBER', 'RED', 'UNKNOWN'];

// All values are stored PER 100 g (after unit conversion).
const nutrientValuesSchema = new mongoose.Schema(
  {
    energy_kcal: { type: Number, min: 0, max: 1000, default: null },
    protein_g: { type: Number, min: 0, max: 100, default: null },
    carbs_g: { type: Number, min: 0, max: 100, default: null },
    fat_g: { type: Number, min: 0, max: 100, default: null },
    saturated_fat_g: { type: Number, min: 0, max: 100, default: null },
    sugar_g: { type: Number, min: 0, max: 100, default: null },
    sodium_mg: { type: Number, min: 0, max: 40000, default: null },
    salt_g: { type: Number, min: 0, max: 100, default: null },
  },
  { _id: false }
);

const ruleResultsSchema = new mongoose.Schema(
  {
    sodium: { type: String, enum: RATING, required: true },
    sugar: { type: String, enum: RATING, required: true },
    fat: { type: String, enum: RATING, required: true },
    saturated_fat: { type: String, enum: RATING, required: true },
    overall: { type: String, enum: RATING, required: true },
    rules_version: { type: String, required: true },
  },
  { _id: false }
);

const scanSchema = new mongoose.Schema(
  {
    // Random ID, NOT derived from the user. It cannot be linked back to a person.
    anonymous_scan_id: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      default: () => crypto.randomUUID(),
    },
    timestamp: { type: Date, default: Date.now, immutable: true, index: true },
    channel: { type: String, enum: ['whatsapp', 'pwa', 'test'], required: true },
    nutrient_values: { type: nutrientValuesSchema, required: true },
    rule_engine_results: { type: ruleResultsSchema, required: true },
  },
  {
    // strict: 'throw' makes Mongoose REJECT any extra field (e.g. phone, name, ip, image).
    strict: 'throw',
    versionKey: false,
  }
);

module.exports = mongoose.model('Scan', scanSchema);
