const express = require('express');
const router = express.Router();
const CatalogItem = require('../models/CatalogItem');
const User = require('../models/user');
const { requireRole } = require('../middleware/auth');

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

// ... keep the rest of the file (GET /, POST /, PATCH, DELETE) exactly as it was
module.exports = router;
