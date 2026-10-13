// ... existing imports ...
// ADD THIS TO YOUR IMPORTS if not already there:
// const { notifyRole } = require('../utils/notify');

// --- NEW PARCEL ROUTE ---
// POST /api/orders/parcel - Handle Pick-and-Drop requests
router.post('/parcel', ...requireRole('customer'), async (req, res) => {
  try {
    const { pickupAddress, pickupContact, dropoffAddress, dropoffContact, parcelDetails, size } = req.body;

    if (!pickupAddress || !dropoffAddress || !parcelDetails) {
      return res.status(400).json({ success: false, message: 'Missing required parcel details.' });
    }

    const parcelOrder = new Order({
      customerEmail: req.user.email,
      customerName: req.user.name,
      orderType: 'parcel', 
      pickup: pickupAddress, 
      dropoff: dropoffAddress,
      pickupContact,
      dropoffContact,
      parcelDetails,
      parcelSize: size,
      status: 'pending',
      paymentMethod: 'Cash', 
      amount: 0, 
    });

    await parcelOrder.save();
    
    // Notify all drivers about the new parcel
    const io = req.app.get('io');
    notifyRole(io, User, 'driver', {
      title: 'New Parcel Available!',
      message: `Pick-up: ${pickupAddress} $\rightarrow$ Drop-off: ${dropoffAddress}`
    });

    res.status(201).json({ success: true, orderId: parcelOrder._id });
  } catch (err) {
    console.error('Parcel order error:', err);
    res.status(500).json({ success: false, message: 'Server error creating parcel order' });
  }
});

// ... Keep all your other routes (POST /, GET /, GET /mine, PATCH /:id/assign, etc.) exactly as they were ...
module.exports = router;
