// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');
const { Resend } = require('resend'); 
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');

// --- MODELS & ROUTES ---
const User = require('./models/user');
const DriverLocation = require('./models/DriverLocation');
const Order = require('./models/Order');
const SupportChat = require('./models/SupportChat');
const SupportCall = require('./models/SupportCall');
const { authenticateToken, JWT_SECRET } = require('./middleware/auth');
const catalogRoutes = require('./routes/catalog');
const orderRoutes = require('./routes/orders');
const merchantRoutes = require('./routes/merchant');
const adminRoutes = require('./routes/admin');
const accountRoutes = require('./routes/account');
const supportRoutes = require('./routes/support');
const supportChatRoutes = require('./routes/support-chat');
const notificationRoutes = require('./routes/notifications');
const spreadsheetRoutes = require('./routes/spreadsheet');
const { customerRouter: customerStatsRoutes, driverRouter: driverStatsRoutes } = require('./routes/stats');
const setupSupportSocket = require('./socket-support-events');
const { notifyUser, notifyRole } = require('./utils/notify');
const { broadcastOrders } = require('./utils/realtime');

// ==========================================
// 1. ENVIRONMENT VALIDATION
// ==========================================
function validateEnv() {
  const required = ['MONGODB_URI', 'JWT_SECRET']; 
  const optional = ['RESEND_API_KEY', 'PAYNOW_INTEGRATION_ID', 'PAYNOW_INTEGRATION_KEY'];
  
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('CRITICAL ERROR: Missing required env vars: ' + missing.join(', '));
    process.exit(1);
  }
  
  const missingOpt = optional.filter(key => !process.env[key]);
  if (missingOpt.length > 0) {
    console.warn('Warning: Optional features disabled due to missing: ' + missingOpt.join(', '));
  }
}
validateEnv();

const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// --- SOCKET.IO ---
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});
app.set('io', io);

// ==========================================
// 2. SECURITY MIDDLEWARE
// ==========================================
app.use(helmet({
  contentSecurityPolicy: false, 
}));
app.use(cors());
app.use(express.json());

// --- RATE LIMITING ---
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { success: false, message: 'Too many login attempts.' }, standardHeaders: true, legacyHeaders: false });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: { success: false, message: 'Too many accounts created.' }, standardHeaders: true, legacyHeaders: false });
const passwordResetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { success: false, message: 'Too many reset attempts.' }, standardHeaders: true, legacyHeaders: false });
const generalApiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, message: { success: false, message: 'Too many requests.' }, standardHeaders: true, legacyHeaders: false });

app.use('/api/', generalApiLimiter);
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', (req, res, next) => {
  if (!/\.(jpe?g|png|webp|gif)$/i.test(req.path)) return res.status(404).end();
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// --- MONGOOSE DATABASE SETUP ---
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => { console.error('MongoDB Error:', err); process.exit(1); });

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
  if (process.env.SEED_DEMO_USERS === 'true' && process.env.NODE_ENV !== 'production') {
    seedDemoUsers().catch(err => console.error('Error seeding demo users:', err));
  }
});

// ==========================================
// 3. RESEND (Email Configuration)
// ==========================================
const resendClient = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const EMAIL_CONFIGURED = !!resendClient;
const EMAIL_FROM = process.env.RESEND_FROM_EMAIL || 'noreply@johannes.com';

if (EMAIL_CONFIGURED) {
  console.log('Resend configured - password reset emails can be sent');
} else {
  console.warn('RESEND_API_KEY not set - password reset emails cannot be sent.');
}

// --- PAYNOW (EcoCash) ---
const PUBLIC_URL = process.env.PUBLIC_URL || '';
let paynow = null;
if (process.env.PAYNOW_INTEGRATION_ID && process.env.PAYNOW_INTEGRATION_KEY) {
  paynow = new Paynow(process.env.PAYNOW_INTEGRATION_ID, process.env.PAYNOW_INTEGRATION_KEY);
  paynow.resultUrl = `${PUBLIC_URL}/api/payments/paynow-result`;
  paynow.returnUrl = `${PUBLIC_URL}/customer.html`;
}
app.set('paynow', paynow);
app.set('emailFrom', EMAIL_FROM);
app.set('emailConfigured', EMAIL_CONFIGURED);

