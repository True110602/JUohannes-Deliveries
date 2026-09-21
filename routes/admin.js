const express = require('express');
const router = express.Router();
const User = require('../models/user');
const { requireRole } = require('../middleware/auth');
const { notifyUser } = require('../utils/notify');

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
    const merchants = await User.find({ role: 'merchant' }).select('email name shopName shopCategory approved createdAt');
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

    notifyUser(req.app.get('io'), merchant.email, {
      title: 'Your shop is approved!',
      message: `${merchant.shopName || 'Your shop'} is now approved and visible to customers.`
    });

    res.json(merchant);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Broadcast an announcement to everyone in a role (or everyone full
// stop). Reuses the existing notification system, so recipients get it
// live if they're online and waiting for them if they're not.
router.post('/broadcast', ...requireRole('admin'), async (req, res) => {
  try {
    const { title, message, targetRole } = req.body;

    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, message: 'A title is required.' });
    }
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, message: 'A message is required.' });
    }

    const VALID_TARGETS = ['all', 'customer', 'driver', 'merchant'];
    const target = VALID_TARGETS.includes(targetRole) ? targetRole : 'all';

    const filter = target === 'all' ? {} : { role: target };
    const recipients = await User.find(filter).select('email');

    const io = req.app.get('io');
    const payload = { title: title.trim(), message: message.trim() };
    await Promise.all(recipients.map(u => notifyUser(io, u.email, payload)));

    res.json({ success: true, sentTo: recipients.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
