const express = require('express');
const router = express.Router();
const User = require('../models/user');
const { requireRole } = require('../middleware/auth');

// List every registered driver, so the admin dashboard can offer a real
// "assign driver" dropdown instead of only ever showing drivers who have
// already been assigned to some earlier order (which made it impossible
// to assign anyone for the very first time).
router.get('/drivers', ...requireRole('admin'), async (req, res) => {
  try {
    const drivers = await User.find({ role: 'driver' }).select('email');
    res.json(drivers.map(d => d.email));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// All merchant accounts, so admin can review and approve new ones before
// they can list items publicly.
router.get('/merchants', ...requireRole('admin'), async (req, res) => {
  try {
    const merchants = await User.find({ role: 'merchant' }).select('email name shopName approved createdAt');
    res.json(merchants);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/merchants/:id/approve', ...requireRole('admin'), async (req, res) => {
  try {
    const merchant = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'merchant' },
      { approved: true },
      { new: true }
    ).select('email name shopName approved');
    if (!merchant) return res.status(404).json({ message: 'Merchant not found' });
    res.json(merchant);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
