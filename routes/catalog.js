const express = require('express');
const router = express.Router();
const CatalogItem = require('../models/CatalogItem');
const User = require('../models/user');
const { requireRole } = require('../middleware/auth');

// GET the list of shops (merchants who have at least one catalog item) -
// public, used by the customer app to let people pick which shop's menu
// to browse instead of being dumped into one giant combined list.
router.get('/shops', async (req, res) => {
  try {
    const merchantEmails = await CatalogItem.distinct('merchantEmail');
    if (!merchantEmails.length) return res.json([]);

    const merchants = await User.find({ email: { $in: merchantEmails } })
      .select('email shopName profilePicUrl');
    const merchantByEmail = new Map(merchants.map(m => [m.email, m]));

    const itemCounts = await CatalogItem.aggregate([
      { $match: { merchantEmail: { $in: merchantEmails } } },
      { $group: { _id: '$merchantEmail', count: { $sum: 1 } } }
    ]);
    const countByEmail = new Map(itemCounts.map(c => [c._id, c.count]));

    const shops = merchantEmails.map(email => {
      const merchant = merchantByEmail.get(email);
      return {
        merchantEmail: email,
        shopName: (merchant && merchant.shopName) || email,
        profilePicUrl: (merchant && merchant.profilePicUrl) || '',
        itemCount: countByEmail.get(email) || 0
      };
    });

    shops.sort((a, b) => a.shopName.localeCompare(b.shopName));
    res.json(shops);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET catalog - public. With no query, every merchant's items (kept for
// backwards compatibility). With ?merchant=<email>, just that shop's menu -
// this is what the customer app uses once a shop has been picked.
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.merchant) {
      filter.merchantEmail = req.query.merchant;
    }
    const items = await CatalogItem.find(filter).sort({ createdAt: -1 });
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
