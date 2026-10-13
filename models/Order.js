const mongoose = require('mongoose');

const lineItemSchema = new mongoose.Schema({
  catalogItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'CatalogItem' },
  merchantEmail: { type: String, default: null },
  name: { type: String, required: true },
  price: { type: Number, default: 0 },
  quantity: { type: Number, default: 1 },
  selectedOptions: { type: Object, default: {} }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  customerName: { type: String, required: true },
  customerEmail: { type: String, default: null },
  
  // NEW: Distinguish between buying from a shop and sending a parcel
  orderType: { type: String, enum: ['purchase', 'parcel'], default: 'purchase' },
  
  pickup: { type: String, required: true }, // Shop name for purchases, Address for parcels
  dropoff: { type: String, required: true },
  
  // NEW: Parcel specific contact/details
  pickupContact: { type: String, default: null },
  dropoffContact: { type: String, default: null },
  parcelDetails: { type: String, default: null },
  parcelSize: { type: String, default: null },

  item: { type: String, default: '' },
  lineItems: { type: [lineItemSchema], default: [] },
  amount: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'assigned', 'picked_up', 'delivered', 'cancelled', 'failed'], default: 'pending' },
  assignedDriver: { type: String, default: null },
  driverAccepted: { type: Boolean, default: null },
  pickupPhotoUrl: { type: String, default: '' },
  pickupPhotoAt: { type: Date, default: null },
  deliveryPhotoUrl: { type: String, default: '' },
  deliveryPhotoAt: { type: Date, default: null },
  paymentMethod: { type: String, default: 'Cash' },
  ecocashNumber: { type: String, default: null },
  paymentStatus: { type: String, default: 'n/a' },
  paynowPollUrl: { type: String, default: null },
  paynowInstructions: { type: String, default: null },
  driverCommission: { type: Number, default: 0 },
  distanceKm: { type: Number, default: null },
  deliveryFee: { type: Number, default: 0 },
  driverLat: { type: Number, default: null },
  driverLng: { type: Number, default: null },
  platformCommission: { type: Number, default: 0 },
  tip: { type: Number, default: 0 },
  discountApplied: { type: Number, default: 0 },
  creditApplied: { type: Number, default: 0 },
  referralRewardGranted: { type: Boolean, default: false },
  shopRating: { type: Number, min: 1, max: 5, default: null },
  driverRating: { type: Number, min: 1, max: 5, default: null },
  ratingComment: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
