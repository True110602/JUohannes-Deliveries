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
  resetCodeExpires: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
