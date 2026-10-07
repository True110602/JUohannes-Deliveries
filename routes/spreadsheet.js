// routes/spreadsheet.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticateToken } = require('../middleware/auth');
const SpreadsheetImport = require('../models/SpreadsheetImport');
const CatalogItem = require('../models/CatalogItem');
const {
  parseExcelFile,
  validateAndNormalizeData,
  createTemplateExcel
} = require('../utils/spreadsheetHelper');

// Memory storage for file uploads (5MB limit)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel and CSV files are allowed'));
    }
  }
});

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
router.post('/validate', authenticateToken, upload.single('file'), async (req, res) => {
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
router.post('/import', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }

    const merchantEmail = req.user.email;
    const rawData = parseExcelFile(req.file.buffer);
    const { validRows, errors } = validateAndNormalizeData(rawData);

    // Create import record
    const importRecord = await SpreadsheetImport.create({
      merchantEmail,
      fileName: req.file.originalname,
      totalRows: rawData.length,
      status: 'processing',
      importData: validRows,
      errors
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
          options: item.options
        });
        successCount++;
      } catch (err) {
        errors.push({ item: item.name, error: err.message });
      }
    }

    // Update import record
    importRecord.successCount = successCount;
    importRecord.failureCount = errors.length;
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
router.get('/history', authenticateToken, async (req, res) => {
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
router.get('/history/:id', authenticateToken, async (req, res) => {
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
router.delete('/history/:id', authenticateToken, async (req, res) => {
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
