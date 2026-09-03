const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { Paynow } = require('paynow');
const { Server } = require('socket.io');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);

// Render (and most hosts like it) terminate HTTPS at their edge and
// forward requests to this app over plain HTTP internally. Without
// this line, Express can't reliably tell the connection is secure,
// which matters for the session cookie settings below.
app.set('trust proxy', 1);

// --- CORS ---
const corsOptions = {
  origin: process.env.CLIENT_ORIGIN || true,
  credentials: true
};
app.use(cors(corsOptions));

const io = new Server(server, {
  cors: corsOptions
});

// --- MIDDLEWARE SETUP ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================================================================
// DATABASE CONNECTION
// A real database is required now so that users, orders, and the catalog
// all survive server restarts and redeploys - the in-memory/file-based
// storage this app used before was wiped every time Render redeployed.
// =========================================================================
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. This app now requires a MongoDB connection to store data persistently. Set MONGODB_URI in your environment variables and restart.');
  process.exit(1);
}

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Session store also lives in MongoDB now, so logins survive restarts too
// - previously every redeploy silently logged everyone out because the
// default session store only lives in server memory.
app.use(session({
  secret: process.env.SESSION_SECRET || 'johannes-deliveries-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGODB_URI, collectionName: 'sessions' }),
  cookie: {
    secure: 'auto',
    sameSite: 'none'
  }
}));

// =========================================================================
// MODELS
// =========================================================================
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['customer', 'driver', 'merchant', 'admin'], required: true },
  address: { type: String, default: '' },
  paymentMethod: { type: String, default: '' }
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

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
const Order = mongoose.model('Order', orderSchema);

const catalogItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  inStock: { type: Boolean, default: true }
}, { timestamps: true });
const CatalogItem = mongoose.model('CatalogItem', catalogItemSchema);

const driverLocationSchema = new mongoose.Schema({
  driverId: { type: String, required: true, unique: true },
  lat: Number,
  lng: Number
}, { timestamps: true });
const DriverLocation = mongoose.model('DriverLocation', driverLocationSchema);

// Seed the four demo portal accounts (customer/driver/merchant/admin, all
// password "1234") the first time the server runs against a fresh
// database, if they don't already exist.
async function seedDemoUsers() {
  const demoRoles = ['customer', 'driver', 'merchant', 'admin'];
  for (const role of demoRoles) {
    const exists = await User.findOne({ email: role });
    if (!exists) {
      await User.create({
        email: role,
        passwordHash: bcrypt.hashSync('1234', 10),
        role: role
      });
    }
  }
}
mongoose.connection.once('open', () => {
  seedDemoUsers().catch(err => console.error('Error seeding demo users:', err));
});

// --- DRIVER COMMISSION ---
// Drivers earn this percentage of each order's amount for orders they
// deliver. Stored on the order itself at creation time (rather than
// computed on the fly from the current rate) so past orders keep showing
// what was actually earned even if this rate changes later.
const DRIVER_COMMISSION_RATE = 0.10; // 10%

// --- PAYNOW (EcoCash payments) ---
const PAYNOW_INTEGRATION_ID = process.env.PAYNOW_INTEGRATION_ID;
const PAYNOW_INTEGRATION_KEY = process.env.PAYNOW_INTEGRATION_KEY;
const PUBLIC_URL = process.env.PUBLIC_URL || '';

let paynow = null;
if (PAYNOW_INTEGRATION_ID && PAYNOW_INTEGRATION_KEY) {
  paynow = new Paynow(PAYNOW_INTEGRATION_ID, PAYNOW_INTEGRATION_KEY);
  paynow.resultUrl = `${PUBLIC_URL}/api/payments/paynow-result`;
  paynow.returnUrl = `${PUBLIC_URL}/customer.html`;
  console.log('Paynow configured - EcoCash payments are live');
} else {
  console.warn('PAYNOW_INTEGRATION_ID / PAYNOW_INTEGRATION_KEY not set - EcoCash orders will be recorded but no real payment request will be sent.');
}

