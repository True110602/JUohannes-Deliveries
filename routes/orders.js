const express = require('express');
const router = express.Router(); // <--- THIS was missing or in the wrong place
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

// --- UTILITIES & HELPERS ---

// Reject malformed ids up front
router.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid order id.' });
  }
  next();
});

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
const ROAD_DISTANCE_FACTOR = 1.3;

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

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
  if (!dropoff || !shopHasCoords) return { distanceKm: null, deliveryFee: FALLBACK_DELIVERY_FEE };
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

// --- ROUTES ---

// NEW: Handle Parcel Pick-and-Drop requests
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
    const io = req.app.get('io');
    notifyRole(io, User, 'driver', {
      title: 'New Parcel Available!',
      message: `Pick-up: ${pickupAddress} $\rightarrow$ Drop-off: ${dropoffAddress}`
    });
    res.status(201).json({ success: true, orderId: parcelOrder._id });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error creating parcel order' });
  }
});

// Standard Shop Order
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { pickup, dropoff, item, paymentMethod, ecocashNumber, mobileNumber, tip, lineItems: rawLineItems, useCredit } = req.body;
    if (!pickup || !dropoff) return res.status(400).json({ success: false, message: 'pickup and dropoff are required' });

    const chosenPaymentMethod = ALL_PAYMENT_METHODS.includes(paymentMethod) ? paymentMethod : 'Cash';
    const walletNumber = mobileNumber || ecocashNumber;
    if (MOBILE_MONEY_METHODS[chosenPaymentMethod] && !walletNumber) {
      return res.status(400).json({ success: false, message: `A mobile number is required for ${chosenPaymentMethod} payments` });
    }

    const priced = await priceLineItems(rawLineItems);
    if (priced.error) return res.status(400).json({ success: false, message: priced.error });
    
    const lineItems = priced.lineItems;
    const subtotalBeforeDiscount = priced.subtotal;
    const parsedTip = Number(tip);
    const tipAmount = Number.isFinite(parsedTip) ? Math.min(1000, Math.max(0, Math.round(parsedTip * 100) / 100)) : 0;

    const orderingCustomer = await User.findById(req.user.id);
    if (!orderingCustomer) return res.status(404).json({ success: false, message: 'Account not found.' });

    let discountApplied = 0;
    let creditApplied = 0;
    if (orderingCustomer.referredBy && !orderingCustomer.hasCompletedFirstOrder) {
      discountApplied = Math.round(subtotalBeforeDiscount * REFERRAL_DISCOUNT_RATE * 100) / 100;
    }
    if (useCredit && orderingCustomer.referralCredit > 0) {
      const remainingAfterDiscount = Math.max(0, subtotalBeforeDiscount - discountApplied);
      creditApplied = Math.min(orderingCustomer.referralCredit, remainingAfterDiscount);
    }

    const orderAmount = Math.max(0, subtotalBeforeDiscount - discountApplied - creditApplied);
    const pickupMerchantEmail = lineItems.find(li => li.merchantEmail)?.merchantEmail || null;
    const pickupShop = pickupMerchantEmail ? await User.findOne({ email: pickupMerchantEmail }).select('shopLat shopLng isOpen') : null;
    
    if (pickupShop && pickupShop.isOpen === false) {
      return res.status(400).json({ success: false, message: 'This shop is not accepting orders right now.' });
    }
    
    const { distanceKm, deliveryFee } = calculateDelivery(pickupShop, dropoff);
    const grandTotal = orderAmount + deliveryFee + tipAmount;

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
      if (!paynow) { order.paymentStatus = 'not_configured'; } 
      else {
        try {
          const payment = paynow.createPayment(`Order-${order._id}`, 'customer@example.com');
          payment.add(item || 'Delivery order', grandTotal);
          const response = await paynow.sendMobile(payment, walletNumber, MOBILE_MONEY_METHODS[chosenPaymentMethod]);
          if (response.success) {
            order.paymentStatus = 'pending';
            order.paynowPollUrl = response.pollUrl;
            order.paynowInstructions = response.instructions;
          } else { order.paymentStatus = 'failed'; order.paynowInstructions = response.error; }
        } catch (err) { order.paymentStatus = 'failed'; order.paynowInstructions = 'Could not reach Paynow.'; }
      }
    } else if (chosenPaymentMethod === 'BankTransfer') {
      order.paymentStatus = 'awaiting_bank_transfer';
      order.paynowInstructions = `Transfer $${grandTotal.toFixed(2)} to ${PLATFORM_BANK_DETAILS.bankName}...`;
    } else if (chosenPaymentMethod === 'Card') {
      order.paymentStatus = 'pending_manual';
      order.paynowInstructions = 'Pay by card on delivery.';
    }

    if (creditApplied > 0 && orderingCustomer) {
      orderingCustomer.referralCredit = Math.round((orderingCustomer.referralCredit - creditApplied) * 100) / 100;
      await orderingCustomer.save();
    }

    await order.save();
    const io = req.app.get('io');
    await broadcastOrders(io, order);
    notifyRole(io, User, 'admin', { title: 'New order placed', message: `${order.customerName} placed a $${grandTotal.toFixed(2)} order.`, relatedOrderId: order._id });
    
    const merchantEmails = [...new Set(order.lineItems.map(li => li.merchantEmail).filter(Boolean))];
    merchantEmails.forEach(email => notifyUser(io, email, { title: 'New order_
