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

module.exports = router;
