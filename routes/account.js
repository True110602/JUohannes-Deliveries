const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const User = require('../models/user');
const { authenticateToken } = require('../middleware/auth');

// Any logged-in user's own account details. Previously there was no way
// to view or edit this once registered - only the forgot-password flow
// ever touched an account after signup.
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('name email phone address role');
    if (!user) return res.status(404).json({ success: false, message: 'Account not found' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/me', authenticateToken, async (req, res) => {
  try {
    const { name, phone, address } = req.body;
    const update = {};
    if (typeof name === 'string' && name.trim()) update.name = name.trim();
    if (typeof phone === 'string' && phone.trim()) update.phone = phone.trim();
    if (typeof address === 'string' && address.trim()) update.address = address.trim();

    const user = await User.findByIdAndUpdate(req.user.id, update, { new: true })
      .select('name email phone address role');
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Changing a password while logged in - requires the current password,
// unlike the forgot-password flow which uses an emailed code instead.
router.patch('/password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ success: false, message: 'Current and new password are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'Account not found' });

    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Referral program summary for the logged-in user's own account - their
// shareable code, credit balance, and how many people have signed up
// using it. Doesn't require a role check since every account type can
// refer friends (a driver or merchant might just as easily refer a
// customer as vice versa).
router.get('/referral', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('referralCode referralCredit referredBy hasCompletedFirstOrder email');
    if (!user) return res.status(404).json({ success: false, message: 'Account not found' });

    // Demo/seed accounts predate the referral program and may not have a
    // code yet - generate one on first request rather than leaving it null.
    if (!user.referralCode) {
      const base = (user.email || 'USER').replace(/[^a-zA-Z]/g, '').slice(0, 5).toUpperCase() || 'USER';
      user.referralCode = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
      await user.save();
    }

    const referredCount = await User.countDocuments({ referredBy: user.email });

    res.json({
      success: true,
      referralCode: user.referralCode,
      referralCredit: user.referralCredit,
      referredCount,
      // Lets the checkout page show the 10% first-order discount preview
      // without duplicating the eligibility rule from routes/orders.js.
      firstOrderDiscountEligible: !!(user.referredBy && !user.hasCompletedFirstOrder)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
