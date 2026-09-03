const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'johannes_deliveries_secret_key_2026';

// Environment variable cleaning helper
const cleanEnv = (val) => (val ? String(val).replace(/['"]/g, '').trim() : '');

const EMAIL_USER = cleanEnv(process.env.EMAIL_USER);
const EMAIL_PASS = cleanEnv(process.env.EMAIL_PASS);

// Database Connection String Check
const MONGO_URI = cleanEnv(process.env.MONGODB_URL || process.env.MONGODB_URI || process.env.MONGO_URI);

if (!MONGO_URI) {
  console.error('------------------------------------------------------------');
  console.error('CRITICAL ERROR: No MongoDB connection string found!');
  console.error('Please check Environment Variables on Render (MONGODB_URL).');
  console.error('------------------------------------------------------------');
  process.exit(1);
}

// Nodemailer Transporter Setup
let transporter = null;
if (EMAIL_USER && EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS
    }
  });

  transporter.verify((error) => {
    if (error) {
      console.warn('⚠️ Nodemailer warning: Invalid EMAIL_USER or EMAIL_PASS credentials.');
      console.warn('Details:', error.message);
    } else {
      console.log(`✅ Nodemailer connected successfully with ${EMAIL_USER}. Ready to send emails.`);
    }
  });
} else {
  console.log('ℹ️ EMAIL_USER / EMAIL_PASS missing. Password reset codes will log to console & API response.');
}

// Helper to escape special regex characters safely
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Helper to perform safe case-insensitive email lookup without ReDoS risk
function findUserByEmail(email) {
  if (!email) return null;
  const cleanInput = String(email).trim();
  const safeInput = escapeRegExp(cleanInput);
  return User.findOne({ 
    email: { $regex: new RegExp(`^${safeInput}$`, 'i') } 
  });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// MongoDB Schemas & Models
const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['customer', 'driver', 'merchant', 'admin'], default: 'customer' },
  address: { type: String, default: '' },
  paymentMethod: { type: String, default: 'Cash' },
  profilePicUrl: { type: String, default: '' },
  bankDetails: {
    bankName: { type: String, default: '' },
    accountName: { type: String, default: '' },
    accountNumber: { type: String, default: '' }
  },
  resetPasswordCode: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

const OrderSchema = new mongoose.Schema({
  customerName: String,
  pickup: String,
  dropoff: String,
  item: String,
  amount: Number,
  paymentMethod: String,
  ecocashNumber: String,
  paymentStatus: { type: String, default: 'pending' },
  status: { type: String, default: 'pending' },
  assignedDriver: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

const OptionGroupSchema = new mongoose.Schema({
  groupName: { type: String, required: true },
  choices: [{ type: String, required: true }]
});

const CatalogItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  description: { type: String, default: '' },
  imageUrl: { type: String, default: '' },
  inStock: { type: Boolean, default: true },
  optionGroups: [OptionGroupSchema],
  merchantEmail: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Order = mongoose.model('Order', OrderSchema);
const CatalogItem = mongoose.model('CatalogItem', CatalogItemSchema);

// Auth Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, loggedIn: false, message: 'Access denied. No token provided.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, loggedIn: false, message: 'Invalid or expired token.' });
    req.user = user;
    next();
  });
}

function requireRole(...roles) {
  return [authenticateToken, (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden: your account does not have access to this.' });
    }
    next();
  }];
}

// REST API Endpoints

// 1. Session Check Route
app.get('/api/check-session', authenticateToken, (req, res) => {
  res.json({ loggedIn: true, user: req.user });
});