// ==========================================
// 4. ZOD VALIDATION SCHEMAS
// ==========================================
const RegisterSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().trim().toLowerCase().pipe(z.string().email("Invalid email format")).or(z.string().min(1)),
  phone: z.string().trim().min(1, "Phone is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  address: z.string().trim().min(1, "Address is required"),
  role: z.enum(['customer', 'driver', 'merchant']).catch('customer'),
  paymentMethod: z.string().optional().default('Cash'),
  referralCode: z.string().optional().nullable(),
});

const LoginSchema = z.object({
  email: z.string().trim().min(1, "Email is required"),
  password: z.string().min(1, "Password is required"),
});

const ResetRequestSchema = z.object({
  email: z.string().trim().email("Invalid email format"),
});

const ResetPasswordSchema = z.object({
  email: z.string().trim().min(1),
  resetCode: z.string().trim().min(1),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

// --- HELPERS ---
async function generateUniqueReferralCode(seed) {
  const base = (seed || 'USER').replace(/[^a-zA-Z]/g, '').slice(0, 5).toUpperCase() || 'USER';
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
    const exists = await User.findOne({ referralCode: candidate });
    if (!exists) return candidate;
  }
  return `${base}${Date.now().toString().slice(-6)}`;
}

function getRedirectUrlByRole(role) {
  switch (role) {
    case 'driver': return '/driver.html';
    case 'merchant': return '/merchant.html';
    case 'admin': return '/admin.html';
    default: return '/customer.html';
  }
}

// --- API ROUTES ---

app.get('/api/map-config', (req, res) => {
  const maptilerKey = process.env.MAPTILER_API_KEY;
  if (maptilerKey) {
    return res.json({
      tileUrlTemplate: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${maptilerKey}`,
      attribution: '&copy; <a href="https://www.maptiler.com/">MapTiler</a> &copy; OpenStreetMap contributors',
      maxZoom: 20
    });
  }
  res.json({
    tileUrlTemplate: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxZoom: 19
  });
});

app.post('/api/register', registerLimiter, async (req, res) => {
  try {
    const validated = RegisterSchema.parse(req.body);
    const existingUser = await User.findOne({ email: validated.email });
    if (existingUser) return res.status(400).json({ success: false, message: 'Email is already registered.' });

    let referredByEmail = null;
    if (validated.referralCode) {
      const referrer = await User.findOne({ referralCode: validated.referralCode.trim().toUpperCase() });
      if (referrer && referrer.email !== validated.email) referredByEmail = referrer.email;
    }

    const hashedPassword = await bcrypt.hash(validated.password, 10);
    const newUser = await User.create({
      ...validated,
      password: hashedPassword,
      approved: validated.role !== 'merchant',
      referralCode: await generateUniqueReferralCode(validated.name),
      referredBy: referredByEmail
    });

    if (validated.role === 'merchant') {
      notifyRole(io, User, 'admin', {
        title: 'New merchant awaiting approval',
        message: `${newUser.name} (${newUser.email}) registered as a merchant.`
      });
    }

    const token = jwt.sign({ id: newUser._id, email: newUser.email, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ success: true, token, redirectUrl: getRedirectUrlByRole(newUser.role) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ success: false, message: err.errors[0].message });
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

app.post('/api/login', loginLimiter, async (req, res) => {
  try {
    const validated = LoginSchema.parse(req.body);
    const user = await User.findOne({ email: validated.email });
    if (!user || !(await bcrypt.compare(validated.password, user.password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, redirectUrl: getRedirectUrlByRole(user.role) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ success: false, message: err.errors[0].message });
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

app.post('/api/request-password-reset', passwordResetLimiter, async (req, res) => {
  try {
    const validated = ResetRequestSchema.parse(req.body);
    if (!EMAIL_CONFIGURED) return res.status(503).json({ success: false, message: 'Email not configured.' });

    const user = await User.findOne({ email: validated.email });
    if (user) {
      const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
      user.resetCode = await bcrypt.hash(resetCode, 10);
      user.resetCodeExpires = Date.now() + 15 * 60 * 1000;
      await user.save();

      await resendClient.emails.send({
        from: EMAIL_FROM,
        to: validated.email,
        subject: 'Password Reset Verification Code - Johannes Deliveries',
        html: `
          <h2 style="font-family: sans-serif;">Password Reset Request</h2>
          <p style="font-family: sans-serif;">Your password reset code is:</p>
          <h3 style="font-size: 24px; font-family: monospace; color: #667eea;">${resetCode}</h3>
          <p style="font-family: sans-serif;"><strong>This code will expire in 15 minutes.</strong></p>
          <p style="font-family: sans-serif;">If you did not request a password reset, you can ignore this email.</p>
        `
      });
    }
    res.json({ success: true, message: 'If registered, a code has been sent.' });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ success: false, message: err.errors[0].message });
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

app.post('/api/reset-password', passwordResetLimiter, async (req, res) => {
  try {
    const validated = ResetPasswordSchema.parse(req.body);
    const user = await User.findOne({ email: validated.email, resetCodeExpires: { $gt: Date.now() } });
    if (!user || !user.resetCode || !(await bcrypt.compare(validated.resetCode, user.resetCode))) {
      return res.status(400).json({ success: false, message: 'Invalid or expired code.' });
    }
    user.password = await bcrypt.hash(validated.newPassword, 10);
    user.resetCode = null;
    user.resetCodeExpires = null;
    await user.save();
    const token = jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, redirectUrl: getRedirectUrlByRole(user.role) });
  } catch (err) {
    if (err instanceof z.ZodError) return res.status(400).json({ success: false, message: err.errors[0].message });
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

app.get('/api/check-session', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(401).json({ loggedIn: false });
    res.json({ loggedIn: true, user: { id: user._id, email: user.email, role: user.role }, redirectUrl: getRedirectUrlByRole(user.role) });
  } catch (err) { res.status(401).json({ loggedIn: false }); }
});

app.use('/api/catalog', catalogRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/merchant', merchantRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/support-chat', supportChatRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/spreadsheet', spreadsheetRoutes);
app.use('/api/customer', customerStatsRoutes);
app.use('/api/driver', driverStatsRoutes);

app.post('/api/payments/paynow-result', async (req, res) => {
  try {
    const { reference } = req.body || {};
    const match = /^Order-([a-f0-9]{24})$/.exec(typeof reference === 'string' ? reference : '');
    if (match && paynow) {
      const order = await Order.findById(match[1]);
      if (order && order.paynowPollUrl) {
        const polled = await paynow.pollTransaction(order.paynowPollUrl);
        const newStatus = polled.paid() ? 'paid' : String(polled.status || '').toLowerCase();
        if (newStatus && newStatus !== order.paymentStatus) {
          order.paymentStatus = newStatus;
          await order.save();
          await broadcastOrders(io, order);
        }
      }
    }
  } catch (err) { console.error('Paynow error:', err.message); }
  res.sendStatus(200);
});

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication required'));
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err || !decoded) return next(new Error('Invalid token'));
    socket.user = decoded;
    next();
  });
});

setupSupportSocket(io);

io.on('connection', async (socket) => {
  const { email, role } = socket.user;
  socket.join(email);
  if (role === 'admin') socket.join('admins');

  if (role === 'admin') {
    try {
      const savedLocations = await DriverLocation.find();
      socket.emit('update_fleet', savedLocations.map(d => ({ driverId: d.driverId, lat: d.lat, lng: d.lng })));
    } catch (err) { console.error(err); }
  }

  socket.on('driver_connect', async (data) => {
    if (role !== 'driver') return;
    try {
      const lat = Number(data?.lat);
      const lng = Number(data?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      await DriverLocation.findOneAndUpdate({ driverId: email }, { lat, lng }, { upsert: true });
      const allDrivers = await DriverLocation.find();
      io.to('admins').emit('update_fleet', allDrivers.map(d => ({ driverId: d.driverId, lat: d.lat, lng: d.lng })));

      const activeOrders = await Order.find({ assignedDriver: email, status: { $in: ['assigned', 'picked_up'] } }).select('customerEmail');
      activeOrders.forEach(order => {
        if (order.customerEmail) io.to(order.customerEmail).emit('driver_position', { orderId: order._id, lat, lng });
      });
    } catch (err) { console.error(err); }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on port ' + PORT));