// =========================================================================
// AUTH
// =========================================================================
function requireAuth(allowedRoles) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      if (req.accepts('html')) {
        return res.redirect('/login.html');
      }
      return res.status(401).json({ success: false, message: 'Not logged in' });
    }
    if (allowedRoles && !allowedRoles.includes(req.session.user.role)) {
      if (req.accepts('html')) {
        return res.status(403).send('Forbidden: your account does not have access to this page.');
      }
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    next();
  };
}

app.get('/api/check-session', (req, res) => {
  if (req.session && req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    req.session.user = {
      email: user.email,
      role: user.role
    };

    return res.json({
      success: true,
      message: 'Login successful',
      redirectUrl: `/${user.role}.html`
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

app.get('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Could not log out' });
    }
    res.redirect('/login.html');
  });
});

app.post('/api/register', async (req, res) => {
  try {
    const { email, password, address, paymentMethod, role } = req.body;

    if (!email || !password || !address || !paymentMethod) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    // Only customer and merchant accounts can be self-registered. Driver
    // and admin accounts are set up separately (currently the seeded demo
    // accounts) since those need vetting rather than open sign-up.
    const allowedSelfRegisterRoles = ['customer', 'merchant'];
    const chosenRole = allowedSelfRegisterRoles.includes(role) ? role : 'customer';

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({ email, passwordHash, role: chosenRole, address, paymentMethod });

    return res.status(200).json({ success: true, message: 'Registration successful!' });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ success: false, message: 'Server registration error' });
  }
});

// =========================================================================
// ORDERS
// =========================================================================
app.post('/api/orders', async (req, res) => {
  try {
    const { customerName, pickup, dropoff, item, paymentMethod, ecocashNumber, amount } = req.body;

    if (!customerName || !pickup || !dropoff) {
      return res.status(400).json({ success: false, message: 'customerName, pickup, and dropoff are required' });
    }
    if (paymentMethod === 'EcoCash' && !ecocashNumber) {
      return res.status(400).json({ success: false, message: 'EcoCash number is required for EcoCash payments' });
    }

    const orderAmount = parseFloat(amount) || 0;
    if (paymentMethod === 'EcoCash' && orderAmount <= 0) {
      return res.status(400).json({ success: false, message: 'A valid amount is required for EcoCash payments' });
    }

    const order = new Order({
      customerName,
      pickup,
      dropoff,
      item: item || '',
      amount: orderAmount,
      paymentMethod: paymentMethod || 'Cash',
      ecocashNumber: ecocashNumber || null,
      driverCommission: orderAmount * DRIVER_COMMISSION_RATE
    });

    if (paymentMethod === 'EcoCash') {
      if (!paynow) {
        order.paymentStatus = 'not_configured';
      } else {
        try {
          const customerEmail = (req.session.user && req.session.user.email) || 'customer@example.com';
          const payment = paynow.createPayment(`Order-${order._id}`, customerEmail);
          payment.add(item || 'Delivery order', orderAmount);

          const response = await paynow.sendMobile(payment, ecocashNumber, 'ecocash');

          if (response.success) {
            order.paymentStatus = 'pending';
            order.paynowPollUrl = response.pollUrl;
            order.paynowInstructions = response.instructions;
          } else {
            order.paymentStatus = 'failed';
            order.paynowInstructions = response.error;
          }
        } catch (err) {
          console.error('Paynow error:', err);
          order.paymentStatus = 'failed';
          order.paynowInstructions = 'Could not reach Paynow. Please try again.';
        }
      }
    }

    await order.save();

    const allOrders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', allOrders);

    res.status(201).json({ success: true, order });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ success: false, message: 'Server error creating order' });
  }
});

app.get('/api/orders', async (req, res) => {
  try {
    const allOrders = await Order.find().sort({ createdAt: -1 });
    res.json(allOrders);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error fetching orders' });
  }
});

