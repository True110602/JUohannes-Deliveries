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

module.exports = router;
