// utils/spreadsheetHelper.js
const XLSX = require('xlsx');

const MAX_ROWS = 2000;

function parseExcelFile(fileBuffer) {
  let data;
  try {
    // Only plain cell values are needed - skip formulas, HTML and styles,
    // and cap how many rows the parser will read from an untrusted file.
    const workbook = XLSX.read(fileBuffer, {
      type: 'buffer',
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      sheetRows: MAX_ROWS + 2
    });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    data = XLSX.utils.sheet_to_json(worksheet);
  } catch (err) {
    throw new Error('Failed to parse Excel file: ' + err.message);
  }
  if (data.length > MAX_ROWS) {
    throw new Error(`This file has too many rows (maximum ${MAX_ROWS}). Please split it into smaller files.`);
  }
  return data;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const v = String(value).trim().toLowerCase();
  if (['yes', 'y', 'true', '1'].includes(v)) return true;
  if (['no', 'n', 'false', '0'].includes(v)) return false;
  return fallback;
}

function validateAndNormalizeData(rawData) {
  const errors = [];
  const validRows = [];

  rawData.forEach((row, index) => {
    const rowNum = index + 2; // +1 for the header row, +1 because rows are 1-based in Excel

    const name = row.Name === undefined || row.Name === null ? '' : String(row.Name).trim();
    const hasPrice = row.Price !== undefined && row.Price !== null && String(row.Price).trim() !== '';

    if (!name || !hasPrice) {
      errors.push({ row: rowNum, error: 'Name and Price are required' });
      return;
    }
    if (name.length > 120) {
      errors.push({ row: rowNum, error: 'Name is too long (max 120 characters)' });
      return;
    }

    const price = parseFloat(row.Price);
    if (!Number.isFinite(price) || price < 0 || price > 100000) {
      errors.push({ row: rowNum, error: 'Price must be a number of 0 or more' });
      return;
    }

    const imageUrl = row.ImageUrl ? String(row.ImageUrl).trim() : '';
    if (imageUrl && !/^https?:\/\//i.test(imageUrl)) {
      errors.push({ row: rowNum, error: 'ImageUrl must be a full http(s) link' });
      return;
    }

    validRows.push({
      rowNumber: rowNum,
      name,
      price: Math.round(price * 100) / 100,
      description: row.Description ? String(row.Description).trim().slice(0, 500) : '',
      imageUrl,
      inStock: parseBoolean(row.InStock, true),
      // Same shape the CatalogItem model and the ordering code use.
      optionGroups: row.Options ? parseOptionGroups(row.Options) : []
    });
  });

  return { validRows, errors };
}

// "Size:Small,Large|Sauce:Spicy,Mild" ->
//   [{ groupName: 'Size', choices: ['Small','Large'] }, { groupName: 'Sauce', choices: ['Spicy','Mild'] }]
// Malformed groups (no name, or no choices) are skipped rather than failing the row.
function parseOptionGroups(optionsStr) {
  if (!optionsStr) return [];
  return String(optionsStr).split('|').map(group => {
    const idx = group.indexOf(':');
    if (idx === -1) return null;
    const groupName = group.slice(0, idx).trim();
    const choices = group.slice(idx + 1).split(',').map(v => v.trim()).filter(Boolean);
    if (!groupName || choices.length === 0) return null;
    return { groupName, choices };
  }).filter(Boolean);
}

function isValidUrl(url) {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function createTemplateExcel() {
  const template = [
    {
      Name: 'Chicken Burger',
      Price: 5.99,
      Description: 'Grilled chicken with mayo and lettuce',
      ImageUrl: 'https://example.com/burger.jpg',
      InStock: 'yes',
      Options: 'Size:Small,Large|Sauce:Spicy,Mild'
    },
    {
      Name: 'Coca Cola 330ml',
      Price: 1.50,
      Description: '',
      ImageUrl: '',
      InStock: 'yes',
      Options: ''
    }
  ];

  const worksheet = XLSX.utils.json_to_sheet(template);
  worksheet['!cols'] = [
    { wch: 20 },
    { wch: 10 },
    { wch: 30 },
    { wch: 30 },
    { wch: 10 },
    { wch: 30 }
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Products');

  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
}

module.exports = {
  parseExcelFile,
  validateAndNormalizeData,
  parseOptionGroups,
  isValidUrl,
  createTemplateExcel
};
