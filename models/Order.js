const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  customerName: { type: String, required: true },
  pickup: { type: String, required: true },
  dropoff: { type: String, required: true },
  item: { type: String, default: '' },
  amount: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'assigned', 'picked_up', 'delivered', 'cancelled', 'failed'], default: 'pending' },
  assignedDriver: { type: String, default: null },
  paymentMethod: { type: String, default: 'Cash' },
  ecocashNumber: { type: String, default: null },
  paymentStatus: { type: String, default: 'n/a' },
  paynowPollUrl: { type: String, default: null },
  paynowInstructions: { type: String, default: null },
  driverCommission: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