// 2. Registration
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, role, address, paymentMethod } = req.body;
    
    if (!email || !password || typeof password !== 'string') {
      return res.status(400).json({ success: false, message: 'Email and a valid password are required.' });
    }

    const cleanInput = String(email).trim();
    const existingUser = await findUserByEmail(cleanInput);

    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Username or email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      email: cleanInput,
      password: hashedPassword,
      role: role || 'customer',
      address: address || '',
      paymentMethod: paymentMethod || 'Cash'
    });

    await user.save();
    res.json({ success: true, message: 'Account registered successfully.' });
  } catch (err) {
    console.error('Registration Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. Login
app.post('/api/login', async (req, res) => {
  try {
    const emailInput = req.body.email || req.body.username;
    const passwordInput = req.body.password;

    if (!emailInput || !passwordInput || typeof passwordInput !== 'string') {
      return res.status(400).json({ 
        success: false, 
        message: 'Please provide both email/username and password.' 
      });
    }

    const user = await findUserByEmail(emailInput);

    if (!user) {
      return res.status(400).json({ success: false, message: 'User not found.' });
    }

    if (!user.password || typeof user.password !== 'string') {
      console.error(`Login error: Account '${emailInput}' exists but lacks a password hash.`);
      return res.status(500).json({ 
        success: false, 
        message: 'Account configuration error. Please reset your password or re-register.' 
      });
    }

    const isMatch = await bcrypt.compare(String(passwordInput), String(user.password));
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid password.' });
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    const redirectMap = {
      customer: '/customer.html',
      driver: '/driver.html',
      merchant: '/merchant.html',
      admin: '/admin.html'
    };

    return res.json({
      success: true,
      token,
      redirectUrl: redirectMap[user.role] || '/customer.html'
    });

  } catch (err) {
    console.error('Detailed Login Error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Server login error: ' + (err.message || 'Unknown error') 
    });
  }
});

// 4. Request Password Reset Code
app.post('/api/request-password-reset', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Please provide your email/username.' });
    }

    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    // Generate 6-digit verification code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Code expires in 15 minutes
    user.resetPasswordCode = resetCode;
    user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    console.log(`[PASSWORD RESET CODE] User: ${user.email} | Code: ${resetCode}`);

    // Dispatch Email via Nodemailer if available
    if (transporter) {
      const mailOptions = {
        from: `"Johannes Deliveries" <${EMAIL_USER}>`,
        to: user.email,
        subject: 'Password Reset Verification Code - Johannes Deliveries',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 500px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h2 style="color: #333;">Password Reset Request</h2>
            <p>You requested to reset your password for <strong>Johannes Deliveries</strong>.</p>
            <p>Your 6-digit verification code is:</p>
            <div style="background-color: #f4f4f4; padding: 12px; font-size: 28px; font-weight: bold; letter-spacing: 6px; text-align: center; border-radius: 4px; margin: 20px 0; color: #1a73e8;">
              ${resetCode}
            </div>
            <p style="color: #666; font-size: 13px;">This code will expire in 15 minutes. If you did not request this reset, you can safely ignore this email.</p>
          </div>
        `
      };

      try {
        await transporter.sendMail(mailOptions);
        return res.json({ 
          success: true, 
          message: 'Verification code has been sent to your email.' 
        });
      } catch (mailErr) {
        console.error('Nodemailer Error:', mailErr);
        return res.json({ 
          success: true, 
          message: 'Code generated, but email delivery failed. Check server log.',
          devResetCode: resetCode 
        });
      }
    }

    // Fallback response if EMAIL_USER / EMAIL_PASS are not configured
    res.json({ 
      success: true, 
      message: 'Reset code generated successfully.',
      devResetCode: resetCode 
    });

  } catch (err) {
    console.error('Reset Code Request Error:', err);
    res.status(500).json({ success: false, message: 'Server error generating reset code.' });
  }
});

// 5. Submit Reset Code & New Password
app.post('/api/reset-password', async (req, res) => {
  try {
    const { email, resetCode, newPassword } = req.body;

    if (!email || !resetCode || !newPassword) {
      return res.status(400).json({ 
        success: false, 
        message: 'Email, reset code, and new password are all required.' 
      });
    }

    const user = await findUserByEmail(email);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Account not found.' });
    }

    if (!user.resetPasswordCode || user.resetPasswordCode !== String(resetCode).trim()) {
      return res.status(400).json({ success: false, message: 'Invalid reset code.' });
    }

    if (!user.resetPasswordExpires || new Date() > user.resetPasswordExpires) {
      return res.status(400).json({ success: false, message: 'Reset code has expired. Please request a new one.' });
    }

    // Hash new password and clear tokens
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordCode = null;
    user.resetPasswordExpires = null;
    await user.save();

    res.json({ success: true, message: 'Password reset successfully! You can now log in.' });

  } catch (err) {
    console.error('Password Reset Error:', err);
    res.status(500).json({ success: false, message: 'Server error resetting password.' });
  }
});

// 6. Seed Demo Users & Cleanup
app.post('/api/seed-demo-users', async (req, res) => {
  try {
    await User.deleteMany({ $or: [{ password: { $exists: false } }, { password: null }, { password: "" }] });

    const demoUsers = [
      { email: 'customer', password: '1234', role: 'customer' },
      { email: 'driver', password: '1234', role: 'driver' },
      { email: 'merchant', password: '1234', role: 'merchant' },
      { email: 'admin', password: '1234', role: 'admin' }
    ];

    for (const u of demoUsers) {
      const hashedPassword = await bcrypt.hash(u.password, 10);
      const safeInput = escapeRegExp(u.email);
      await User.findOneAndUpdate(
        { email: { $regex: new RegExp(`^${safeInput}$`, 'i') } },
        { email: u.email, password: hashedPassword, role: u.role },
        { upsert: true, new: true }
      );
    }

    res.json({ success: true, message: 'Corrupted users removed & demo logins restored! Login with password "1234".' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Merchant Profile & Stats Routes
app.get('/api/merchant/profile', ...requireRole('merchant'), async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('email profilePicUrl bankDetails');
    if (!user) return res.status(404).json({ success: false, message: 'Account not found' });
    res.json({ success: true, profile: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.patch('/api/merchant/profile', ...requireRole('merchant'), async (req, res) => {
  try {
    const { profilePicUrl, bankName, accountName, accountNumber } = req.body;
    const update = {};
    if (profilePicUrl !== undefined) update.profilePicUrl = profilePicUrl;
    if (bankName !== undefined || accountName !== undefined || accountNumber !== undefined) {
      update.bankDetails = { bankName, accountName, accountNumber };
    }

    const user = await User.findByIdAndUpdate(req.user.id, update, { new: true }).select('email profilePicUrl bankDetails');
    res.json({ success: true, profile: user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/merchant/stats', ...requireRole('merchant'), async (req, res) => {
  try {
    const myItems = await CatalogItem.find({ merchantEmail: req.user.email }).select('name');
    const myItemNames = myItems.map(i => i.name);

    const allOrders = await Order.find({ status: 'delivered' });
    const myOrders = allOrders.filter(o =>
      myItemNames.some(name => (o.item || '').includes(name))
    );

    const totalRevenue = myOrders.reduce((sum, o) => sum + (o.amount || 0), 0);

    res.json({
      success: true,
      salesCount: myOrders.length,
      totalRevenue
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Catalog Routes
app.get('/api/catalog', async (req, res) => {
  try {
    const items = await CatalogItem.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/merchant/catalog', ...requireRole('merchant'), async (req, res) => {
  try {
    const items = await CatalogItem.find({ merchantEmail: req.user.email }).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/catalog', ...requireRole('merchant'), async (req, res) => {
  try {
    const { name, price, description, imageUrl, optionGroups } = req.body;
    const newItem = new CatalogItem({
      name,
      price,
      description,
      imageUrl,
      optionGroups: optionGroups || [],
      merchantEmail: req.user.email
    });

    await newItem.save();
    res.status(201).json(newItem);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.patch('/api/catalog/:id/stock', ...requireRole('merchant'), async (req, res) => {
  try {
    const item = await CatalogItem.findById(req.params.id);
    if (!item) return res.status(404).json({ message: 'Item not found' });
    if (item.merchantEmail !== req.user.email) {
      return res.status(403).json({ message: 'You can only manage your own catalog items.' });
    }

    item.inStock = !item.inStock;
    await item.save();
    res.json(item);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Orders Routes
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const newOrder = new Order(req.body);
    await newOrder.save();
    
    const orders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', orders);

    res.json({ success: true, order: newOrder });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.patch('/api/orders/:id/assign', async (req, res) => {
  try {
    const { driverEmail } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { assignedDriver: driverEmail, status: 'assigned' },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }
    
    const orders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', orders);

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.patch('/api/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const orders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', orders);

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// WebSockets Fleet Tracking
let activeDrivers = {};

io.on('connection', (socket) => {
  socket.on('driver_connect', (data) => {
    if (data && data.driverId) {
      activeDrivers[socket.id] = {
        driverId: data.driverId,
        lat: data.lat,
        lng: data.lng
      };
      io.emit('update_fleet', Object.values(activeDrivers));
    }
  });

  socket.id && socket.on('disconnect', () => {
    delete activeDrivers[socket.id];
    io.emit('update_fleet', Object.values(activeDrivers));
  });
});

// Server Initialization
mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected successfully');
    
    const count = await User.countDocuments();
    if (count === 0) {
      console.log('Seeding demo accounts...');
      const demoUsers = [
        { email: 'customer', password: '1234', role: 'customer' },
        { email: 'driver', password: '1234', role: 'driver' },
        { email: 'merchant', password: '1234', role: 'merchant' },
        { email: 'admin', password: '1234', role: 'admin' }
      ];
      for (const u of demoUsers) {
        const hashedPassword = await bcrypt.hash(u.password, 10);
        await User.create({ email: u.email, password: hashedPassword, role: u.role });
      }
    }

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
  });
