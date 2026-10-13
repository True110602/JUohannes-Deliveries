const mongoose = require('mongoose');

// Support calls (audio/video) between users
// Tracks call history, duration, quality, participants
const supportCallSchema = new mongoose.Schema({
  // Support ticket and chat this call is part of
  ticketId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SupportTicket',
    required: true
  },

  chatId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SupportChat',
    required: true
  },

  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    default: null
  },

  // Call participants
  initiator: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    email: String,
    role: String
  },

  receiver: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    email: String,
    role: String
  },

  // Call details
  type: {
    type: String,
    enum: ['audio', 'video'],
    default: 'audio'
  },

  status: {
    type: String,
    enum: ['ringing', 'connected', 'ended', 'missed', 'declined'],
    default: 'ringing'
  },

  startTime: Date,
  endTime: Date,

  // Call duration in seconds
  duration: { type: Number, default: 0 },

  // Call quality metrics (optional)
  quality: {
    audioQuality: { type: String, enum: ['excellent', 'good', 'fair', 'poor'] },
    videoQuality: { type: String, enum: ['hd', 'sd', 'low'] },
    packetLoss: Number,
    latency: Number
  },

  // Notes from either participant
  notes: String,

  // Recording reference (if available)
  recordingUrl: String

}, { timestamps: true });

module.exports = mongoose.model('SupportCall', supportCallSchema);
