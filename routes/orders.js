const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Order = require('../models/Order');
const User = require('../models/user');
const { requireRole, authenticateToken, JWT_SECRET } = require('../middleware/auth');

const DRIVER_COMMISSION_RATE = 0.10;   // 10% - drivers earn this share of each order's amount
// What the platform itself keeps from each order. Previously this had no
// defined value anywhere - only the driver's cut was ever calculated,
// which meant there was no visible answer to "how does this make money
// for its owner". The remainder (100% - driver - platform) is the
// merchant's share.
const PLATFORM_COMMISSION_RATE = 0.15; // 15% - adjust to whatever rate fits the business

// --- Referral program ---
// A customer who signed up with someone else's referral code gets this
// fraction off the subtotal of their first order only - hasCompletedFirstOrder
// on the User model is what prevents it firing again later.
const REFERRAL_DISCOUNT_RATE = 0.10;
// Flat amount credited to the REFERRER's own account once their friend's
// first order actually reaches "delivered" (not just placed - a discount
// on an order that's later cancelled shouldn't still pay out a reward).
const REFERRAL_REWARD_AMOUNT = 2;

// Mobile-money methods that go through Paynow's sendMobile() with a phone
// number. BankTransfer and Card have no live gateway integrated - they're
// recorded as orders awaiting manual confirmation (bank transfer: customer
// pays into the platform's account and admin/merchant reconciles; Card:
// paid on delivery/collection via card machine), same as Cash always was.
const MOBILE_MONEY_METHODS = { EcoCash: 'ecocash', OneMoney: 'onemoney' };
const MANUAL_PAYMENT_METHODS = ['Cash', 'BankTransfer', 'Card'];
const ALL_PAYMENT_METHODS = [...Object.keys(MOBILE_MONEY_METHODS), ...MANUAL_PAYMENT_METHODS];

