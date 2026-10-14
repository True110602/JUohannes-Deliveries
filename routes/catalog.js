const express = require('express');
const router = express.Router();
const CatalogItem = require('../models/CatalogItem');
const User = require('../models/user');
const { requireRole } = require('../middleware/auth');

// GET the list of shops (merchants with at least one catalog item), optionally
// filtered by ?category=Food|Grocery|Pharmacy|Hardware|Other. Public.
const SHOP_CATEGORIES = ['Food', 'Grocery', 'Pharmacy', 'Hardware', 'Other'];

router.get('/shops', async (req, res) => {
  try {
    const { category } = req.query;
    if (category && !SHOP_CATEGORIES.includes(category)) return res.json([]);

    // Every approved merchant is listed (even before their menu is uploaded).
    const merchants = await User.find({ role: 'merchant', approved: true })
      .select('email shopName shopCategory profilePicUrl address isOpen');
    if (!merchants.length) return res.json([]);

    const emails = merchants.map(m => m.email);
    const stats = await CatalogItem.aggregate([
      { $match: { merchantEmail: { $in: emails } } },
      { $group: { _id: '$merchantEmail', count: { $sum: 1 }, categories: { $addToSet: '$category' } } }
    ]);
    const statsByEmail = new Map(stats.map(s => [s._id, s]));

    const shops = [];
    for (const m of merchants) {
      const st = statsByEmail.get(m.email);
      const itemCategories = (st && st.categories) || [];
      // The vendor type the merchant chose is what places the shop. Older accounts
      // that haven't chosen one yet fall back to the category of their items.
      const type = m.shopCategory || itemCategories.find(c => c && c !== 'Other') || 'Other';
      if (category && type !== category) continue;
      shops.push({
        merchantEmail: m.email,
        shopName: m.shopName || m.email,
        shopCategory: type,
        profilePicUrl: m.profilePicUrl || '',
        address: m.address || '',
        isOpen: m.isOpen !== false,
        itemCount: st ? st.count : 0
      });
    }

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
