const mongoose = require('mongoose');

const optionGroupSchema = new mongoose.Schema({
  groupName: { type: String, required: true },
  choices: { type: [String], default: [] }
}, { _id: false });

const catalogItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true, default: 0 },
  description: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  optionGroups: { type: [optionGroupSchema], default: [] },
  inStock: { type: Boolean, default: true },
  merchantEmail: { type: String, required: true }
}, { timestamps: true });

module.exports = mongoose.model('CatalogItem', catalogItemSchema);
