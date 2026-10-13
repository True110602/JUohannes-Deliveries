const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const User = require('../models/user');
const { requireRole, authenticateToken } = require('../middleware/auth');
const { notifyUser, notifyRole } = require('../utils/notify');
const upload = require('../middleware/upload');
const CatalogItem = require('../models/CatalogItem');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { broadcastOrders } = require('../utils/realtime');

// Reject malformed ids up front so Mongoose CastErrors never reach the
// client as a 500 with a raw error message.
router.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid order id.' });
  }
  next();
});

// Builds the order's line items and subtotal from the catalog, never from
// client-supplied prices. The client only says WHICH item, how many, and
// which options; name, price and merchant all come from the database.
async function priceLineItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 50) {
    return { error: 'Your order must contain between 1 and 50 items.' };
  }
  const ids = [];
  for (const li of rawItems) {
    if (!li || !mongoose.isValidObjectId(li.catalogItemId)) {
      return { error: 'Each item must reference a valid catalog item.' };
    }
    ids.push(String(li.catalogItemId));
  }
  const catalog = await CatalogItem.find({ _id: { $in: ids } });
  const byId = new Map(catalog.map(c => [String(c._id), c]));

  const lineItems = [];
  let subtotal = 0;
  for (const li of rawItems) {
    const cat = byId.get(String(li.catalogItemId));
    if (!cat) return { error: 'One of the items in your order no longer exists.' };
    if (cat.inStock === false) return { error: `"${cat.name}" is out of stock.` };

    const quantity = Number(li.quantity === undefined ? 1 : li.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      return { error: `Invalid quantity for "${cat.name}".` };
    }

    // Only accept option choices the merchant actually offers.
    const selectedOptions = {};
    const sent = li.selectedOptions && typeof li.selectedOptions === 'object' ? li.selectedOptions : {};
    for (const [group, choice] of Object.entries(sent)) {
      const def = (cat.optionGroups || []).find(g => g.groupName === group);
      if (!def || typeof choice !== 'string' || !def.choices.includes(choice)) {
        return { error: `Invalid option selected for "${cat.name}".` };
      }
      selectedOptions[group] = choice;
    }

    subtotal += cat.price * quantity;
    lineItems.push({
      catalogItemId: cat._id,
      merchantEmail: cat.merchantEmail,
      name: cat.name,
      price: cat.price,
      quantity,
      selectedOptions
    });
  }
  return { lineItems, subtotal: Math.round(subtotal * 100) / 100 };
}

// Which status changes are legal, and who may make them.
const STATUS_TRANSITIONS = {
  pending: ['cancelled'],
  assigned: ['pending', 'picked_up', 'failed', 'cancelled'],
  picked_up: ['delivered', 'failed', 'cancelled'],
  delivered: [],
  cancelled: [],
  failed: []
};
const DRIVER_ALLOWED_TARGETS = ['picked_up', 'delivered', 'failed'];

function discardUpload(file) {
  if (!file || !file.path) return;
  fs.unlink(file.path, () => {});
}

const DELIVERY_FEE_PER_KM = 1.00;
const FALLBACK_DELIVERY_FEE = 2.00;
const MINIMUM_DELIVERY_FEE = 1.00;
const PLATFORM_COMMISSION_RATE = 0.15; 

// Straight-line (great-circle) distance in km between two lat/lng points.
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // earth radius in km
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const ROAD_DISTANCE_FACTOR = 1.3;

