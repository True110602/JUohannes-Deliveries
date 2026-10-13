const express = require('express');
const router = express.Router();
const CatalogItem = require('../models/CatalogItem');
const User = require('../models/user');
const { requireRole } = require('../middleware/auth');

// GET the list of shops
router.get('/shops', async (req, res) => {
  try {
    const merchantEmails = await CatalogItem.distinct('merchantEmail');
    if (!merchantEmails.length) return res.json([]);

    // CRITICAL: Only fetch users who are merchants AND approved
    const merchants = await User.find({ 
      email: { $in: merchantEmails }, 
      role: 'merchant', 
      approved: true 
    }).select('email shopName profilePicUrl address isOpen');

    const merchantByEmail = new Map(merchants.map(m => [m.email, m]));
    const approvedEmails = merchants.map(m => m.email);

    const itemCounts = await CatalogItem.aggregate([
      { $match: { merchantEmail: { $in: approvedEmails } } },
      { $group: { _id: '$merchantEmail', count: { $sum: 1 } } }
    ]);
    const countByEmail = new Map(itemCounts.map(c => [c._id, c.count]));

    const shops = approvedEmails.map(email => {
      const merchant = merchantByEmail.get(email);
      return {
        merchantEmail: email,
        shopName: (merchant && merchant.shopName) || email,
        profilePicUrl: (merchant && merchant.profilePicUrl) || '',
        address: (merchant && merchant.address) || '',
        isOpen: merchant ? merchant.isOpen !== false : true,
        itemCount: countByEmail.get(email) || 0
      };
    });

    shops.sort((a, b) => a.shopName.localeCompare(b.shopName));
    res.json(shops);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET catalog
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.merchant) {
      filter.merchantEmail = req.query.merchant;
    }
    const items = await CatalogItem.find(filter).sort({ createdAt: -1 });

    // CRITICAL: Double-verify that the merchants owning these items are approved
    const emails = [...new Set(items.map(i => i.merchantEmail))];
    const approvedMerchants = await User.find({ 
      email: { $in: emails }, 
      role: 'merchant', 
      approved: true 
    }).select('email');
    
    const approvedSet = new Set(approvedMerchants.map(m => m.email));

    res.json(items.filter(i => approvedSet.has(i.merchantEmail)));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST new catalog item - merchant only
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

router.patch('/:id', ...requireRole('merchant'), async (req, res) => {
  try {
    const item = await CatalogItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (item.merchantEmail !== req.user.email) {
      return res.status(403).json({ message: 'You can only manage your own catalog items.' });
    }
    const { name, price, description, imageUrl, optionGroups } = req.body;
    if (name !== undefined) item.name = name;
    if (price !== undefined) item.price = price;
    if (description !== undefined) item.description = description;
    if (imageUrl !== undefined) item.imageUrl = imageUrl;
    if (optionGroups !== undefined) item.optionGroups = optionGroups;
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.delete('/:id', ...requireRole('merchant'), async (req, res) => {
  try {
    const item = await CatalogItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (item.merchantEmail !== req.user.email) {
      return res.status(403).json({ message: 'You can only manage your own catalog items.' });
    }
    await item.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
