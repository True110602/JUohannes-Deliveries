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
  // Photo proof the driver captures at each handoff point - lets the
  // customer and admin see the order was actually picked up/delivered,
  // not just told so.
  pickupPhotoUrl: { type: String, default: '' },
  pickupPhotoAt: { type: Date, default: null },
  deliveryPhotoUrl: { type: String, default: '' },
  deliveryPhotoAt: { type: Date, default: null },
  paymentMethod: { type: String, default: 'Cash' },
  ecocashNumber: { type: String, default: null },
  paymentStatus: { type: String, default: 'n/a' },
  paynowPollUrl: { type: String, default: null },
  paynowInstructions: { type: String, default: null },
  // What the driver earns for this delivery: the distance-based delivery
  // fee plus 100% of the tip. Drivers used to get a 10% cut of the order
  // subtotal instead - that was replaced by per-kilometre pay so a long
  // trip for a cheap order is no longer paid worse than a short trip for
  // an expensive one.
  driverCommission: { type: Number, default: 0 },
  // Distance between the shop and the drop-off, and the fee derived from
  // it. distanceKm is null when the shop hasn't set its coordinates yet,
  // in which case deliveryFee falls back to a flat amount.
  distanceKm: { type: Number, default: null },
  deliveryFee: { type: Number, default: 0 },
  // Live driver position for this specific order, so the customer can
  // watch their delivery move. Updated over Socket.IO while the order is
  // in progress; null before a driver has reported any position.
  driverLat: { type: Number, default: null },
  driverLng: { type: Number, default: null },
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
  referralRewardGranted: { type: Boolean, default: false },
  // Customer's rating of this delivery, 1-5, plus optional comment. One
  // rating per order (not per shop/driver) so a review is always tied to
  // a real completed transaction rather than being postable by anyone.
  // shopRating covers the merchant, driverRating the driver.
  shopRating: { type: Number, min: 1, max: 5, default: null },
  driverRating: { type: Number, min: 1, max: 5, default: null },
  ratingComment: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