function parseCoords(str) {
  if (typeof str !== 'string') return null;
  const parts = str.split(',').map(p => parseFloat(p.trim()));
  if (parts.length !== 2 || parts.some(isNaN)) return null;
  const [lat, lng] = parts;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

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

const REFERRAL_DISCOUNT_RATE = 0.10;
const REFERRAL_REWARD_AMOUNT = 2;

const MOBILE_MONEY_METHODS = { EcoCash: 'ecocash', OneMoney: 'onemoney' };
const MANUAL_PAYMENT_METHODS = ['Cash', 'BankTransfer', 'Card'];
const ALL_PAYMENT_METHODS = [...Object.keys(MOBILE_MONEY_METHODS), ...MANUAL_PAYMENT_METHODS];

const PLATFORM_BANK_DETAILS = {
  bankName: process.env.PLATFORM_BANK_NAME || '(bank name not configured)',
  accountName: process.env.PLATFORM_BANK_ACCOUNT_NAME || '(account name not configured)',
  accountNumber: process.env.PLATFORM_BANK_ACCOUNT_NUMBER || '(account number not configured)'
};

router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      pickup, dropoff, item, paymentMethod, ecocashNumber, mobileNumber,
      tip, lineItems: rawLineItems, useCredit
    } = req.body;

    if (!pickup || !dropoff) {
      return res.status(400).json({ success: false, message: 'pickup and dropoff are required' });
    }

    const chosenPaymentMethod = ALL_PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : 'Cash';
    const walletNumber = mobileNumber || ecocashNumber;

    if (MOBILE_MONEY_METHODS[chosenPaymentMethod] && !walletNumber) {
      return res.status(400).json({ success: false, message: `A mobile number is required for ${chosenPaymentMethod} payments` });
    }

    const priced = await priceLineItems(rawLineItems);
    if (priced.error) {
      return res.status(400).json({ success: false, message: priced.error });
    }
    const lineItems = priced.lineItems;
    const subtotalBeforeDiscount = priced.subtotal;
    const parsedTip = Number(tip);
    const tipAmount = Number.isFinite(parsedTip) ? Math.min(1000, Math.max(0, Math.round(parsedTip * 100) / 100)) : 0;

    let discountApplied = 0;
    let creditApplied = 0;
    const orderingCustomer = await User.findById(req.user.id);
    if (!orderingCustomer) {
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

    const pickupMerchantEmail = lineItems.find(li => li.merchantEmail)?.merchantEmail || null;
    const pickupShop = pickupMerchantEmail
      ? await User.findOne({ email: pickupMerchantEmail }).select('shopLat shopLng isOpen')
      : null;
    if (pickupShop && pickupShop.isOpen === false) {
      return res.status(400).json({ success: false, message: 'This shop is not accepting orders right now.' });
    }
    const { distanceKm, deliveryFee } = calculateDelivery(pickupShop, dropoff);

    const grandTotal = orderAmount + deliveryFee + tipAmount; 

    if (MOBILE_MONEY_METHODS[chosenPaymentMethod] && grandTotal <= 0) {
      return res.status(400).json({ success: false, message: 'A valid amount is required for mobile money payments' });
    }

    const order = new Order({
      customerName: orderingCustomer.name,
      customerEmail: req.user.email,
      pickup,
      dropoff,
      item: item || '',
      lineItems,
      amount: orderAmount,
      tip: tipAmount,
      discountApplied,
      creditApplied,
      distanceKm,
      deliveryFee,
      paymentMethod: chosenPaymentMethod,
      ecocashNumber: walletNumber || null,
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

    if (creditApplied > 0 && orderingCustomer) {
      orderingCustomer.referralCredit = Math.round((orderingCustomer.referralCredit - creditApplied) * 100) / 100;
      await orderingCustomer.save();
    }

    await order.save();

    const io = req.app.get('io');
    await broadcastOrders(io, order);

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

router.get('/', ...requireRole('admin'), async (req, res) => {
  try {
    const allOrders = await Order.find().sort({ createdAt: -1 });
    res.json(allOrders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/mine', ...requireRole('driver'), async (req, res) => {
  try {
    const myOrders = await Order.find({ assignedDriver: req.user.email }).sort({ createdAt: -1 }).lean();
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

router.get('/my-history', authenticateToken, async (req, res) => {
  try {
    const myOrders = await Order.find({ customerEmail: req.user.email }).sort({ createdAt: -1 }).lean();
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
    if (typeof driverEmail !== 'string') {
      return res.status(400).json({ success: false, message: 'driverEmail must be a string' });
    }
    if (!['pending', 'assigned'].includes(order.status)) {
      return res.status(400).json({ success: false, message: `An order that is ${order.status} cannot be (re)assigned.` });
    }
    const driver = await User.findOne({ email: driverEmail, role: 'driver' }).select('email');
    if (!driver) {
      return res.status(400).json({ success: false, message: 'No driver account with that email.' });
    }
    order.assignedDriver = driverEmail;
    order.status = 'assigned';
    order.driverAccepted = null; 
    await order.save();
    const io = req.app.get('io');
    await broadcastOrders(io, order);
    io.to(driverEmail).emit('new_order', order);
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
      order.assignedDriver = null;
      order.status = 'pending';
    }
    await order.save();
    const io = req.app.get('io');
    await broadcastOrders(io, order);
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
    await broadcastOrders(io, order);
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

router.patch('/:id/status', ...requireRole('admin', 'driver'), (req, res, next) => {
  upload.single('photo')(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message || 'Photo upload failed.' });
    next();
  });
}, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'assigned', 'picked_up', 'delivered', 'cancelled', 'failed'];
    if (typeof status !== 'string' || !validStatuses.includes(status)) {
      discardUpload(req.file);
      return res.status(400).json({ success: false, message: `status must be one of: ${validStatuses.join(', ')}` });
    }
    const order = await Order.findById(req.params.id);
    if (!order) {
      discardUpload(req.file);
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    if (req.user.role === 'driver') {
      if (order.assignedDriver !== req.user.email) {
        discardUpload(req.file);
        return res.status(403).json({ success: false, message: 'This order is not assigned to you.' });
      }
      if (order.driverAccepted === false) {
        discardUpload(req.file);
        return res.status(403).json({ success: false, message: 'You declined this order.' });
      }
      if (!DRIVER_ALLOWED_TARGETS.includes(status)) {
        discardUpload(req.file);
        return res.status(403).json({ success: false, message: 'Drivers can only mark an order picked up, delivered or failed.' });
      }
    }
    if (status === 'assigned') {
      discardUpload(req.file);
      return res.status(400).json({ success: false, message: 'Use the assign endpoint to assign a driver.' });
    }
    if (!(STATUS_TRANSITIONS[order.status] || []).includes(status)) {
      discardUpload(req.file);
      return res.status(400).json({ success: false, message: `An order that is ${order.status} cannot be changed to ${status}.` });
    }
    order.status = status;
    if (status === 'pending') {
      order.assignedDriver = null;
      order.driverAccepted = null;
    }
    let photoCaptured = false;
    if (req.file && (status === 'picked_up' || status === 'delivered')) {
      const photoUrl = `/uploads/${req.file.filename}`;
      if (status === 'picked_up') {
        order.pickupPhotoUrl = photoUrl;
        order.pickupPhotoAt = new Date();
      } else {
        order.deliveryPhotoUrl = photoUrl;
        order.deliveryPhotoAt = new Date();
      }
      photoCaptured = true;
    }
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
    await broadcastOrders(io, order);
    const STATUS_LABELS = {
      pending: 'pending', assigned: 'assigned to a driver', picked_up: 'picked up',
      delivered: 'delivered', cancelled: 'cancelled', failed: 'marked as failed'
    };
    const photoNote = photoCaptured ? ' A photo was taken as proof.' : '';
    notifyUser(io, order.customerEmail, {
      title: 'Order status updated',
      message: `Your order is now ${STATUS_LABELS[status] || status}.${photoNote}`,
      relatedOrderId: order._id
    });
    if (status === 'picked_up' || status === 'delivered') {
      notifyRole(io, User, 'admin', {
        title: `Order ${STATUS_LABELS[status]}`,
        message: `Order #${order._id.toString().slice(-6)} (${order.customerName}) was just ${STATUS_LABELS[status]} by ${order.assignedDriver || 'a driver'}.${photoNote}`,
        relatedOrderId: order._id
      });
    }
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
    if (req.user.role !== 'admin' && order.customerEmail !== req.user.email) {
      return res.status(403).json({ success: false, message: 'You can only check your own orders.' });
    }
    const paynow = req.app.get('paynow');
    if (!order.paynowPollUrl || !paynow) {
      return res.json({ success: true, paymentStatus: order.paymentStatus });
    }
    const status = await paynow.pollTransaction(order.paynowPollUrl);
    order.paymentStatus = status.paid() ? 'paid' : (status.status || order.paymentStatus).toLowerCase();
    await order.save();
    const io = req.app.get('io');
    await broadcastOrders(io, order);
    res.json({ success: true, paymentStatus: order.paymentStatus });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not check payment status' });
  }
});

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
      estimated: distanceKm === null
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

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
