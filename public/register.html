const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'johannes_deliveries_secret_key_2026';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/johannes-deliveries';

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
  status: { type: String, default: 'pending' }, // pending, assigned, picked_up, delivered
  assignedDriver: { type: String, default: null },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Order = mongoose.model('Order', OrderSchema);

// Catalog Routes
const catalogRoutes = require('./routes/catalog');
app.use('/api/catalog', catalogRoutes);

// Auth Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Access denied.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid token.' });
    req.user = user;
    next();
  });
}

// REST API Endpoints

// 1. Session Check
app.get('/api/check-session', authenticateToken, (req, res) => {
  res.json({ loggedIn: true, user: req.user });
});

// 2. User Registration
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, role, address, paymentMethod } = req.body;
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Username or email already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      email,
      password: hashedPassword,
      role: role || 'customer',
      address: address || '',
      paymentMethod: paymentMethod || 'Cash'
    });

    await user.save();
    res.json({ success: true, message: 'Account registered successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 3. User Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ success: false, message: 'User not found.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
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

    res.json({
      success: true,
      token,
      redirectUrl: redirectMap[user.role] || '/customer.html'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server login error.' });
  }
});

// 4. Seed Demo Users Endpoint
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

    res.json({ success: true, message: 'Demo logins restored successfully! You can now log in with customer, driver, merchant, admin using password "1234".' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. Orders API
app.get('/api/orders', authenticateToken, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post('/api/orders', authenticateToken, async (req, res) => {
  try {
    const newOrder = new Order(req.body);
    await newOrder.save();
    
    // Broadcast updated orders list
    const orders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', orders);

    res.json({ success: true, order: newOrder });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.patch('/api/orders/:id/assign', authenticateToken, async (req, res) => {
  try {
    const { driverEmail } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { assignedDriver: driverEmail, status: 'assigned' },
      { new: true }
    );
    
    const orders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', orders);

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.patch('/api/orders/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    const orders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', orders);

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get('/api/orders/:id/payment-status', authenticateToken, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    res.json({ paymentStatus: order ? order.paymentStatus : 'pending' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Live Driver Fleet Socket Tracking
let activeDrivers = {};

io.on('connection', (socket) => {
  socket.on('driver_connect', (data) => {
    activeDrivers[socket.id] = {
      driverId: data.driverId,
      lat: data.lat,
      lng: data.lng
    };
    io.emit('update_fleet', Object.values(activeDrivers));
  });

  socket.on('disconnect', () => {
    delete activeDrivers[socket.id];
    io.emit('update_fleet', Object.values(activeDrivers));
  });
});

// Database Connection & Server Initialization
mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected successfully');
    
    // Auto-seed demo accounts on initial launch if empty
    const count = await User.countDocuments();
    if (count === 0) {
      console.log('Seeding initial demo accounts...');
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
