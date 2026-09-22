/**
 * Spreadsheet Helper Utilities
 * Handles parsing, validation, and processing of product spreadsheets
 */

const XLSX = require('xlsx');

// Expected column headers (case-insensitive)
const REQUIRED_HEADERS = ['name', 'price'];
const OPTIONAL_HEADERS = ['description', 'imageurl', 'instock', 'options'];

/**
 * Parse Excel file and extract data
 * @param {Buffer} fileBuffer - The uploaded file buffer
 * @returns {Object} - { success: boolean, data: Array, errors: Array }
 */
function parseExcelFile(fileBuffer) {
  try {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON with header row
    const rawData = XLSX.utils.sheet_to_json(worksheet, {
      defval: '',
      blankrows: false
    });

    if (!rawData || rawData.length === 0) {
      return {
        success: false,
        data: [],
        errors: ['Spreadsheet is empty or no data found']
      };
    }

    // Normalize headers
    const headers = Object.keys(rawData[0]).map(h => h.toLowerCase().trim());
    
    // Check for required headers
    const missingHeaders = REQUIRED_HEADERS.filter(
      h => !headers.some(header => header.includes(h))
    );

    if (missingHeaders.length > 0) {
      return {
        success: false,
        data: [],
        errors: [`Missing required columns: ${missingHeaders.join(', ')}`]
      };
    }

    return {
      success: true,
      data: rawData,
      errors: []
    };
  } catch (error) {
    return {
      success: false,
      data: [],
      errors: [`Failed to parse file: ${error.message}`]
    };
  }
}

/**
 * Validate and normalize product data from spreadsheet
 * @param {Array} rawData - Raw data from spreadsheet
 * @returns {Object} - { products: Array, errors: Array }
 */
function validateAndNormalizeData(rawData) {
  const products = [];
  const errors = [];

  rawData.forEach((row, index) => {
    const rowNumber = index + 2; // +2 because row 1 is headers, +1 for 0-index
    const product = {};
    let hasErrors = false;
    const rowErrors = [];

    // Get case-insensitive values
    const rowKeys = Object.keys(row);
    const getColumnValue = (columnName) => {
      const key = rowKeys.find(k => k.toLowerCase().includes(columnName.toLowerCase()));
      return key ? row[key] : '';
    };

    // Validate Name (required)
    const name = String(getColumnValue('name')).trim();
    if (!name) {
      rowErrors.push('Name is required');
      hasErrors = true;
    } else {
      product.name = name;
    }

    // Validate Price (required, must be number)
    const priceStr = String(getColumnValue('price')).trim();
    const price = parseFloat(priceStr);
    if (!priceStr || isNaN(price) || price < 0) {
      rowErrors.push('Price must be a valid positive number');
      hasErrors = true;
    } else {
      product.price = parseFloat(price.toFixed(2));
    }

    // Description (optional)
    const description = String(getColumnValue('description')).trim();
    product.description = description || '';

    // Image URL (optional)
    const imageUrl = String(getColumnValue('imageurl')).trim();
    if (imageUrl && !isValidUrl(imageUrl)) {
      rowErrors.push('Image URL is not valid');
      hasErrors = true;
    }
    product.imageUrl = imageUrl || '';

    // In Stock (optional, boolean)
    const inStockStr = String(getColumnValue('instock')).trim().toLowerCase();
    product.inStock = inStockStr === '' || inStockStr === 'true' || inStockStr === 'yes' || inStockStr === '1';

    // Options (optional, comma-separated or pipe-separated)
    const optionsStr = String(getColumnValue('options')).trim();
    product.optionGroups = parseOptionGroups(optionsStr);

    if (hasErrors) {
      products.push({
        rowNumber,
        ...product,
        status: 'error',
        error: rowErrors.join('; ')
      });
      errors.push(`Row ${rowNumber}: ${rowErrors.join('; ')}`);
    } else {
      products.push({
        rowNumber,
        ...product,
        status: 'pending'
      });
    }
  });

  return { products, errors };
}

/**
 * Parse option groups from string format
 * Format: "Size:Small,Medium,Large|Color:Red,Blue,Green"
 * @param {string} optionsStr - Options string
 * @returns {Array} - Array of option group objects
 */
function parseOptionGroups(optionsStr) {
  if (!optionsStr) return [];

  const optionGroups = [];
  try {
    // Split by pipe for different groups
    const groups = optionsStr.split('|').map(g => g.trim()).filter(g => g);

    groups.forEach(group => {
      // Split by colon to get group name and choices
      const [groupName, choicesStr] = group.split(':').map(s => s.trim());
      
      if (groupName && choicesStr) {
        const choices = choicesStr.split(',').map(c => c.trim()).filter(c => c);
        if (choices.length > 0) {
          optionGroups.push({
            groupName,
            choices
          });
        }
      }
    });
  } catch (error) {
    // Silently ignore malformed options
  }

  return optionGroups;
}

/**
 * Check if URL is valid
 * @param {string} url - URL to validate
 * @returns {boolean}
 */
function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create template Excel file
 * @returns {Buffer} - Excel file buffer
 */
function createTemplateExcel() {
  const templateData = [
    {
      Name: 'Chicken Meal',
      Price: 15.99,
      Description: 'Grilled chicken with rice and vegetables',
      ImageUrl: 'https://example.com/chicken.jpg',
      InStock: 'Yes',
      Options: 'Size:Small,Large|Temperature:Hot,Mild'
    },
    {
      Name: 'Vegetable Burger',
      Price: 8.50,
      Description: 'Fresh veggie burger with fries',
      ImageUrl: 'https://example.com/burger.jpg',
      InStock: 'Yes',
      Options: 'Size:Regular,Large'
    }
  ];

  const worksheet = XLSX.utils.json_to_sheet(templateData);
  
  // Set column widths
  worksheet['!cols'] = [
    { wch: 25 }, // Name
    { wch: 12 }, // Price
    { wch: 40 }, // Description
    { wch: 35 }, // ImageUrl
    { wch: 12 }, // InStock
    { wch: 50 }  // Options
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');

  return XLSX.write(workbook, { type: 'buffer' });
}

module.exports = {
  parseExcelFile,
  validateAndNormalizeData,
  parseOptionGroups,
  isValidUrl,
  createTemplateExcel
};
