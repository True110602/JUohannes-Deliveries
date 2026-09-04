// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs'); // switched from native bcrypt - pure JS, no compile step that can fail on deploy
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { Paynow } = require('paynow');
const path = require('path');

const User = require('./models/user');
const DriverLocation = require('./models/DriverLocation');
const { authenticateToken, JWT_SECRET } = require('./middleware/auth');
const catalogRoutes = require('./routes/catalog');
const orderRoutes = require('./routes/orders');
const merchantRoutes = require('./routes/merchant');

const app = express();
const server = http.createServer(app);

// --- SOCKET.IO ---
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});
// Stored on the app so route files (routes/orders.js etc.) can reach it
// without needing to pass it through every function call.
app.set('io', io);

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// --- MONGOOSE DATABASE SETUP ---
// NOTE: reads MONGODB_URI specifically - this must match the exact name
// of the environment variable set on Render. A previous version read
// MONGO_URI with a silent fallback to a local address that doesn't exist
// on Render, which meant the app appeared to start fine while the
// database was actually never connected.
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('------------------------------------------------------------');
  console.error('CRITICAL ERROR: MONGODB_URI is not set.');
  console.error('Set it in your environment variables (Render \u2192 Environment).');
  console.error('------------------------------------------------------------');
  process.exit(1);
}

mongoose.connect(MONGODB_URI)
  .then(() => console.log('\u2705 Connected to MongoDB'))
  .catch((err) => {
    console.error('\u274c MongoDB Connection Error:', err);
    process.exit(1);
  });

// Seed the demo portal accounts the first time the server runs against a
// fresh database, if they don't already exist.
async function seedDemoUsers() {
  const demoUsers = [
    { email: 'customer', password: '1234', role: 'customer' },
    { email: 'driver', password: '1234', role: 'driver' },
    { email: 'merchant', password: '1234', role: 'merchant' },
    { email: 'admin', password: '1234', role: 'admin' }
  ];
  for (const u of demoUsers) {
    const exists = await User.findOne({ email: u.email });
    if (!exists) {
      const hashedPassword = await bcrypt.hash(u.password, 10);
      await User.create({ email: u.email, password: hashedPassword, role: u.role });
    }
  }
}
mongoose.connection.once('open', () => {
  seedDemoUsers().catch(err => console.error('Error seeding demo users:', err));
});

// --- NODEMAILER (password reset emails) ---
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// --- PAYNOW (EcoCash payments) ---
const PUBLIC_URL = process.env.PUBLIC_URL || '';
let paynow = null;
if (process.env.PAYNOW_INTEGRATION_ID && process.env.PAYNOW_INTEGRATION_KEY) {
  paynow = new Paynow(process.env.PAYNOW_INTEGRATION_ID, process.env.PAYNOW_INTEGRATION_KEY);
  paynow.resultUrl = `${PUBLIC_URL}/api/payments/paynow-result`;
  paynow.returnUrl = `${PUBLIC_URL}/customer.html`;
  console.log('Paynow configured - EcoCash payments are live');
} else {
  console.warn('PAYNOW_INTEGRATION_ID / PAYNOW_INTEGRATION_KEY not set - EcoCash orders will be recorded but no real payment request will be sent.');
}
app.set('paynow', paynow);

function getRedirectUrlByRole(role) {
  switch (role) {
    case 'driver': return '/driver.html';
    case 'merchant': return '/merchant.html';
    case 'admin': return '/admin.html';
    case 'customer':
    default: return '/customer.html';
  }
}

// ==========================================
// AUTH ROUTES
// ==========================================

