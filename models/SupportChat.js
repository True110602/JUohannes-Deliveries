const express = require('express');
const router = express.Router();
const SupportTicket = require('../models/SupportTicket');
const SupportChat = require('../models/SupportChat');
const SupportCall = require('../models/SupportCall');
const User = require('../models/user');
const { authenticateToken } = require('../middleware/auth');

// ==========================================
// SUPPORT CHAT ROUTES
// ==========================================

// Create or get existing chat for a support ticket
router.post('/chat', authenticateToken, async (req, res) => {
  try {
    const { ticketId, orderId } = req.body;

    if (!ticketId) {
      return res.status(400).json({ success: false, message: 'Ticket ID is required.' });
    }

    // Check if ticket exists
    const ticket = await SupportTicket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found.' });
    }

    // Check if chat already exists for this ticket
    let chat = await SupportChat.findOne({ ticketId });

    if (!chat) {
      // Create new chat
      const user = await User.findById(req.user.id);
      chat = new SupportChat({
        ticketId,
        orderId: orderId || null,
        participants: [{
          userId: req.user.id,
          email: user.email,
          role: req.user.role
        }]
      });
      await chat.save();
    }

    res.json({ success: true, chatId: chat._id });
  } catch (err) {
    console.error('Create chat error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get chat history for a support ticket
router.get('/chat/:ticketId', authenticateToken, async (req, res) => {
  try {
    const chat = await SupportChat.findOne({ ticketId: req.params.ticketId })
      .populate('participants.userId', 'email name')
      .populate('messages.senderId', 'email name');

    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat not found.' });
    }

    // Check permission: user must be participant, admin, or involved in related order
    const isParticipant = chat.participants.some(p => p.userId?._id.toString() === req.user.id);
    const isAdmin = req.user.role === 'admin';

    if (!isParticipant && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    res.json({ success: true, chat });
  } catch (err) {
    console.error('Get chat error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get all active chats for current user
router.get('/chats', authenticateToken, async (req, res) => {
  try {
    const chats = await SupportChat.find({
      'participants.userId': req.user.id,
      status: 'active'
    })
      .populate('participants.userId', 'email name')
      .sort({ lastActivityAt: -1 });

    res.json({ success: true, chats });
  } catch (err) {
    console.error('Get chats error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ==========================================
// SUPPORT CALL ROUTES
// ==========================================

// Initiate a support call
router.post('/call/initiate', authenticateToken, async (req, res) => {
  try {
    const { ticketId, chatId, callType } = req.body;

    if (!ticketId || !chatId) {
      return res.status(400).json({ success: false, message: 'Ticket and chat IDs required.' });
    }

    const user = await User.findById(req.user.id);
    const call = new SupportCall({
      ticketId,
      chatId,
      initiator: {
        userId: req.user.id,
        email: user.email,
        role: req.user.role
      },
      type: callType || 'audio',
      status: 'ringing',
      startTime: new Date()
    });

    await call.save();

    // Update chat to show call is active
    await SupportChat.findByIdAndUpdate(chatId, { isCallActive: true });

    res.json({ success: true, callId: call._id });
  } catch (err) {
    console.error('Initiate call error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Accept a call
router.patch('/call/:callId/accept', authenticateToken, async (req, res) => {
  try {
    const call = await SupportCall.findByIdAndUpdate(
      req.params.callId,
      {
        status: 'connected',
        'receiver.userId': req.user.id,
        'receiver.email': (await User.findById(req.user.id)).email
      },
      { new: true }
    );

    if (!call) {
      return res.status(404).json({ success: false, message: 'Call not found.' });
    }

    res.json({ success: true, call });
  } catch (err) {
    console.error('Accept call error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// End a call
router.patch('/call/:callId/end', authenticateToken, async (req, res) => {
  try {
    const call = await SupportCall.findById(req.params.callId);
    if (!call) {
      return res.status(404).json({ success: false, message: 'Call not found.' });
    }

    const endTime = new Date();
    const duration = Math.floor((endTime - call.startTime) / 1000); // Duration in seconds

    const updatedCall = await SupportCall.findByIdAndUpdate(
      req.params.callId,
      {
        status: 'ended',
        endTime,
        duration
      },
      { new: true }
    );

    // Update chat to show call is no longer active
    if (updatedCall.chatId) {
      await SupportChat.findByIdAndUpdate(updatedCall.chatId, { isCallActive: false });
    }

    res.json({ success: true, call: updatedCall });
  } catch (err) {
    console.error('End call error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get call history
router.get('/calls/:ticketId', authenticateToken, async (req, res) => {
  try {
    const calls = await SupportCall.find({ ticketId: req.params.ticketId })
      .sort({ createdAt: -1 });

    res.json({ success: true, calls });
  } catch (err) {
    console.error('Get calls error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
