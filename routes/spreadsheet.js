// routes/spreadsheet.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { requireRole } = require('../middleware/auth');
const SpreadsheetImport = require('../models/SpreadsheetImport');
const CatalogItem = require('../models/CatalogItem');
const {
  parseExcelFile,
  validateAndNormalizeData,
  createTemplateExcel
} = require('../utils/spreadsheetHelper');

// Memory storage for file uploads (5MB limit)
const storage = multer.memoryStorage();
const ALLOWED_MIME = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  // Some browsers / Android WebViews send spreadsheets as a generic type,
  // so the file extension check below is what really gates the upload.
  'application/octet-stream'
];
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const okExt = /\.(xlsx|xls|csv)$/i.test(file.originalname || '');
    if (okExt && ALLOWED_MIME.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel (.xlsx, .xls) and CSV files are allowed'));
    }
  }
});

// Runs multer but turns its errors (wrong type, too big) into a clean JSON
// 400 instead of falling through to Express's default HTML error page.
function receiveFile(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, error: err.message || 'Upload failed' });
    next();
  });
}

// Bulk import writes into a merchant's own catalog, so merchants only.
const merchantOnly = requireRole('merchant');

// GET /api/spreadsheet/template - Download template
router.get('/template', (req, res) => {
  try {
    const buffer = createTemplateExcel();
    res.setHeader('Content-Disposition', 'attachment; filename=product-template.xlsx');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/spreadsheet/validate - Validate before import
router.post('/validate', ...merchantOnly, receiveFile, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const rawData = parseExcelFile(req.file.buffer);
    const { validRows, errors } = validateAndNormalizeData(rawData);

    res.json({
      success: true,
      totalRows: rawData.length,
      validRows: validRows.length,
      errors,
      preview: validRows.slice(0, 5)
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/spreadsheet/import - Import products
router.post('/import', ...merchantOnly, receiveFile, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const merchantEmail = req.user.email;
    let rawData;
    try {
      rawData = parseExcelFile(req.file.buffer);
    } catch (parseErr) {
      return res.status(400).json({ success: false, error: parseErr.message });
    }
    const { validRows, errors } = validateAndNormalizeData(rawData);
    if (validRows.length === 0) {
      return res.status(400).json({ success: false, error: 'No valid products found in this file.' });
    }

    // Create import record
    const importRecord = await SpreadsheetImport.create({
      merchantEmail,
      fileName: req.file.originalname,
      totalRows: rawData.length,
      status: 'processing',
      importData: validRows,
      // The history model stores errors as plain strings.
      errors: errors.map(e => `Row ${e.row}: ${e.error}`)
    });

    // Import products to catalog
    let successCount = 0;
    for (const item of validRows) {
      try {
        await CatalogItem.create({
          merchantEmail,
          name: item.name,
          price: item.price,
          description: item.description,
          imageUrl: item.imageUrl,
          inStock: item.inStock,
          optionGroups: item.optionGroups
        });
        successCount++;
      } catch (err) {
        errors.push({ row: item.rowNumber, error: `${item.name}: ${err.message}` });
      }
    }

    // Update import record
    importRecord.successCount = successCount;
    importRecord.failureCount = errors.length;
    importRecord.errors = errors.map(e => `Row ${e.row}: ${e.error}`);
    importRecord.status = 'completed';
    importRecord.completedAt = new Date();
    await importRecord.save();

    res.json({
      success: true,
      message: `Imported ${successCount} products`,
      importId: importRecord._id,
      stats: {
        total: rawData.length,
        success: successCount,
        failed: errors.length
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/spreadsheet/history - View import history
router.get('/history', ...merchantOnly, async (req, res) => {
  try {
    const imports = await SpreadsheetImport.find({ merchantEmail: req.user.email })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({ success: true, imports });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/spreadsheet/history/:id - Get specific import
router.get('/history/:id', ...merchantOnly, async (req, res) => {
  try {
    const importRecord = await SpreadsheetImport.findById(req.params.id);
    if (!importRecord || importRecord.merchantEmail !== req.user.email) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    res.json({ success: true, import: importRecord });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/spreadsheet/history/:id - Delete import history
router.delete('/history/:id', ...merchantOnly, async (req, res) => {
  try {
    const importRecord = await SpreadsheetImport.findById(req.params.id);
    if (!importRecord || importRecord.merchantEmail !== req.user.email) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }
    await SpreadsheetImport.deleteOne({ _id: req.params.id });
    res.json({ success: true, message: 'Import history deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
