const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const SupportTicket = require('../models/SupportTicket');
const User = require('../models/user');
const { requireRole, JWT_SECRET } = require('../middleware/auth');
const { notifyUser, notifyRole } = require('../utils/notify');

function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return next();

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (!err) req.user = decoded;
    next();
  });
}

router.post('/', optionalAuth, async (req, res) => {
  try {
    const { name, email, subject, message, relatedOrderId } = req.body;

    if (typeof subject !== 'string' || !subject.trim()) {
      return res.status(400).json({ success: false, message: 'Subject is required.' });
    }
    if (typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Please describe the issue.' });
    }

    // --- IMPLEMENTED CRITICAL CHANGE ---
    // Find the admin to ensure this ticket is associated with an administrator
    const admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      console.error("Critical Error: No admin user found in database to handle support.");
      // We continue anyway so the user can submit, but log the error
    }

    const ticket = new SupportTicket({
      subject: subject.trim(),
      message: message.trim(),
      relatedOrderId: relatedOrderId || null,
      name: (req.user && req.user.email) ? req.user.email : (typeof name === 'string' ? name.trim() : ''),
      email: (req.user && req.user.email) || (typeof email === 'string' && email.trim() ? email.trim() : null),
      role: (req.user && req.user.role) || 'guest',
      // If your SupportTicket model has an 'assignedTo' field, we add it here:
      assignedTo: admin ? admin._id : null 
    });

    await ticket.save();

    // Notify the admin immediately
    notifyRole(req.app.get('io'), User, 'admin', {
      title: 'New support ticket',
      message: `${ticket.name || 'A guest'} reported: "${ticket.subject}"`
    });

    res.status(201).json({ success: true, message: "Thanks - we've logged your report and will follow up.", ticketId: ticket._id });
  } catch (err) {
    console.error('Create support ticket error:', err);
    res.status(500).json({ success: false, message: 'Could not submit your report. Please try again.' });
  }
});

// Admin-only inbox.
router.get('/', ...requireRole('admin'), async (req, res) => {
  try {
    const filter = {};
    if (['open', 'in_progress', 'resolved'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const tickets = await SupportTicket.find(filter).sort({ createdAt: -1 });
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.patch('/:id', ...requireRole('admin'), async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    const update = {};
    if (status !== undefined) {
      if (!['open', 'in_progress', 'resolved'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Invalid status.' });
      }
      update.status = status;
    }
    if (adminNote !== undefined) update.adminNote = adminNote;

    const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!ticket) return res.status(404).json({ success: false, message: 'Ticket not found.' });

    if (status !== undefined && ticket.email) {
      notifyUser(req.app.get('io'), ticket.email, {
        title: 'Your support ticket was updated',
        message: `"${ticket.subject}" is now ${status.replace('_', ' ')}.`
      });
    }

    res.json({ success: true, ticket });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