// Platform bank details shown to the customer for BankTransfer orders -
// set these in the environment once a real business account exists.
const PLATFORM_BANK_DETAILS = {
  bankName: process.env.PLATFORM_BANK_NAME || '(bank name not configured)',
  accountName: process.env.PLATFORM_BANK_ACCOUNT_NAME || '(account name not configured)',
  accountNumber: process.env.PLATFORM_BANK_ACCOUNT_NUMBER || '(account number not configured)'
};

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
    const {
      customerName, pickup, dropoff, item, paymentMethod, ecocashNumber, mobileNumber,
      amount, tip, lineItems, useCredit
    } = req.body;

    if (!customerName || !pickup || !dropoff) {
      return res.status(400).json({ success: false, message: 'customerName, pickup, and dropoff are required' });
    }

    const chosenPaymentMethod = ALL_PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : 'Cash';
    // Kept as a single field name (ecocashNumber) on the Order model for
    // backward compatibility with existing saved orders - mobileNumber is
    // just the newer, payment-method-agnostic name the frontend can send
    // for either EcoCash or OneMoney.
    const walletNumber = mobileNumber || ecocashNumber;

    if (MOBILE_MONEY_METHODS[chosenPaymentMethod] && !walletNumber) {
      return res.status(400).json({ success: false, message: `A mobile number is required for ${chosenPaymentMethod} payments` });
    }

    // amount = item subtotal only, before any discount/credit. tip is kept
    // separate so the platform's commission is always based on the
    // subtotal, never on the driver's tip.
    const subtotalBeforeDiscount = parseFloat(amount) || 0;
    const tipAmount = Math.max(0, parseFloat(tip) || 0);

    // --- Referral discount + credit redemption ---
    // Both only apply to logged-in customers (a guest has no account to
    // hold a referral relationship or credit balance against).
    let discountApplied = 0;
    let creditApplied = 0;
    // NOTE: hasCompletedFirstOrder only flips to true once an order is
    // actually DELIVERED (see the /:id/status handler below), not merely
    // placed. That's deliberate (a cancelled first order shouldn't burn
    // the discount) but does mean a customer could place several orders
    // back-to-back, all discounted, before any of them is delivered.
    // Acceptable for a launch-stage promo; tighten later (e.g. flip the
    // flag at order-creation time instead) if abuse becomes a problem.
    let referredCustomer = null;
    if (req.user && req.user.email) {
      referredCustomer = await User.findById(req.user.id);
      if (referredCustomer) {
        if (referredCustomer.referredBy && !referredCustomer.hasCompletedFirstOrder) {
          discountApplied = Math.round(subtotalBeforeDiscount * REFERRAL_DISCOUNT_RATE * 100) / 100;
        }
        if (useCredit && referredCustomer.referralCredit > 0) {
          const remainingAfterDiscount = Math.max(0, subtotalBeforeDiscount - discountApplied);
          creditApplied = Math.min(referredCustomer.referralCredit, remainingAfterDiscount);
        }
      }
    }

    const orderAmount = Math.max(0, subtotalBeforeDiscount - discountApplied - creditApplied);
    const grandTotal = orderAmount + tipAmount; // what the customer actually pays

    if (MOBILE_MONEY_METHODS[chosenPaymentMethod] && grandTotal <= 0) {
      return res.status(400).json({ success: false, message: 'A valid amount is required for mobile money payments' });
    }

    const order = new Order({
      customerName,
      customerEmail: (req.user && req.user.email) || null,
      pickup,
      dropoff,
      item: item || '',
      lineItems: Array.isArray(lineItems) ? lineItems : [],
      amount: orderAmount,
      tip: tipAmount,
      discountApplied,
      creditApplied,
      paymentMethod: chosenPaymentMethod,
      ecocashNumber: walletNumber || null,
      // Driver gets their normal commission on the subtotal, PLUS the
      // entire tip - tips are never shared with the platform.
      driverCommission: (orderAmount * DRIVER_COMMISSION_RATE) + tipAmount,
      platformCommission: orderAmount * PLATFORM_COMMISSION_RATE
    });

    const paynow = req.app.get('paynow');

    if (MOBILE_MONEY_METHODS[chosenPaymentMethod]) {
      if (!paynow) {
        order.paymentStatus = 'not_configured';
      } else {
        try {
          const payment = paynow.createPayment(`Order-${order._id}`, 'customer@example.com');
          payment.add(item || 'Delivery order', grandTotal);

          const response = await paynow.sendMobile(payment, walletNumber, MOBILE_MONEY_METHODS[chosenPaymentMethod]);

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
    } else if (chosenPaymentMethod === 'BankTransfer') {
      order.paymentStatus = 'awaiting_bank_transfer';
      order.paynowInstructions = `Transfer $${grandTotal.toFixed(2)} to ${PLATFORM_BANK_DETAILS.bankName}, ` +
        `account name "${PLATFORM_BANK_DETAILS.accountName}", account number ${PLATFORM_BANK_DETAILS.accountNumber}, ` +
        `then keep your proof of payment - an admin will confirm it manually.`;
    } else if (chosenPaymentMethod === 'Card') {
      order.paymentStatus = 'pending_manual';
      order.paynowInstructions = 'Pay by card on delivery/collection - no online card payment is set up yet.';
    }

    // Deduct redeemed credit up front. If anything below throws before the
    // order actually saves, the customer simply keeps their credit (safe
    // failure direction) rather than losing it for an order that never
    // went through.
    if (creditApplied > 0 && referredCustomer) {
      referredCustomer.referralCredit = Math.round((referredCustomer.referralCredit - creditApplied) * 100) / 100;
      await referredCustomer.save();
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
    order.driverAccepted = null; // fresh assignment always needs a fresh response
    await order.save();

    const io = req.app.get('io');
    const allOrders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', allOrders);
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Driver accepts or declines an assignment. Declining puts the order back
// to unassigned so admin can hand it to someone else - previously an
// assignment was just forced onto a driver with no way to signal they
// can't take it.
router.patch('/:id/respond', ...requireRole('driver'), async (req, res) => {
  try {
    const { accepted } = req.body;
    if (typeof accepted !== 'boolean') {
      return res.status(400).json({ success: false, message: 'accepted (true/false) is required' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.assignedDriver !== req.user.email) {
      return res.status(403).json({ success: false, message: 'This order is not assigned to you.' });
    }

    order.driverAccepted = accepted;
    if (!accepted) {
      // Declined - free it up for reassignment rather than leaving it
      // stuck on a driver who can't take it.
      order.assignedDriver = null;
      order.status = 'pending';
    }
    await order.save();

    const io = req.app.get('io');
    const allOrders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', allOrders);
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Customer cancels their own order - only allowed while it's still
// pending (i.e. before a driver has been assigned). Once a driver is
// involved, cancelling needs admin's attention instead.
router.patch('/:id/cancel', authenticateToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.customerEmail !== req.user.email) {
      return res.status(403).json({ success: false, message: 'You can only cancel your own orders.' });
    }
    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'This order has already been assigned and can no longer be self-cancelled - please contact support.' });
    }

    order.status = 'cancelled';
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

    // Referral reward: fires once, the first time one of a referred
    // customer's orders actually reaches "delivered" - not on placement,
    // so a cancelled/failed first order never pays out a reward that a
    // completed delivery never happened for.
    if (status === 'delivered' && order.customerEmail && !order.referralRewardGranted) {
      const customer = await User.findOne({ email: order.customerEmail });
      if (customer && customer.referredBy && !customer.hasCompletedFirstOrder) {
        const referrer = await User.findOne({ email: customer.referredBy });
        if (referrer) {
          referrer.referralCredit = Math.round((referrer.referralCredit + REFERRAL_REWARD_AMOUNT) * 100) / 100;
          await referrer.save();
        }
        customer.hasCompletedFirstOrder = true;
        await customer.save();
        order.referralRewardGranted = true;
      }
    }

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
