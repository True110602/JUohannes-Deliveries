const express = require('express');
const router = express.Router();
const CatalogItem = require('../models/CatalogItem');

// GET catalog
router.get('/', async (req, res) => {
  try {
    const items = await CatalogItem.find();
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST new catalog item with options and image URL
router.post('/', async (req, res) => {
  try {
    const { name, price, description, imageUrl, optionGroups } = req.body;
    
    const newItem = new CatalogItem({
      name,
      price,
      description,
      imageUrl,
      optionGroups: optionGroups || []
    });

    await newItem.save();
    res.status(201).json(newItem);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// PATCH toggle stock status
router.patch('/:id/stock', async (req, res) => {
  try {
    const item = await CatalogItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });

    item.inStock = !item.inStock;
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;