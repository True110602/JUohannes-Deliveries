const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/user');
const { requireRole, authenticateToken } = require('../middleware/auth');
const { notifyUser, notifyRole } = require('../utils/notify');

// Drivers are paid per kilometre travelled (shop -> drop-off) rather
// than a percentage of the order. A 10% cut used to mean a long trip for
// a cheap order paid worse than a short trip for an expensive one, which
// is backwards from the driver's actual cost (fuel and time scale with
// distance, not with the price of the food).
const DELIVERY_FEE_PER_KM = 1.00;
// Used when the shop hasn't set its coordinates yet, so a merchant who
// hasn't filled in their location doesn't accidentally get free delivery.
const FALLBACK_DELIVERY_FEE = 2.00;
// Floor for very short trips - a 200m delivery still costs the driver
// time and fuel to make.
const MINIMUM_DELIVERY_FEE = 1.00;
// What the platform itself keeps from each order. Previously this had no
// defined value anywhere - only the driver's cut was ever calculated,
// which meant there was no visible answer to "how does this make money
// for its owner". The remainder is the merchant's share.
const PLATFORM_COMMISSION_RATE = 0.15; // 15% - adjust to whatever rate fits the business

// Straight-line (great-circle) distance in km between two lat/lng points.
// Real road distance is longer, so this is scaled up slightly below to
// land closer to actual driving distance without needing a routing API.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // earth radius in km
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Roads don't run in straight lines. 1.3x is a commonly used rough
// correction factor for urban street networks - good enough for pricing
// without the cost/complexity of a routing service.
const ROAD_DISTANCE_FACTOR = 1.3;

