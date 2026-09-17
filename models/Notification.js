const mongoose = require('mongoose');

// One row per person per notification (not one row shared across a role)
// so each person has their own independent read/unread state and their
// own list, even when the same event notifies several people at once
// (e.g. a new order notifies both the merchant and every admin).
const notificationSchema = new mongoose.Schema({
  recipientEmail: { type: String, required: true, index: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  relatedOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  read: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