app.patch('/api/orders/:id/assign', requireAuth(['admin']), async (req, res) => {
  try {
    const { driverEmail } = req.body;
    if (!driverEmail) {
      return res.status(400).json({ success: false, message: 'driverEmail is required' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    order.assignedDriver = driverEmail;
    order.status = 'assigned';
    await order.save();

    const allOrders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', allOrders);
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error assigning driver' });
  }
});

app.patch('/api/orders/:id/status', requireAuth(['admin', 'driver']), async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'assigned', 'picked_up', 'delivered', 'cancelled', 'failed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: `status must be one of: ${validStatuses.join(', ')}` });
    }

    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    order.status = status;
    await order.save();

    const allOrders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', allOrders);
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error updating status' });
  }
});

app.get('/api/orders/:id/payment-status', requireAuth(), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    if (!order.paynowPollUrl || !paynow) {
      return res.json({ success: true, paymentStatus: order.paymentStatus });
    }

    const status = await paynow.pollTransaction(order.paynowPollUrl);
    order.paymentStatus = status.paid() ? 'paid' : (status.status || order.paymentStatus).toLowerCase();
    await order.save();

    const allOrders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', allOrders);
    res.json({ success: true, paymentStatus: order.paymentStatus });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Could not check payment status' });
  }
});

app.post('/api/payments/paynow-result', async (req, res) => {
  try {
    const { reference, status } = req.body;
    const match = /^Order-([a-f0-9]+)$/.exec(reference || '');

    if (match) {
      const order = await Order.findById(match[1]);
      if (order) {
        order.paymentStatus = (status || '').toLowerCase() || order.paymentStatus;
        await order.save();
        const allOrders = await Order.find().sort({ createdAt: -1 });
        io.emit('update_orders', allOrders);
      }
    }
    res.sendStatus(200);
  } catch (err) {
    res.sendStatus(200); // Paynow just needs a 200 acknowledgement either way
  }
});

// =========================================================================
// CATALOG
// =========================================================================
app.get('/api/catalog', async (req, res) => {
  try {
    const items = await CatalogItem.find().sort({ createdAt: 1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error fetching catalog' });
  }
});

app.post('/api/catalog', requireAuth(['merchant']), async (req, res) => {
  try {
    const { name, price } = req.body;
    if (!name || price === undefined) {
      return res.status(400).json({ success: false, message: 'Name and price are required' });
    }

    const item = await CatalogItem.create({ name, price: parseFloat(price), inStock: true });
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error creating catalog item' });
  }
});

app.patch('/api/catalog/:id/stock', requireAuth(['merchant']), async (req, res) => {
  try {
    const item = await CatalogItem.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: 'Item not found' });
    }
    item.inStock = !item.inStock;
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error updating stock' });
  }
});

// =========================================================================
// PROTECTED DASHBOARD PAGES
// =========================================================================
app.get('/admin.html', requireAuth(['admin']), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/driver.html', requireAuth(['driver']), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'driver.html'));
});
app.get('/merchant.html', requireAuth(['merchant']), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'merchant.html'));
});
app.get('/customer.html', requireAuth(['customer']), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'customer.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// =========================================================================
// SOCKET.IO - REAL-TIME MAP & FLEET TRACKING
// Last known driver positions are now saved to MongoDB too (upserted per
// driver), so the admin map can show where drivers were even right after
// a restart, before any of them reconnect.
// =========================================================================
io.on('connection', async (socket) => {
  console.log('A user connected:', socket.id);

  try {
    const savedLocations = await DriverLocation.find();
    socket.emit('update_fleet', savedLocations.map(d => ({ driverId: d.driverId, lat: d.lat, lng: d.lng })));
  } catch (err) {
    console.error('Error loading saved driver locations:', err);
  }

  socket.on('driver_connect', async (data) => {
    try {
      await DriverLocation.findOneAndUpdate(
        { driverId: data.driverId },
        { lat: data.lat, lng: data.lng },
        { upsert: true }
      );
      const allDrivers = await DriverLocation.find();
      io.emit('update_fleet', allDrivers.map(d => ({ driverId: d.driverId, lat: d.lat, lng: d.lng })));
    } catch (err) {
      console.error('Error saving driver location:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// --- START SERVER ---
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
