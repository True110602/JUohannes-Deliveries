// utils/spreadsheetHelper.js
const XLSX = require('xlsx');

function parseExcelFile(fileBuffer) {
  try {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(worksheet);
    return data;
  } catch (err) {
    throw new Error('Failed to parse Excel file: ' + err.message);
  }
}

function validateAndNormalizeData(rawData) {
  const errors = [];
  const validRows = [];

  rawData.forEach((row, index) => {
    const rowNum = index + 2;

    if (!row.Name || !row.Price) {
      errors.push({ row: rowNum, error: 'Name and Price are required' });
      return;
    }

    try {
      const price = parseFloat(row.Price);
      if (isNaN(price) || price < 0) {
        errors.push({ row: rowNum, error: 'Price must be a positive number' });
        return;
      }

      const normalized = {
        name: String(row.Name).trim(),
        price: price,
        description: row.Description ? String(row.Description).trim() : '',
        imageUrl: row.ImageUrl ? String(row.ImageUrl).trim() : '',
        inStock: (String(row.InStock || 'yes').toLowerCase() === 'yes'),
        options: row.Options ? parseOptionGroups(row.Options) : []
      };

      validRows.push(normalized);
    } catch (err) {
      errors.push({ row: rowNum, error: err.message });
    }
  });

  return { validRows, errors };
}

function parseOptionGroups(optionsStr) {
  if (!optionsStr) return [];
  return String(optionsStr).split('|').map(group => {
    const [name, values] = group.split(':');
    return {
      name: name.trim(),
      values: values.split(',').map(v => v.trim())
    };
  });
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
