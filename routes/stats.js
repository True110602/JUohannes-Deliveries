const express = require('express');
const Order = require('../models/Order');
const { requireRole } = require('../middleware/auth');

// Dashboard stats for customer.html and driver.html. These pages called
// /api/customer/stats and /api/driver/stats, but no such routes existed,
// so their stat cards never loaded.

const customerRouter = express.Router();
const driverRouter = express.Router();

const ACTIVE_STATUSES = ['pending', 'assigned', 'picked_up'];

const average = (nums) => {
  const valid = nums.filter(n => typeof n === 'number');
  return valid.length
    ? Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10
    : null;
};

customerRouter.get('/stats', ...requireRole('customer'), async (req, res) => {
  try {
    const orders = await Order.find({ customerEmail: req.user.email })
      .select('status amount tip');

    const activeOrders = orders.filter(o => ACTIVE_STATUSES.includes(o.status)).length;
    const totalSpent = orders
      .filter(o => o.status === 'delivered')
      .reduce((sum, o) => sum + (o.amount || 0), 0);

    res.json({
      success: true,
      activeOrders,
      totalOrders: orders.length,
      totalSpent,
      customerRating: null // customers aren't rated; page falls back to its default
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

driverRouter.get('/stats', ...requireRole('driver'), async (req, res) => {
  try {
    const orders = await Order.find({ assignedDriver: req.user.email })
      .select('status driverCommission driverRating updatedAt deliveryPhotoAt');

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const activeDeliveries = orders.filter(o => ['assigned', 'picked_up'].includes(o.status)).length;
    const delivered = orders.filter(o => o.status === 'delivered');
    const earningsToday = delivered
      .filter(o => (o.deliveryPhotoAt || o.updatedAt) >= startOfToday)
      .reduce((sum, o) => sum + (o.driverCommission || 0), 0);

    res.json({
      success: true,
      activeDeliveries,
      completedDeliveries: delivered.length,
      earningsToday,
      driverRating: average(orders.map(o => o.driverRating))
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = { customerRouter, driverRouter };
