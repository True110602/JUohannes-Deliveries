const mongoose = require('mongoose');

// Support chat messages between users (customer/driver/merchant) and admins
// or between customer and assigned driver for delivery-specific issues
const supportChatSchema = new mongoose.Schema({
  // Support ticket this chat belongs to
  ticketId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SupportTicket',
    required: true
  },

  // Related order if this is about a delivery
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null
  },

  // Who's participating
  participants: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    email: String,
    role: { type: String, enum: ['customer', 'driver', 'merchant', 'admin'] },
    joinedAt: { type: Date, default: Date.now }
  }],

  // Chat messages
  messages: [{
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    senderName: String,
    senderRole: String,
    text: String,
    timestamp: { type: Date, default: Date.now },
    read: { type: Boolean, default: false }
  }],

  status: {
    type: String,
    enum: ['active', 'on_hold', 'closed'],
    default: 'active'
  },

  isCallActive: { type: Boolean, default: false },
  lastActivityAt: { type: Date, default: Date.now }

}, { timestamps: true });

// Update lastActivityAt whenever a message is added
supportChatSchema.pre('save', function(next) {
  this.lastActivityAt = new Date();
  next();
});

module.exports = mongoose.model('SupportChat', supportChatSchema);
