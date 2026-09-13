const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const SupportTicket = require('../models/SupportTicket');
const { requireRole, JWT_SECRET } = require('../middleware/auth');

// Same pattern as routes/orders.js's optionalAuth - a ticket should be
// filable by a guest who hasn't even registered yet (e.g. "the app won't
// let me place an order"), so this never rejects a request just because
// there's no token. If a valid token IS present, we trust its email/role
// over whatever the client sent, so a ticket always resolves to the real
// logged-in account rather than a spoofable name field.
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

    const ticket = new SupportTicket({
      subject: subject.trim(),
      message: message.trim(),
      relatedOrderId: relatedOrderId || null,
      // Logged-in identity always wins over client-supplied fields.
      name: (req.user && req.user.email) ? req.user.email : (typeof name === 'string' ? name.trim() : ''),
      email: (req.user && req.user.email) || (typeof email === 'string' && email.trim() ? email.trim() : null),
      role: (req.user && req.user.role) || 'guest'
    });

    await ticket.save();
    res.status(201).json({ success: true, message: "Thanks - we've logged your report and will follow up.", ticketId: ticket._id });
  } catch (err) {
    console.error('Create support ticket error:', err);
    res.status(500).json({ success: false, message: 'Could not submit your report. Please try again.' });
  }
});

// Admin-only inbox. ?status=open|in_progress|resolved filters; omit for all.
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
    res.json({ success: true, ticket });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
