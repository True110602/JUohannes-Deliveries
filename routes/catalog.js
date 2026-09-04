const express = require('express');
const router = express.Router();
const CatalogItem = require('../models/CatalogItem');
const { requireRole } = require('../middleware/auth');

// GET catalog - public, every merchant's items, used by the customer menu
router.get('/', async (req, res) => {
  try {
    const items = await CatalogItem.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST new catalog item - merchant only, stamped with their own email
router.post('/', ...requireRole('merchant'), async (req, res) => {
  try {
    const { name, price, description, imageUrl, optionGroups } = req.body;

    const newItem = new CatalogItem({
      name,
      price,
      description,
      imageUrl,
      optionGroups: optionGroups || [],
      merchantEmail: req.user.email
    });

    await newItem.save();
    res.status(201).json(newItem);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PATCH toggle stock status - merchant only, and only for their own items
router.patch('/:id/stock', ...requireRole('merchant'), async (req, res) => {
  try {
    const item = await CatalogItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (item.merchantEmail !== req.user.email) {
      return res.status(403).json({ message: 'You can only manage your own catalog items.' });
    }

    item.inStock = !item.inStock;
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
