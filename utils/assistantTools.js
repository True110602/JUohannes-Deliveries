// utils/assistantTools.js
// Read-only look-ups the AI assistant can run. Every query is scoped on the server:
// the model never gets to choose whose orders to read - that comes from the logged-in user.
const User = require('../models/user');
const CatalogItem = require('../models/CatalogItem');
const Order = require('../models/Order');

const SHOP_CATEGORIES = ['Food', 'Grocery', 'Pharmacy', 'Hardware', 'Other'];
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

const toolDefinitions = [
  {
    name: 'search_shops',
    description: 'Find approved shops on the app. Optionally filter by vendor type and/or a search word that matches the shop name or the name of something it sells (e.g. "pizza", "panadol"). Returns up to 10 shops with a shop_id you can pass to get_shop_menu.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: SHOP_CATEGORIES, description: 'Vendor type: Food, Grocery, Pharmacy, Hardware (tools & parts) or Other' },
        query: { type: 'string', description: 'Word to match against shop names and item names' }
      }
    }
  },
  {
    name: 'get_shop_menu',
    description: 'Get the items (name, price in USD, availability, options) that one shop sells. Use the shop_id from search_shops. Optionally filter items by a search word. Returns up to 25 items.',
    input_schema: {
      type: 'object',
      properties: {
        shop_id: { type: 'string', description: 'The shop_id returned by search_shops' },
        query: { type: 'string', description: 'Optional word to filter item names' }
      },
      required: ['shop_id']
    }
  },
  {
    name: 'get_my_orders',
    description: "Get the logged-in user's most recent orders with status and totals (their own orders as a customer, their assigned deliveries as a driver, orders containing their items as a merchant, or recent orders overall for an admin).",
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 10, description: 'How many recent orders (default 5)' } }
    }
  }
];

async function searchShops(input) {
  const category = SHOP_CATEGORIES.includes(input.category) ? input.category : null;
  const query = clip(input.query, 60).trim();

  const merchants = await User.find({ role: 'merchant', approved: true }).select('email shopName shopCategory isOpen');
  if (!merchants.length) return { shops: [], total_matches: 0 };
  const emails = merchants.map(m => m.email);

  const stats = await CatalogItem.aggregate([
    { $match: { merchantEmail: { $in: emails } } },
    { $group: { _id: '$merchantEmail', count: { $sum: 1 }, categories: { $addToSet: '$category' } } }
  ]);
  const statsByEmail = new Map(stats.map(s => [s._id, s]));

  let emailsWithMatchingItem = null;
  if (query) {
    const hits = await CatalogItem.find({ merchantEmail: { $in: emails }, name: new RegExp(escapeRegex(query), 'i') }).select('merchantEmail');
    emailsWithMatchingItem = new Set(hits.map(h => h.merchantEmail));
  }

  const shops = [];
  for (const m of merchants) {
    const st = statsByEmail.get(m.email);
    const itemCategories = (st && st.categories) || [];
    const type = m.shopCategory || itemCategories.find(c => c && c !== 'Other') || 'Other';
    if (category && type !== category) continue;
    if (query) {
      const nameHit = (m.shopName || '').toLowerCase().includes(query.toLowerCase());
      if (!nameHit && !emailsWithMatchingItem.has(m.email)) continue;
    }
    shops.push({ shop_id: m.email, name: m.shopName || m.email, type, open_now: m.isOpen !== false, item_count: st ? st.count : 0 });
  }
  return { shops: shops.slice(0, 10), total_matches: shops.length };
}

async function getShopMenu(input) {
  const shopId = clip(input.shop_id, 120).trim();
  if (!shopId) return { error: 'shop_id is required' };
  const shop = await User.findOne({ email: shopId, role: 'merchant', approved: true }).select('email shopName isOpen');
  if (!shop) return { error: 'Shop not found' };

  const filter = { merchantEmail: shop.email };
  const query = clip(input.query, 60).trim();
  if (query) filter.name = new RegExp(escapeRegex(query), 'i');

  const [items, total] = await Promise.all([
    CatalogItem.find(filter).sort({ name: 1 }).limit(25).select('name price description inStock optionGroups'),
    CatalogItem.countDocuments(filter)
  ]);
  return {
    shop: shop.shopName || shop.email,
    open_now: shop.isOpen !== false,
    items_total: total,
    items: items.map(i => ({
      name: i.name,
      price_usd: i.price,
      in_stock: i.inStock !== false,
      description: clip(i.description, 120),
      options: (i.optionGroups || []).map(g => `${g.groupName}: ${(g.choices || []).join(' / ')}`)
    }))
  };
}

async function getMyOrders(input, user) {
  const limit = Math.min(10, Math.max(1, parseInt(input.limit, 10) || 5));
  let filter;
  if (user.role === 'customer') filter = { customerEmail: user.email };
  else if (user.role === 'driver') filter = { assignedDriver: user.email };
  else if (user.role === 'merchant') filter = { 'lineItems.merchantEmail': user.email };
  else if (user.role === 'admin') filter = {};
  else return { error: 'No orders available for this account type' };

  const orders = await Order.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  return {
    orders: orders.map(o => {
      const lines = (o.lineItems || []).filter(l => user.role !== 'merchant' || l.merchantEmail === user.email);
      const row = {
        ref: String(o._id).slice(-6),
        status: o.status,
        type: o.orderType || 'purchase',
        items: lines.length ? lines.map(l => `${l.quantity || 1}x ${l.name}`).join(', ') : clip(o.item, 100),
        placed: o.createdAt ? new Date(o.createdAt).toISOString() : null
      };
      if (user.role === 'merchant') {
        row.item_total_usd = lines.reduce((s, l) => s + (Number(l.price) || 0) * (Number(l.quantity) || 0), 0);
      } else {
        row.total_usd = o.amount;
        row.delivery_fee_usd = o.deliveryFee;
        row.payment_method = o.paymentMethod;
        row.payment_status = o.paymentStatus;
      }
      if (user.role === 'customer' || user.role === 'driver') { row.pickup = clip(o.pickup, 120); row.dropoff = clip(o.dropoff, 120); }
      return row;
    })
  };
}

async function executeTool(name, input, user) {
  const args = input && typeof input === 'object' ? input : {};
  switch (name) {
    case 'search_shops': return searchShops(args);
    case 'get_shop_menu': return getShopMenu(args);
    case 'get_my_orders': return getMyOrders(args, user);
    default: return { error: 'Unknown tool' };
  }
}

module.exports = { toolDefinitions, executeTool };
