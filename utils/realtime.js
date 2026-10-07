const Order = require('../models/Order');

// Fields a customer never needs to see on their own order push.
function toCustomerView(order) {
  const o = order.toObject ? order.toObject() : { ...order };
  delete o.paynowPollUrl;
  delete o.platformCommission;
  return o;
}

// Sends order updates only to people entitled to see them:
//  - the 'admins' room gets the full order book (same payload as before)
//  - the customer who owns the order gets just that order, in their own room
// Never use io.emit() for order data: that reaches every connected socket.
async function broadcastOrders(io, order) {
  if (!io) return;
  try {
    const allOrders = await Order.find().sort({ createdAt: -1 });
    io.to('admins').emit('update_orders', allOrders);
    if (order && order.customerEmail) {
      io.to(order.customerEmail).emit('order_status_update', toCustomerView(order));
    }
  } catch (err) {
    console.error('broadcastOrders error:', err);
  }
}

module.exports = { broadcastOrders };
