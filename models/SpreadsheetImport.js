const mongoose = require('mongoose');

const importBatchSchema = new mongoose.Schema({
  merchantEmail: { type: String, required: true },
  fileName: { type: String, required: true },
  totalRows: { type: Number, default: 0 },
  successCount: { type: Number, default: 0 },
  failureCount: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  importData: [{
    rowNumber: Number,
    name: String,
    price: Number,
    description: String,
    imageUrl: String,
    optionGroups: [{
      groupName: String,
      choices: [String]
    }],
    inStock: { type: Boolean, default: true },
    catalogItemId: String, // Reference to created CatalogItem if successful
    error: String, // Error message if failed
    status: { type: String, enum: ['pending', 'success', 'error'], default: 'pending' }
  }],
  errors: [String],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('SpreadsheetImport', importBatchSchema);
