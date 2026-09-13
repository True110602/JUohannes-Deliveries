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
    const user = await User.findById(req.user.id).select('email shopName profilePicUrl bankDetails');
    if (!user) return res.status(404).json({ success: false, message: 'Account not found' });
    res.json({ success: true, profile: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/profile', ...requireRole('merchant'), async (req, res) => {
  try {
    const { shopName, profilePicUrl, bankName, accountName, accountNumber } = req.body;
    const update = {};
    if (shopName !== undefined) update.shopName = shopName;
    if (profilePicUrl !== undefined) update.profilePicUrl = profilePicUrl;
    if (bankName !== undefined || accountName !== undefined || accountNumber !== undefined) {
      update.bankDetails = { bankName, accountName, accountNumber };
    }

    const user = await User.findByIdAndUpdate(req.user.id, update, { new: true }).select('email shopName profilePicUrl bankDetails');
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

// Sales stats - uses structured lineItems where available (accurate: the
// merchant's real share after driver + platform commission), and falls
// back to the old item-name text-matching for orders placed before
// lineItems existed, so historical figures don't just disappear.
router.get('/stats', ...requireRole('merchant'), async (req, res) => {
  try {
    const deliveredOrders = await Order.find({ status: 'delivered' });

    let salesCount = 0;
    let totalRevenue = 0;

    if (deliveredOrders.some(o => o.lineItems && o.lineItems.length > 0)) {
      // At least some orders have structured data - use it for those,
      // and keep the old heuristic only for orders that predate it.
      const myItems = await CatalogItem.find({ merchantEmail: req.user.email }).select('name');
      const myItemNames = myItems.map(i => i.name);

      deliveredOrders.forEach(o => {
        const hasStructuredData = o.lineItems && o.lineItems.length > 0;
        const isMine = hasStructuredData
          ? o.lineItems.some(li => li.merchantEmail === req.user.email)
          : myItemNames.some(name => (o.item || '').includes(name));

        if (!isMine) return;

        salesCount++;
        // Merchant's actual take-home: order total minus driver and
        // platform commission (both already computed at order time).
        // Older orders have platformCommission = 0 since that field
        // didn't exist yet, so this degrades gracefully rather than
        // breaking historical numbers.
        totalRevenue += (o.amount || 0) - (o.driverCommission || 0) - (o.platformCommission || 0);
      });
    } else {
      // No orders anywhere have structured data yet (fresh install or
      // fully historical dataset) - original approximate behavior.
      const myItems = await CatalogItem.find({ merchantEmail: req.user.email }).select('name');
      const myItemNames = myItems.map(i => i.name);
      const myOrders = deliveredOrders.filter(o => myItemNames.some(name => (o.item || '').includes(name)));
      salesCount = myOrders.length;
      totalRevenue = myOrders.reduce((sum, o) => sum + (o.amount || 0), 0);
    }

    res.json({ success: true, salesCount, totalRevenue });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