// Parses the "lat, lng" string the customer's map picker produces.
// Returns null for anything that isn't a usable coordinate pair, so a
// free-text dropoff (older orders, manual entry typos) degrades to the
// flat fallback fee instead of throwing.
function parseCoords(str) {
  if (typeof str !== 'string') return null;
  const parts = str.split(',').map(p => parseFloat(p.trim()));
  if (parts.length !== 2 || parts.some(isNaN)) return null;
  const [lat, lng] = parts;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

// Returns { distanceKm, deliveryFee }. distanceKm is null when we can't
// determine a real distance (shop location unset, or unparseable
// dropoff), in which case the flat fallback fee applies.
function calculateDelivery(shop, dropoffStr) {
  const dropoff = parseCoords(dropoffStr);
  const shopHasCoords = shop && typeof shop.shopLat === 'number' && typeof shop.shopLng === 'number';

  if (!dropoff || !shopHasCoords) {
    return { distanceKm: null, deliveryFee: FALLBACK_DELIVERY_FEE };
  }

  const straightLine = haversineKm(shop.shopLat, shop.shopLng, dropoff.lat, dropoff.lng);
  const distanceKm = Math.round(straightLine * ROAD_DISTANCE_FACTOR * 100) / 100;
  const fee = Math.max(MINIMUM_DELIVERY_FEE, distanceKm * DELIVERY_FEE_PER_KM);
  return { distanceKm, deliveryFee: Math.round(fee * 100) / 100 };
}

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

router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      pickup, dropoff, item, paymentMethod, ecocashNumber, mobileNumber,
      amount, tip, lineItems, useCredit
    } = req.body;

    if (!pickup || !dropoff) {
      return res.status(400).json({ success: false, message: 'pickup and dropoff are required' });
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
    // Every order now belongs to a logged-in account (see authenticateToken
    // above), so this always has a real user to check.
    let discountApplied = 0;
    let creditApplied = 0;
    // NOTE: hasCompletedFirstOrder only flips to true once an order is
    // actually DELIVERED (see the /:id/status handler below), not merely
    // placed. That's deliberate (a cancelled first order shouldn't burn
    // the discount) but does mean a customer could place several orders
    // back-to-back, all discounted, before any of them is delivered.
    // Acceptable for a launch-stage promo; tighten later (e.g. flip the
    // flag at order-creation time instead) if abuse becomes a problem.
    const orderingCustomer = await User.findById(req.user.id);
    if (!orderingCustomer) {
      // Shouldn't happen with a valid token (the account it points to was
      // deleted?), but better to fail loudly than create an order with no
      // real customer behind it.
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }
    if (orderingCustomer.referredBy && !orderingCustomer.hasCompletedFirstOrder) {
      discountApplied = Math.round(subtotalBeforeDiscount * REFERRAL_DISCOUNT_RATE * 100) / 100;
    }
    if (useCredit && orderingCustomer.referralCredit > 0) {
      const remainingAfterDiscount = Math.max(0, subtotalBeforeDiscount - discountApplied);
      creditApplied = Math.min(orderingCustomer.referralCredit, remainingAfterDiscount);
    }

    const orderAmount = Math.max(0, subtotalBeforeDiscount - discountApplied - creditApplied);

    // --- Delivery fee ---
    // Based on the real distance from the shop to the drop-off. The
    // merchant of the first line item is treated as the pickup point;
    // multi-shop orders are rare here and would need a multi-leg route
    // to price properly, so this deliberately keeps it simple.
    const pickupMerchantEmail = Array.isArray(lineItems) && lineItems.length
      ? lineItems.find(li => li.merchantEmail)?.merchantEmail
      : null;
    const pickupShop = pickupMerchantEmail
      ? await User.findOne({ email: pickupMerchantEmail }).select('shopLat shopLng isOpen')
      : null;
    if (pickupShop && pickupShop.isOpen === false) {
      return res.status(400).json({ success: false, message: 'This shop is not accepting orders right now.' });
    }
    const { distanceKm, deliveryFee } = calculateDelivery(pickupShop, dropoff);

    const grandTotal = orderAmount + deliveryFee + tipAmount; // what the customer actually pays

    if (MOBILE_MONEY_METHODS[chosenPaymentMethod] && grandTotal <= 0) {
      return res.status(400).json({ success: false, message: 'A valid amount is required for mobile money payments' });
    }

    const order = new Order({
      // Pulled from the account rather than trusted from the client - the
      // customer no longer types this in on every order, and a logged-in
      // user can no longer submit an order under a different display name
      // than their own account.
      customerName: orderingCustomer.name,
      customerEmail: req.user.email,
      pickup,
      dropoff,
      item: item || '',
      lineItems: Array.isArray(lineItems) ? lineItems : [],
      amount: orderAmount,
      tip: tipAmount,
      discountApplied,
      creditApplied,
      distanceKm,
      deliveryFee,
      paymentMethod: chosenPaymentMethod,
      ecocashNumber: walletNumber || null,
      // Driver earns the full distance-based delivery fee plus 100% of
      // the tip. The platform takes no cut of either - its revenue is the
      // commission on the order subtotal below.
      driverCommission: deliveryFee + tipAmount,
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
    if (creditApplied > 0 && orderingCustomer) {
      orderingCustomer.referralCredit = Math.round((orderingCustomer.referralCredit - creditApplied) * 100) / 100;
      await orderingCustomer.save();
    }

    await order.save();

    const io = req.app.get('io');
    const allOrders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', allOrders);

    // Notify admins (someone needs to assign a driver) and every merchant
    // whose items are actually in this order - a merchant with nothing in
    // the cart shouldn't be pinged about it.
    notifyRole(io, User, 'admin', {
      title: 'New order placed',
      message: `${order.customerName} placed a $${grandTotal.toFixed(2)} order - needs a driver assigned.`,
      relatedOrderId: order._id
    });
    const merchantEmails = [...new Set(order.lineItems.map(li => li.merchantEmail).filter(Boolean))];
    merchantEmails.forEach(email => notifyUser(io, email, {
      title: 'New order for your shop',
      message: `${order.customerName} just placed an order including your items.`,
      relatedOrderId: order._id
    }));

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
    const myOrders = await Order.find({ assignedDriver: req.user.email }).sort({ createdAt: -1 }).lean();

    // Attach the customer's phone number for in-progress deliveries only -
    // a driver has a real reason to call about an active delivery, but
    // there's no reason to keep exposing someone's number on an order
    // that finished weeks ago. One bulk lookup rather than one query per
    // order.
    const activeEmails = [...new Set(
      myOrders.filter(o => ['assigned', 'picked_up'].includes(o.status)).map(o => o.customerEmail).filter(Boolean)
    )];
    const customers = await User.find({ email: { $in: activeEmails } }).select('email phone');
    const phoneByEmail = new Map(customers.map(c => [c.email, c.phone]));

    const enriched = myOrders.map(o => ({
      ...o,
      customerPhone: phoneByEmail.get(o.customerEmail) || null
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Customer order history - previously impossible, since orders had no
// link back to the account that placed them at all.
router.get('/my-history', authenticateToken, async (req, res) => {
  try {
    const myOrders = await Order.find({ customerEmail: req.user.email }).sort({ createdAt: -1 }).lean();

    // Same reasoning as /mine above, mirrored for the customer's side -
    // the driver's phone only matters while the delivery is actually in
    // progress.
    const activeDriverEmails = [...new Set(
      myOrders.filter(o => ['assigned', 'picked_up'].includes(o.status)).map(o => o.assignedDriver).filter(Boolean)
    )];
    const drivers = await User.find({ email: { $in: activeDriverEmails } }).select('email phone');
    const phoneByEmail = new Map(drivers.map(d => [d.email, d.phone]));

    const enriched = myOrders.map(o => ({
      ...o,
      driverPhone: o.assignedDriver ? (phoneByEmail.get(o.assignedDriver) || null) : null
    }));

    res.json(enriched);
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

    notifyUser(io, driverEmail, {
      title: 'New delivery assigned to you',
      message: `You've been assigned an order for ${order.customerName}. Please accept or decline it.`,
      relatedOrderId: order._id
    });
    notifyUser(io, order.customerEmail, {
      title: 'Driver assigned',
      message: 'A driver has been assigned to your order and should confirm shortly.',
      relatedOrderId: order._id
    });

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

    if (accepted) {
      notifyUser(io, order.customerEmail, {
        title: 'Your order is on its way',
        message: 'Your driver has accepted the order and is heading to pick it up.',
        relatedOrderId: order._id
      });
    } else {
      notifyRole(io, User, 'admin', {
        title: 'Driver declined an order',
        message: `${req.user.email} declined the order for ${order.customerName} - it needs reassigning.`,
        relatedOrderId: order._id
      });
    }

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

    notifyRole(io, User, 'admin', {
      title: 'Customer cancelled an order',
      message: `${order.customerName} cancelled their order before a driver was assigned.`,
      relatedOrderId: order._id
    });

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
    let referrerToNotify = null;
    if (status === 'delivered' && order.customerEmail && !order.referralRewardGranted) {
      const customer = await User.findOne({ email: order.customerEmail });
      if (customer && customer.referredBy && !customer.hasCompletedFirstOrder) {
        const referrer = await User.findOne({ email: customer.referredBy });
        if (referrer) {
          referrer.referralCredit = Math.round((referrer.referralCredit + REFERRAL_REWARD_AMOUNT) * 100) / 100;
          await referrer.save();
          referrerToNotify = referrer.email;
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

    const STATUS_LABELS = {
      pending: 'pending', assigned: 'assigned to a driver', picked_up: 'picked up',
      delivered: 'delivered', cancelled: 'cancelled', failed: 'marked as failed'
    };
    notifyUser(io, order.customerEmail, {
      title: 'Order status updated',
      message: `Your order is now ${STATUS_LABELS[status] || status}.`,
      relatedOrderId: order._id
    });
    if (referrerToNotify) {
      notifyUser(io, referrerToNotify, {
        title: 'You earned referral credit!',
        message: `A friend you referred just completed their first order - $${REFERRAL_REWARD_AMOUNT.toFixed(2)} credit has been added to your account.`
      });
    }

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

// Delivery fee quote, so the checkout page can show the real fee before
// the customer commits rather than surprising them after they order.
// Uses exactly the same calculation the real order does, so the quote
// and the charge can never drift apart.
router.post('/quote', authenticateToken, async (req, res) => {
  try {
    const { merchantEmail, dropoff } = req.body;
    const shop = merchantEmail
      ? await User.findOne({ email: merchantEmail }).select('shopLat shopLng')
      : null;
    const { distanceKm, deliveryFee } = calculateDelivery(shop, dropoff);
    res.json({
      success: true,
      distanceKm,
      deliveryFee,
      // Lets the frontend explain WHY a fee is what it is, instead of
      // showing an unexplained flat charge.
      estimated: distanceKm === null
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Customer rates a delivered order - the shop, the driver, or both.
// Restricted to the customer who placed it, and only once it's actually
// been delivered, so ratings always reflect a real completed order.
router.post('/:id/rate', authenticateToken, async (req, res) => {
  try {
    const { shopRating, driverRating, ratingComment } = req.body;

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });
    if (order.customerEmail !== req.user.email) {
      return res.status(403).json({ success: false, message: 'You can only rate your own orders.' });
    }
    if (order.status !== 'delivered') {
      return res.status(400).json({ success: false, message: 'You can only rate an order once it has been delivered.' });
    }
    if (order.shopRating || order.driverRating) {
      return res.status(400).json({ success: false, message: 'You have already rated this order.' });
    }

    const validRating = (v) => v === undefined || v === null || (Number.isInteger(v) && v >= 1 && v <= 5);
    if (!validRating(shopRating) || !validRating(driverRating)) {
      return res.status(400).json({ success: false, message: 'Ratings must be a whole number from 1 to 5.' });
    }

    if (shopRating) order.shopRating = shopRating;
    if (driverRating) order.driverRating = driverRating;
    if (typeof ratingComment === 'string') order.ratingComment = ratingComment.trim().slice(0, 500);
    await order.save();

    const io = req.app.get('io');
    const merchantEmail = order.lineItems.find(li => li.merchantEmail)?.merchantEmail;
    if (shopRating && merchantEmail) {
      notifyUser(io, merchantEmail, {
        title: `New ${shopRating}-star review`,
        message: order.ratingComment || `${order.customerName} rated their order ${shopRating}/5.`,
        relatedOrderId: order._id
      });
    }
    if (driverRating && order.assignedDriver) {
      notifyUser(io, order.assignedDriver, {
        title: `New ${driverRating}-star rating`,
        message: `${order.customerName} rated your delivery ${driverRating}/5.`,
        relatedOrderId: order._id
      });
    }

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Average rating + review list for a shop, so customers can see it before
// ordering. Public - part of the browse-without-an-account experience.
router.get('/ratings/shop/:merchantEmail', async (req, res) => {
  try {
    const orders = await Order.find({
      'lineItems.merchantEmail': req.params.merchantEmail,
      shopRating: { $ne: null }
    }).select('shopRating ratingComment customerName createdAt').sort({ createdAt: -1 }).limit(20);

    const average = orders.length
      ? Math.round((orders.reduce((sum, o) => sum + o.shopRating, 0) / orders.length) * 10) / 10
      : null;

    res.json({
      success: true,
      average,
      count: orders.length,
      reviews: orders.filter(o => o.ratingComment).map(o => ({
        rating: o.shopRating,
        comment: o.ratingComment,
        customerName: o.customerName,
        createdAt: o.createdAt
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
