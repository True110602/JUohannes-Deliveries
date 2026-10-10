const express = require('express');
const router = express.Router();
const User = require('../models/user');
const CatalogItem = require('../models/CatalogItem');
const Order = require('../models/Order');
const { requireRole } = require('../middleware/auth');
const upload = require('../middleware/upload');

// Merchant's own profile - shop name, profile picture and bank/payout
// details, persisted server-side so they follow the account across devices.
router.get('/profile', ...requireRole('merchant'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('email shopName profilePicUrl bankDetails shopLat shopLng isOpen');
    if (!user) return res.status(404).json({ success: false, message: 'Account not found' });
    res.json({ success: true, profile: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/profile', ...requireRole('merchant'), async (req, res) => {
  try {
    const { shopName, profilePicUrl, bankName, accountName, accountNumber, shopLat, shopLng, isOpen } = req.body;
    const update = {};
    if (shopName !== undefined) update.shopName = shopName;
    if (profilePicUrl !== undefined) {
      if (typeof profilePicUrl !== 'string' || (profilePicUrl !== '' && !/^(https?:\/\/|\/uploads\/)/i.test(profilePicUrl))) {
        return res.status(400).json({ success: false, message: 'Profile picture must be an uploaded image or an http(s) link.' });
      }
      update.profilePicUrl = profilePicUrl;
    }
    if (bankName !== undefined || accountName !== undefined || accountNumber !== undefined) {
      update.bankDetails = { bankName, accountName, accountNumber };
    }
    // Shop coordinates drive the per-kilometre delivery fee (see
    // calculateDelivery in routes/orders.js) - without them, orders from
    // this shop fall back to a flat fee instead of real distance pricing.
    if (shopLat !== undefined && shopLng !== undefined) {
      const lat = parseFloat(shopLat);
      const lng = parseFloat(shopLng);
      if (!isNaN(lat) && !isNaN(lng)) {
        update.shopLat = lat;
        update.shopLng = lng;
      }
    }
    if (typeof isOpen === 'boolean') update.isOpen = isOpen;

    const user = await User.findByIdAndUpdate(req.user.id, update, { new: true }).select('email shopName profilePicUrl bankDetails shopLat shopLng isOpen');
    res.json({ success: true, profile: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Upload an image file (shop profile picture or catalog item photo) from
// the merchant's device - drag/drop or file picker on the frontend. Returns
// the URL to store on the profile or catalog item (e.g. via PATCH /profile
// or POST /api/catalog).
router.post('/upload-image', ...requireRole('merchant'), (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'Upload failed.' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file was received.' });
    }
    res.json({ success: true, url: `/uploads/${req.file.filename}` });
  });
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

// Merchant's own orders - uses the structured lineItems recorded on each
// order (added alongside the free-text "item" field) to reliably find
// orders containing this merchant's items, rather than guessing from text.
// Orders placed before lineItems existed just won't appear here, since
// there's no reliable way to attribute them after the fact.
router.get('/orders', ...requireRole('merchant'), async (req, res) => {
  try {
    const myOrders = await Order.find({ 'lineItems.merchantEmail': req.user.email }).sort({ createdAt: -1 });
    res.json(myOrders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Sales stats. The merchant's take-home for an order is the item subtotal
// (`amount`) minus the platform's commission. The driver is NOT paid out of
// `amount`: the driver earns the delivery fee + tip, which the customer pays
// on top of the item subtotal - so driverCommission must not be deducted
// for orders placed with the current pricing model.
//
// Orders placed before structured lineItems existed are still matched by
// item name (the old heuristic) and keep their old calculation, where the
// driver's 10% cut did come out of the order amount, so historical figures
// don't change.
router.get('/stats', ...requireRole('merchant'), async (req, res) => {
  try {
    // Only load this merchant's own delivered orders, instead of every
    // delivered order on the platform.
    const structuredOrders = await Order.find({
      status: 'delivered',
      'lineItems.merchantEmail': req.user.email
    }).select('amount platformCommission');

    let salesCount = structuredOrders.length;
    let totalRevenue = structuredOrders.reduce(
      (sum, o) => sum + (o.amount || 0) - (o.platformCommission || 0), 0
    );

    // Legacy orders (no lineItems at all) - match by item name as before.
    const myItems = await CatalogItem.find({ merchantEmail: req.user.email }).select('name');
    const myItemNames = myItems.map(i => i.name).filter(Boolean);
    if (myItemNames.length) {
      const legacyOrders = await Order.find({
        status: 'delivered',
        'lineItems.0': { $exists: false }
      }).select('item amount driverCommission platformCommission');

      legacyOrders.forEach(o => {
        if (!myItemNames.some(name => (o.item || '').includes(name))) return;
        salesCount++;
        totalRevenue += (o.amount || 0) - (o.driverCommission || 0) - (o.platformCommission || 0);
      });
    }

    res.json({ success: true, salesCount, totalRevenue: Math.round(totalRevenue * 100) / 100 });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
