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
  tip: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
