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

// Reject malformed ids up front
router.param('id', (req, res, next, id) => {
  if (!mongoose.isValidObjectId(id)) {
    return res.status(400).json({ success: false, message: 'Invalid order id.' });
  }
  next();
});

// Helper to price line items from catalog
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
  const a = Math.sin(d
