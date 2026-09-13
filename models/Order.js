const mongoose = require('mongoose');

// One selected item within an order, tied back to the specific catalog
// item and merchant it came from. Lets the platform know exactly which
// merchant supplied what, at what price, with which options chosen -
// which the old single "item" text string could never support (it was
// just customer-facing display text, not queryable data).
const lineItemSchema = new mongoose.Schema({
  catalogItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'CatalogItem' },
  merchantEmail: { type: String, default: null },
  name: { type: String, required: true },
  price: { type: Number, default: 0 },
  quantity: { type: Number, default: 1 },
  selectedOptions: { type: Object, default: {} } // e.g. { Sauce: 'BBQ', Size: 'Large' }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  customerName: { type: String, required: true },
  // Populated automatically from the logged-in customer's account when
  // available - lets a customer look up their own order history. Kept
  // optional (not required) so nothing breaks for any order created
  // without a recognized token.
  customerEmail: { type: String, default: null },
  pickup: { type: String, required: true },
  dropoff: { type: String, required: true },
  item: { type: String, default: '' },
  // New, optional: structured breakdown of what was ordered. Empty for
  // any order placed before this field existed, or for simple Cash
  // orders with no catalog items attached - the old free-text "item"
  // field keeps working exactly as before regardless.
  lineItems: { type: [lineItemSchema], default: [] },
  amount: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'assigned', 'picked_up', 'delivered', 'cancelled', 'failed'], default: 'pending' },
  assignedDriver: { type: String, default: null },
  // null = no response yet from the assigned driver, true = accepted,
  // false = declined (in which case the order goes back to unassigned).
  // Previously an assignment was just forced onto a driver with no way
  // for them to signal they can't take it.
  driverAccepted: { type: Boolean, default: null },
  paymentMethod: { type: String, default: 'Cash' },
  ecocashNumber: { type: String, default: null },
  paymentStatus: { type: String, default: 'n/a' },
  paynowPollUrl: { type: String, default: null },
  paynowInstructions: { type: String, default: null },
  driverCommission: { type: Number, default: 0 },
  // New: what the platform itself keeps from this order (previously
  // undefined anywhere - only the driver's cut was ever calculated).
  platformCommission: { type: Number, default: 0 },
  // Tip goes 100% to the driver, on top of their normal commission - the
  // platform never takes a cut of tips.
  tip: { type: Number, default: 0 },
  // Referral program bookkeeping. discountApplied is the first-order
  // percentage discount (see REFERRAL_DISCOUNT_RATE in routes/orders.js);
  // creditApplied is any of the customer's own referral credit balance
  // they chose to redeem against this order. Both are already subtracted
  // out of `amount` by the time the order is saved - kept here separately
  // just so the receipt/history can show where the total came from.
  discountApplied: { type: Number, default: 0 },
  creditApplied: { type: Number, default: 0 },
  // Set once this order has triggered the referrer's reward, so a status
  // flip back and forth (e.g. delivered -> cancelled -> delivered again,
  // however unlikely) can never pay out twice for the same order.
  referralRewardGranted: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
