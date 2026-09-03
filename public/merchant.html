const express = require('express');
const router = express.Router();
const User = require('../models/user');
const CatalogItem = require('../models/CatalogItem');
const Order = require('../models/Order');
const { requireRole } = require('../middleware/auth');

// Merchant's own profile - profile picture and bank/payout details,
// persisted server-side so they follow the account across devices.
router.get('/profile', ...requireRole('merchant'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('email profilePicUrl bankDetails');
    if (!user) return res.status(404).json({ success: false, message: 'Account not found' });
    res.json({ success: true, profile: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/profile', ...requireRole('merchant'), async (req, res) => {
  try {
    const { profilePicUrl, bankName, accountName, accountNumber } = req.body;
    const update = {};
    if (profilePicUrl !== undefined) update.profilePicUrl = profilePicUrl;
    if (bankName !== undefined || accountName !== undefined || accountNumber !== undefined) {
      update.bankDetails = { bankName, accountName, accountNumber };
    }

    const user = await User.findByIdAndUpdate(req.user.id, update, { new: true }).select('email profilePicUrl bankDetails');
    res.json({ success: true, profile: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Merchant's own items only (the public /api/catalog returns everyone's)
router.get('/catalog', ...requireRole('merchant'), async (req, res) => {
  try {
    const items = await CatalogItem.find({ merchantEmail: req.user.email }).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Approximate sales stats - matches delivered orders whose "item" text
// mentions one of this merchant's catalog item names. Orders currently
// store items as a combined text field rather than structured line items
// linking back to a specific catalog item/merchant, so this is an
// estimate, not an exact figure.
router.get('/stats', ...requireRole('merchant'), async (req, res) => {
  try {
    const myItems = await CatalogItem.find({ merchantEmail: req.user.email }).select('name');
    const myItemNames = myItems.map(i => i.name);

    const allOrders = await Order.find({ status: 'delivered' });
    const myOrders = allOrders.filter(o => myItemNames.some(name => (o.item || '').includes(name)));

    const totalRevenue = myOrders.reduce((sum, o) => sum + (o.amount || 0), 0);

    res.json({ success: true, salesCount: myOrders.length, totalRevenue });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
