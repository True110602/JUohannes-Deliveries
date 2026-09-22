const express = require('express');
const router = express.Router();
const multer = require('multer');
const SpreadsheetImport = require('../models/SpreadsheetImport');
const CatalogItem = require('../models/CatalogItem');
const { requireRole } = require('../middleware/auth');
const {
  parseExcelFile,
  validateAndNormalizeData,
  createTemplateExcel
} = require('../utils/spreadsheetHelper');

// Configure multer for Excel files only
const uploadStorage = multer.memoryStorage();
const uploadFilter = (req, file, cb) => {
  const allowedMimes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
    'text/csv' // .csv
  ];
  
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only Excel (.xlsx, .xls) and CSV files are allowed'));
  }
};

const upload = multer({
  storage: uploadStorage,
  fileFilter: uploadFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

/**
 * GET /api/spreadsheet/template
 * Download an Excel template for bulk product import
 */
router.get('/template', ...requireRole('merchant'), (req, res) => {
  try {
    const templateBuffer = createTemplateExcel();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="product-template.xlsx"');
    res.send(templateBuffer);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * POST /api/spreadsheet/validate
 * Upload and validate spreadsheet without importing
 * Returns preview of data and any errors
 */
router.post('/validate', ...requireRole('merchant'), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file provided'
      });
    }

    // Parse the Excel file
    const parseResult = parseExcelFile(req.file.buffer);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Failed to parse file',
        errors: parseResult.errors
      });
    }

    // Validate and normalize data
    const { products, errors } = validateAndNormalizeData(parseResult.data);

    // Separate valid and invalid products
    const validProducts = products.filter(p => p.status === 'pending');
    const invalidProducts = products.filter(p => p.status === 'error');

    res.json({
      success: true,
      fileName: req.file.originalname,
      preview: {
        totalRows: products.length,
        validCount: validProducts.length,
        invalidCount: invalidProducts.length,
        products: products
      },
      errors
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * POST /api/spreadsheet/import
 * Import validated products into the database
 * Expects: { fileName, products: [{...}, ...] }
 * Only imports products marked as valid
 */
router.post('/import', ...requireRole('merchant'), async (req, res) => {
  try {
    const { fileName, products } = req.body;

    if (!fileName || !products || !Array.isArray(products)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid request: fileName and products array required'
      });
    }

    if (products.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No products to import'
      });
    }

    // Create import batch record
    const importBatch = new SpreadsheetImport({
      merchantEmail: req.user.email,
      fileName,
      totalRows: products.length,
      importData: products.map(p => ({
        rowNumber: p.rowNumber,
        name: p.name,
        price: p.price,
        description: p.description,
        imageUrl: p.imageUrl,
        optionGroups: p.optionGroups,
        inStock: p.inStock,
        status: 'pending'
      })),
      status: 'processing'
    });

    // Process each product
    const results = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < products.length; i++) {
      const product = products[i];

      // Skip products with errors
      if (product.status === 'error') {
        importBatch.importData[i].status = 'error';
        importBatch.importData[i].error = product.error;
        failureCount++;
        continue;
      }

      try {
        // Create the catalog item
        const newItem = new CatalogItem({
          name: product.name,
          price: product.price,
          description: product.description,
          imageUrl: product.imageUrl,
          optionGroups: product.optionGroups || [],
          inStock: product.inStock !== false,
          merchantEmail: req.user.email
        });

        const savedItem = await newItem.save();

        importBatch.importData[i].status = 'success';
        importBatch.importData[i].catalogItemId = savedItem._id.toString();
        successCount++;
      } catch (err) {
        importBatch.importData[i].status = 'error';
        importBatch.importData[i].error = err.message;
        failureCount++;
      }
    }

    // Update batch status
    importBatch.successCount = successCount;
    importBatch.failureCount = failureCount;
    importBatch.status = failureCount === 0 ? 'completed' : 'completed';

    await importBatch.save();

    res.json({
      success: true,
      message: `Import complete: ${successCount} products created, ${failureCount} errors`,
      batchId: importBatch._id,
      results: {
        totalRows: products.length,
        successCount,
        failureCount,
        details: importBatch.importData
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * GET /api/spreadsheet/history
 * Get import history for the merchant
 */
router.get('/history', ...requireRole('merchant'), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const imports = await SpreadsheetImport
      .find({ merchantEmail: req.user.email })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('fileName status successCount failureCount totalRows createdAt');

    const total = await SpreadsheetImport.countDocuments({ merchantEmail: req.user.email });

    res.json({
      success: true,
      imports,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * GET /api/spreadsheet/history/:id
 * Get detailed import batch information
 */
router.get('/history/:id', ...requireRole('merchant'), async (req, res) => {
  try {
    const importBatch = await SpreadsheetImport.findById(req.params.id);

    if (!importBatch) {
      return res.status(404).json({
        success: false,
        message: 'Import batch not found'
      });
    }

    // Verify ownership
    if (importBatch.merchantEmail !== req.user.email) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    res.json({
      success: true,
      batch: importBatch
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * DELETE /api/spreadsheet/history/:id
 * Delete an import batch record
 */
router.delete('/history/:id', ...requireRole('merchant'), async (req, res) => {
  try {
    const importBatch = await SpreadsheetImport.findById(req.params.id);

    if (!importBatch) {
      return res.status(404).json({
        success: false,
        message: 'Import batch not found'
      });
    }

    // Verify ownership
    if (importBatch.merchantEmail !== req.user.email) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    await SpreadsheetImport.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: 'Import batch deleted'
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;
