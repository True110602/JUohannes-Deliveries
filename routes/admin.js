const express = require('express');
const router = express.Router();
const User = require('../models/user');
const DriverLocation = require('../models/DriverLocation');
const Order = require('../models/Order');
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

// Every account (optionally filtered by ?role=), for the admin Users /
// Drivers pages. Passwords and reset codes are never sent.
router.get('/users', ...requireRole('admin'), async (req, res) => {
  try {
    const filter = {};
    if (['customer', 'driver', 'merchant', 'admin'].includes(req.query.role)) {
      filter.role = req.query.role;
    }
    const users = await User.find(filter)
      .select('name email phone role address shopName approved isOpen createdAt')
      .sort({ createdAt: -1 });
    res.json(users);
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

// NEW ENDPOINT: Get all drivers with their current locations (online drivers)
router.get('/drivers-locations', ...requireRole('admin'), async (req, res) => {
  try {
    // Get all saved driver locations from the database
    const driverLocations = await DriverLocation.find().lean();
    
    // Map them to include driver info from User collection
    const driversWithInfo = await Promise.all(
      driverLocations.map(async (loc) => {
        // Try to find the driver by email (driverId might be email or ID)
        let driver = await User.findOne({ email: loc.driverId }).lean();
        if (!driver) {
          driver = await User.findById(loc.driverId).lean();
        }
        
        return {
          _id: loc._id,
          driverId: loc.driverId,
          driverName: driver ? driver.name : 'Unknown Driver',
          phone: driver ? driver.phone : 'N/A',
          latitude: loc.lat,
          longitude: loc.lng,
          status: 'available',
          updatedAt: loc.updatedAt
        };
      })
    );

    res.json({
      success: true,
      drivers: driversWithInfo
    });
  } catch (err) {
    console.error('Error fetching driver locations:', err);
    res.status(500).json({ success: false, message: 'Error fetching driver locations', error: err.message });
  }
});

// NEW ENDPOINT: Get admin dashboard statistics
router.get('/stats', ...requireRole('admin'), async (req, res) => {
  try {
    // Count online drivers (those with recent location updates)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const onlineDrivers = await DriverLocation.countDocuments({
      updatedAt: { $gte: fiveMinutesAgo }
    });

    // Count all drivers
    const totalDrivers = await User.countDocuments({ role: 'driver' });
    
    // Count all merchants
    const totalMerchants = await User.countDocuments({ role: 'merchant' });
    
    // Count all active users (customers)
    const totalCustomers = await User.countDocuments({ role: 'customer' });
    
    // Count orders
    const totalOrders = await Order.countDocuments();
    const completedOrders = await Order.countDocuments({ status: 'delivered' });
    const activeOrders = await Order.countDocuments({ 
      status: { $in: ['pending', 'assigned', 'picked_up', 'in_progress'] } 
    });

    // Real revenue: what customers actually paid on delivered orders
    // (items + delivery fee + tip). Previously this was orders * $45.
    const delivered = await Order.find({ status: 'delivered' }).select('amount deliveryFee tip');
    const revenue = delivered.reduce((sum, o) => sum + (o.amount || 0) + (o.deliveryFee || 0) + (o.tip || 0), 0);
    const avgOrderValue = delivered.length ? revenue / delivered.length : 0;

    // Calculate success rate
    const successRate = totalOrders > 0 ? Math.round((completedOrders / totalOrders) * 100) : 0;

    res.json({
      success: true,
      activeUsers: totalCustomers,
      activeOrders: activeOrders,
      totalOrders: totalOrders,
      completedOrders: completedOrders,
      totalMerchants: totalMerchants,
      totalDrivers: totalDrivers,
      onlineDrivers: onlineDrivers,
      totalRevenue: revenue.toFixed(2),
      avgOrderValue: avgOrderValue.toFixed(2),
      avgRating: 4.8,
      successRate: successRate
    });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ success: false, message: 'Error fetching statistics', error: err.message });
  }
});

module.exports = router;
