// ADD THIS TO YOUR routes/admin.js FILE

/**
 * GET /api/admin/drivers-locations
 * Get all active driver locations for the map
 */
router.get('/drivers-locations', requireRole('admin'), async (req, res) => {
  try {
    // Import DriverLocation model if not already done
    // const DriverLocation = require('../models/DriverLocation');
    
    const driverLocations = await DriverLocation.find({ isActive: true })
      .sort({ updatedAt: -1 })
      .select('latitude longitude driverName phone status');

    res.json({
      success: true,
      drivers: driverLocations || []
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/**
 * GET /api/admin/stats
 * Get system-wide statistics
 */
router.get('/stats', requireRole('admin'), async (req, res) => {
  try {
    const User = require('../models/user');
    const Order = require('../models/Order');

    const activeUsers = await User.countDocuments({ lastActive: { $gt: new Date(Date.now() - 30*60*1000) } });
    const totalMerchants = await User.countDocuments({ role: 'merchant' });
    const totalDrivers = await User.countDocuments({ role: 'driver' });
    const totalOrders = await Order.countDocuments();
    const totalRevenue = (await Order.aggregate([
      { $group: { _id: null, total: { $sum: '$totalPrice' } } }
    ]))[0]?.total || 0;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const avgRating = 4.8; // Calculate from reviews if available
    const successRate = 98; // Calculate from orders if available

    res.json({
      success: true,
      activeUsers,
      totalMerchants,
      totalDrivers,
      totalOrders,
      totalRevenue: parseFloat(totalRevenue.toFixed(2)),
      avgOrderValue: parseFloat(avgOrderValue.toFixed(2)),
      avgRating: parseFloat(avgRating.toFixed(1)),
      successRate
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

module.exports = router;
