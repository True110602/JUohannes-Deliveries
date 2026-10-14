const express = require('express');
const router = express.Router();
const CatalogItem = require('../models/CatalogItem');
const User = require('../models/user');
const { requireRole } = require('../middleware/auth');

// GET the list of shops (merchants with at least one catalog item), optionally
// filtered by ?category=Food|Grocery|Pharmacy|Hardware|Other. Public.
router.get('/shops', async (req, res) => {
  try {
    const { category } = req.query; // Get category from URL query string

    // 1. Find emails of merchants who have items in that specific category
    let merchantEmails;
    if (category) {
      merchantEmails = await CatalogItem.distinct('merchantEmail', { category: category });
    } else {
      merchantEmails = await CatalogItem.distinct('merchantEmail');
    }

    if (!merchantEmails.length) return res.json([]);

    // 2. Only show shops belonging to approved merchants
    const merchants = await User.find({ email: { $in: merchantEmails }, approved: true })
      .select('email shopName profilePicUrl address isOpen');
    
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

    // Filter out any items belonging to a merchant who isn't approved yet
    // (covers the case where an admin later un-approves someone, or a
    // customer somehow reaches an unapproved shop's URL directly).
    const emails = [...new Set(items.map(i => i.merchantEmail))];
    const approvedMerchants = await User.find({ email: { $in: emails }, approved: true }).select('email');
    const approvedSet = new Set(approvedMerchants.map(m => m.email));

    res.json(items.filter(i => approvedSet.has(i.merchantEmail)));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST new catalog item - merchant only, stamped with their own email
router.post('/', ...requireRole('merchant'), async (req, res) => {
  try {
    // Merchants can prepare their menu while awaiting approval - items
    // just won't be visible to customers yet, since the GET routes above
    // already filter out anything from an unapproved merchant.
    const { name, price, description, imageUrl, optionGroups, category } = req.body;

    const newItem = new CatalogItem({
      name,
      price,
      description,
      imageUrl,
      category: category || 'Other',
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

// PATCH edit an item - merchant only, and only their own
router.patch('/:id', ...requireRole('merchant'), async (req, res) => {
  try {
    const item = await CatalogItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (item.merchantEmail !== req.user.email) {
      return res.status(403).json({ message: 'You can only manage your own catalog items.' });
    }

    const { name, price, description, imageUrl, optionGroups, category } = req.body;
    if (category !== undefined) item.category = category;
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

// DELETE an item - merchant only, and only their own. Past orders keep
// their own copy of the name/price (lineItems), so history is unaffected.
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