app.post('/api/register', async (req, res) => {
  try {
    const { email, password, role, address, paymentMethod } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    // Only customer/driver/merchant can be self-registered - admin stays
    // a seeded/manually-created role since it needs vetting.
    const allowedSelfRegisterRoles = ['customer', 'driver', 'merchant'];
    const chosenRole = allowedSelfRegisterRoles.includes(role) ? role : 'customer';

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email is already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      email,
      password: hashedPassword,
      role: chosenRole,
      address: address || '',
      paymentMethod: paymentMethod || 'Cash'
    });

    const token = jwt.sign({ id: newUser._id, email: newUser.email, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      token,
      redirectUrl: getRedirectUrlByRole(newUser.role)
    });
  } catch (err) {
    console.error('Registration Error:', err);
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      token,
      redirectUrl: getRedirectUrlByRole(user.role)
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

app.get('/api/check-session', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ loggedIn: false });

    res.json({
      loggedIn: true,
      user: { id: user._id, email: user.email, role: user.role },
      redirectUrl: getRedirectUrlByRole(user.role)
    });
  } catch (err) {
    res.status(401).json({ loggedIn: false, message: 'Session expired or invalid.' });
  }
});

// Manually re-seed/reset the demo accounts if their passwords ever get
// out of sync (e.g. after a schema change) - upserts, safe to call anytime.
app.post('/api/seed-demo-users', async (req, res) => {
  try {
    const demoUsers = [
      { email: 'customer', password: '1234', role: 'customer' },
      { email: 'driver', password: '1234', role: 'driver' },
      { email: 'merchant', password: '1234', role: 'merchant' },
      { email: 'admin', password: '1234', role: 'admin' }
    ];
    for (const u of demoUsers) {
      const hashedPassword = await bcrypt.hash(u.password, 10);
      await User.findOneAndUpdate(
        { email: u.email },
        { email: u.email, password: hashedPassword, role: u.role },
        { upsert: true, new: true }
      );
    }
    res.json({ success: true, message: 'Demo logins restored successfully! Login with password "1234".' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/request-password-reset', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'No account with that email was found.' });
    }

    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const hashedCode = await bcrypt.hash(resetCode, 10);
    user.resetCode = hashedCode;
    user.resetCodeExpires = Date.now() + 15 * 60 * 1000;
    await user.save();

    await transporter.sendMail({
      from: `"Johannes Deliveries" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Password Reset Verification Code - Johannes Deliveries',
      text: `Your password reset code is: ${resetCode}\n\nThis code will expire in 15 minutes.`
    });

    res.json({ success: true, message: 'Verification code sent to email.' });
  } catch (err) {
    console.error('Password Reset Request Error:', err);
    res.status(500).json({ success: false, message: 'Failed to send reset code. Check server mail settings (EMAIL_USER/EMAIL_PASS env vars).' });
  }
});

app.post('/api/reset-password', async (req, res) => {
  try {
    const { email, resetCode, newPassword } = req.body;

    if (!email || !resetCode || !newPassword) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    const user = await User.findOne({ email, resetCodeExpires: { $gt: Date.now() } });
    if (!user || !user.resetCode) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code.' });
    }

    const isCodeMatch = await bcrypt.compare(resetCode, user.resetCode);
    if (!isCodeMatch) {
      return res.status(400).json({ success: false, message: 'Invalid verification code.' });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetCode = null;
    user.resetCodeExpires = null;
    await user.save();

    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    res.json({
      success: true,
      message: 'Password updated successfully.',
      token,
      redirectUrl: getRedirectUrlByRole(user.role)
    });
  } catch (err) {
    console.error('Reset Password Error:', err);
    res.status(500).json({ success: false, message: 'Failed to update password.' });
  }
});

// ==========================================
// FEATURE ROUTES
// ==========================================
app.use('/api/catalog', catalogRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/merchant', merchantRoutes);

// Paynow calls this directly when a payment's status changes - no auth,
// since it's Paynow's server calling it, not a logged-in browser.
app.post('/api/payments/paynow-result', async (req, res) => {
  try {
    const Order = require('./models/Order');
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
    res.sendStatus(200);
  }
});

// ==========================================
// SOCKET.IO - LIVE DRIVER FLEET TRACKING
// Last known driver positions persist in MongoDB (upserted per driver),
// so the admin map still shows recent positions right after a restart,
// before any driver reconnects.
// ==========================================
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

// START SERVER
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\ud83d\ude80 Johannes Deliveries server running on port ${PORT}`);
});
