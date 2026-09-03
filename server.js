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

// Database Connection String Check
const MONGO_URI = process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error('------------------------------------------------------------');
  console.error('CRITICAL ERROR: No MongoDB connection string found!');
  console.error('Please check Environment Variables on Render.');
  console.error('------------------------------------------------------------');
  process.exit(1);
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
  if (!token) return res.status(401).json({ success: false, message: 'Access denied.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, message: 'Invalid token.' });
    req.user = user;
    next();
  });
}

// Combines token auth with a role check - use as middleware, e.g.
// app.post('/api/catalog', ...requireRole('merchant'), handler)
function requireRole(...roles) {
  return [authenticateToken, (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Forbidden: your account does not have access to this.' });
    }
    next();
  }];
}

// REST API Endpoints

// 1. Session Check
app.get('/api/check-session', authenticateToken, (req, res) => {
  res.json({ loggedIn: true, user: req.user });
});

// 2. Registration
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

// 3. Login
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

// 4. Seed Demo Users
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

// Merchant's own profile - profile picture and bank/payout details,
// persisted server-side (previously this only lived in localStorage,
// which meant it didn't follow the account across devices/browsers).
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

// Merchant's own sales stats - approximate: matches orders whose "item"
// text mentions one of this merchant's catalog item names, since orders
// currently store items as a single combined text field rather than
// structured line items linking back to a specific catalog item/merchant.
// This is a reasonable estimate but not exact - ask if you want orders
// restructured with proper line items for precise multi-merchant stats.
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
app.get('/api/catalog', async (req, res) => {
  try {
    const items = await CatalogItem.find().sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Merchant's own items only - used by the merchant dashboard, since the
// public /api/catalog above intentionally returns every merchant's items
// (customers need to see everything for sale).
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

// 6. Orders Routes
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

    const orders = await Order.find().sort({ createdAt: -1 });
    io.emit('update_orders', orders);

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// 7. Live Driver Fleet Tracking via WebSockets
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
