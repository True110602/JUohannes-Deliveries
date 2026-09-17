const Notification = require('../models/Notification');

// Persists the notification (so it's still there next time they open the
// app, even if they weren't online right now) AND pushes it live over
// Socket.IO to that person's room if they're currently connected - see
// the 'register' handler in server.js for how sockets join that room.
// Silently does nothing if email is missing, so callers never need to
// guard against e.g. a guest order having no customerEmail.
async function notifyUser(io, email, { title, message, relatedOrderId } = {}) {
  if (!email) return;
  try {
    const notification = await Notification.create({
      recipientEmail: email,
      title,
      message,
      relatedOrderId: relatedOrderId || null
    });
    io.to(email).emit('notification', notification);
  } catch (err) {
    // A failed notification should never take down the request that
    // triggered it (e.g. don't fail order creation just because the
    // notification write had a hiccup) - log and move on.
    console.error('notifyUser error:', err);
  }
}

// Notifies every user with a given role (e.g. every admin) - each gets
// their own persisted, independently-readable notification.
async function notifyRole(io, User, role, payload) {
  try {
    const users = await User.find({ role }).select('email');
    await Promise.all(users.map(u => notifyUser(io, u.email, payload)));
  } catch (err) {
    console.error('notifyRole error:', err);
  }
}

module.exports = { notifyUser, notifyRole };
