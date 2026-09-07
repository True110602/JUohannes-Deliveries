const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Order = require('../models/Order');
const { requireRole, authenticateToken, JWT_SECRET } = require('../middleware/auth');

const DRIVER_COMMISSION_RATE = 0.10;   // 10% - drivers earn this share of each order's amount
// What the platform itself keeps from each order. Previously this had no
// defined value anywhere - only the driver's cut was ever calculated,
// which meant there was no visible answer to "how does this make money
// for its owner". The remainder (100% - driver - platform) is the
// merchant's share.
const PLATFORM_COMMISSION_RATE = 0.15; // 15% - adjust to whatever rate fits the business

// Reads a Bearer token if one is present, without failing the request if
// it's missing or invalid - used here so an order can be linked to the
// customer's account when they're logged in, without turning this into a
// route that suddenly requires auth (customer.html already gates the
// order page behind login today, but this keeps the endpoint itself
// exactly as permissive as it was before).
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return next();

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (!err) req.user = decoded;
    next();
  });
}

router.post('/', optionalAuth, async (req, res) => {
  try {
    const { customerName, pickup, dropoff, item, paymentMethod, ecocashNumber, amount, lineItems } = req.body;

    if (!customerName || !pickup || !dropoff) {
      return res.status(400).json({ success: false, message: 'customerName, pickup, and dropoff are required' });
    }
    if (paymentMethod === 'EcoCash' && !ecocashNumber) {
      return res.status(400).json({ success: false, message: 'EcoCash number is required for EcoCash payments' });
    }

    const orderAmount = parseFloat(amount) || 0;
    if (paymentMethod === 'EcoCash' && orderAmount <= 0) {
      return res.status(400).json({ success: false, message: 'A valid amount is required for EcoCash payments' });
    }

    const order = new Order({
      customerName,
      customerEmail: (req.user && req.user.email) || null,
      pickup,
      dropoff,
      item: item || '',
      lineItems: Array.isArray(lineItems) ? lineItems : [],
      amount: orderAmount,
      paymentMethod: paymentMethod || 'Cash',
      ecocashNumber: ecocashNumber || null,
      driverCommission: orderAmount * DRIVER_COMMISSION_RATE,
      platformCommission: orderAmount * PLATFORM_COMMISSION_RATE
    });

    const paynow = req.app.get('paynow');

    if (paymentMethod === 'EcoCash') {
      if (!paynow) {
        order.paymentStatus = 'not_configured';
      } else {
        try {
          const payment = paynow.createPayment(`Order-${order._id}`, 'customer@example.com');
          payment.add(item || 'Delivery order', orderAmount);

          const response = await paynow.sendMobile(payment, ecocashNumber, 'ecocash');

          if (response.success) {
            order.paymentStatus = 'pending';
            order.paynowPollUrl = response.pollUrl;
            order.paynowInstructions = response.instructions;
          } else {
            order.paymentStatus = 'failed';
            order.paynowInstructions = response.error;
          }
        } catch (err) {
          console.error('Paynow error:', err);
          order.paymentStatus = 'failed';
          order.paynowInstructions = 'Could not reach Paynow. Please try again.';
        }
      }
    }

    await order.save();

    const io = req.app.get('io');
    const allOrders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', allOrders);

    res.status(201).json({ success: true, order });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ success: false, message: 'Server error creating order' });
  }
});

// Admin-only: the full order book, across every customer. Previously this
// had no auth check at all, so anyone with the URL could see every
// customer's name, pickup/dropoff, and order amount.
router.get('/', ...requireRole('admin'), async (req, res) => {
  try {
    const allOrders = await Order.find().sort({ createdAt: -1 });
    res.json(allOrders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// Driver-only: orders assigned to the logged-in driver.
router.get('/mine', ...requireRole('driver'), async (req, res) => {
  try {
    const myOrders = await Order.find({ assignedDriver: req.user.email }).sort({ createdAt: -1 });
    res.json(myOrders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Customer order history - previously impossible, since orders had no
// link back to the account that placed them at all.
router.get('/my-history', authenticateToken, async (req, res) => {
  try {
    const myOrders = await Order.find({ customerEmail: req.user.email }).sort({ createdAt: -1 });
    res.json(myOrders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/:id/assign', ...requireRole('admin'), async (req, res) => {
  try {
    const { driverEmail } = req.body;
    if (!driverEmail) {
      return res.status(400).json({ success: false, message: 'driverEmail is required' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    order.assignedDriver = driverEmail;
    order.status = 'assigned';
    await order.save();

    const io = req.app.get('io');
    const allOrders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', allOrders);
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/:id/status', ...requireRole('admin', 'driver'), async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'assigned', 'picked_up', 'delivered', 'cancelled', 'failed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of: ${validStatuses.join(', ')}` });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    order.status = status;
    await order.save();

    const io = req.app.get('io');
    const allOrders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', allOrders);
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/:id/payment-status', authenticateToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    const paynow = req.app.get('paynow');
    if (!order.paynowPollUrl || !paynow) {
      return res.json({ success: true, paymentStatus: order.paymentStatus });
    }

    const status = await paynow.pollTransaction(order.paynowPollUrl);
    order.paymentStatus = status.paid() ? 'paid' : (status.status || order.paymentStatus).toLowerCase();
    await order.save();

    const io = req.app.get('io');
    const allOrders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', allOrders);
    res.json({ success: true, paymentStatus: order.paymentStatus });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not check payment status' });
  }
});

module.exports = router;
