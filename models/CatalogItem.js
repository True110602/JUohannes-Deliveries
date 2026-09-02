const mongoose = require('mongoose');

const OptionGroupSchema = new mongoose.Schema({
  groupName: { type: String, required: true }, // e.g. "Size", "Flavor", "Color"
  choices: [{ type: String, required: true }]   // e.g. ["Small", "Medium", "Large"] or ["Red", "Blue"]
});

const CatalogItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  description: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  inStock: { type: Boolean, default: true },
  optionGroups: [OptionGroupSchema],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CatalogItem', CatalogItemSchema);