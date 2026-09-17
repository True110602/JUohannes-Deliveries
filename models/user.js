// models/user.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, default: '' },
  password: { type: String, required: true },
  role: { type: String, enum: ['customer', 'driver', 'merchant', 'admin'], default: 'customer' },
  address: { type: String, default: '' },
  paymentMethod: { type: String, default: 'Cash' },
  profilePicUrl: { type: String, default: '' },
  // Merchant-only: the storefront name shown to customers browsing shops.
  // Falls back to the merchant's email on the frontend when left blank.
  shopName: { type: String, default: '' },
  // Merchant-only: where the shop physically is, used to calculate the
  // real pickup->dropoff distance the delivery fee is based on. Null
  // until the merchant sets it on the map in merchant.html; orders from
  // a shop with no coordinates fall back to a flat fee (see
  // FALLBACK_DELIVERY_FEE in routes/orders.js).
  shopLat: { type: Number, default: null },
  shopLng: { type: Number, default: null },
  // Merchant-only: lets a merchant temporarily stop taking orders
  // (closed for the day, out of stock, on holiday) without deleting
  // their catalog or being un-approved by an admin.
  isOpen: { type: Boolean, default: true },
  bankDetails: {
    bankName: { type: String, default: '' },
    accountName: { type: String, default: '' },
    accountNumber: { type: String, default: '' }
  },
  // Merchant accounts start unapproved and can't list items publicly
  // until an admin approves them - set explicitly to false at
  // registration for the merchant role. Every other role defaults to
  // true (approval doesn't apply to them) so nothing changes for
  // existing customer/driver/admin accounts.
  approved: { type: Boolean, default: true },
  resetCode: { type: String, default: null },
  resetCodeExpires: { type: Date, default: null },
  // Referral program: every account gets its own shareable code. If they
  // signed up using someone else's code, referredBy holds that person's
  // email so we know who to reward once this account's first order is
  // delivered. hasCompletedFirstOrder flips once, ever - it's what stops
  // the discount/reward pair from firing again on every later order.
  referralCode: { type: String, unique: true, sparse: true },
  referredBy: { type: String, default: null },
  hasCompletedFirstOrder: { type: Boolean, default: false },
  // Credit earned from referring friends (or, later, from other promos).
  // Stored as plain currency units, redeemable against a future order's
  // subtotal - see routes/orders.js.
  referralCredit: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
