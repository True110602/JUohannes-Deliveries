const mongoose = require('mongoose');

// A simple support/dispute channel - lets a customer, merchant, or driver
// report a problem from inside the app instead of having no way at all to
// reach anyone. Deliberately minimal (no threaded replies) so it can ship
// quickly; adminNote/status is enough for an admin to triage and close
// things out, and can be extended later without a breaking schema change.
const supportTicketSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  email: { type: String, default: null },
  role: { type: String, default: 'guest' }, // customer/driver/merchant/admin/guest
  subject: { type: String, required: true },
  message: { type: String, required: true },
  // Optional - lets a ticket about a specific delivery link straight back
  // to it instead of admin having to search by customer name/time.
  relatedOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
  status: { type: String, enum: ['open', 'in_progress', 'resolved'], default: 'open' },
  adminNote: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);
