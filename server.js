const fs = require('fs');
const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');
const session = require('express-session');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);

// --- CORS ---
// Required because the Capacitor app runs on its own native origin
// (e.g. capacitor://localhost) which is different from wherever this
// server is hosted. Without this, the browser/webview blocks every
// request the app makes to the API and Socket.IO connections fail.
const corsOptions = {
  // NOTE: origin can't be '*' when credentials: true - browsers reject that
  // combination outright. process.env.CLIENT_ORIGIN should be set to your
  // real deployed app origin(s) in production. `true` reflects whatever
  // Origin the request came from, which is fine for development but should
  // be tightened before you ship.
  origin: process.env.CLIENT_ORIGIN || true,
  credentials: true
};
app.use(cors(corsOptions));

// Socket.IO needs its own CORS config - it does NOT inherit Express's cors() middleware
const io = new Server(server, {
  cors: corsOptions
});

// --- MIDDLEWARE SETUP ---
// Enable JSON and URL-encoded body parsing for login requests
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static HTML, CSS, and JS files (including map dashboards)
app.use(express.static(path.join(__dirname, 'public')));

// Session management setup
app.use(session({
  secret: process.env.SESSION_SECRET || 'johannes-deliveries-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    // If the app ever talks to the server over HTTPS from a different
    // origin (which it will, as a native app), the cookie needs
    // sameSite: 'none' + secure: true or the browser/webview will
    // silently refuse to store/send it, and every "am I logged in"
    // check will look like a fresh, logged-out session.
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
  }
}));

// --- DATABASE CONNECTION ---
// mongoose is listed as a dependency but nothing in this file ever
// calls mongoose.connect() - so it's currently doing nothing. Set
// MONGODB_URI in your environment and uncomment when you're ready
// to move off the flat-file users.json store.
const MONGODB_URI = process.env.MONGODB_URI;
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('MongoDB connection error:', err));
} else {
  console.warn('MONGODB_URI not set - skipping database connection (using users.json fallback)');
}

// --- REAL-TIME DATA STORE ---
let activeDrivers = [];

// --- ORDERS DATA STORE ---
// customer.html has an order form with no submit handler, and
// admin.html has an empty "Incoming Customer Orders" table with a
// comment saying the wiring goes here - neither side existed. This
// connects them: customer submits -> server stores + broadcasts ->
// admin's table updates live over the same socket already used for
// driver tracking.
let orders = [];
let nextOrderId = 1;

app.post('/api/orders', (req, res) => {
  const { customerName, pickup, dropoff, item } = req.body;

  if (!customerName || !pickup || !dropoff) {
    return res.status(400).json({ success: false, message: 'customerName, pickup, and dropoff are required' });
  }

  const newOrder = {
    id: nextOrderId++,
    customerName,
    pickup,
    dropoff,
    item: item || '',
    createdAt: new Date().toISOString()
  };
  orders.push(newOrder);

  io.emit('update_orders', orders);

  res.status(201).json({ success: true, order: newOrder });
});

app.get('/api/orders', (req, res) => {
  res.json(orders);
});

// --- CATALOG DATA STORE ---
// merchant.html, customer.html, and admin.html all call /api/catalog
// endpoints, but no such routes existed anywhere in the original
// server.js - this is a minimal in-memory implementation (same
// pattern as activeDrivers above) so those pages actually work.
// Swap this for a real Mongoose model whenever you're ready to
// persist it properly.
let catalogItems = [];
let nextCatalogId = 1;

// GET all catalog items
app.get('/api/catalog', (req, res) => {
  res.json(catalogItems);
});

// POST a new catalog item
app.post('/api/catalog', (req, res) => {
  const { name, price } = req.body;

  if (!name || price === undefined) {
    return res.status(400).json({ success: false, message: 'Name and price are required' });
  }

  const newItem = {
    id: nextCatalogId++,
    name,
    price: parseFloat(price),
    inStock: true
  };
  catalogItems.push(newItem);

  res.status(201).json(newItem);
});

// PATCH: toggle in-stock status for one item
app.patch('/api/catalog/:id/stock', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const item = catalogItems.find(i => i.id === id);

  if (!item) {
    return res.status(404).json({ success: false, message: 'Item not found' });
  }

  item.inStock = !item.inStock;
  res.json(item);
});

// --- API ROUTES ---

// 1. Check if user/driver is logged in
app.get('/api/check-session', (req, res) => {
  if (req.session && req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

// 2. Multi-App / Portal Login Route
app.post('/api/login', (req, res) => {
  const { app: targetApp, email, password } = req.body;

  if (email && password) {
    req.session.user = {
      email: email,
      app: targetApp
    };

    return res.json({
      success: true,
      message: 'Login successful',
      token: 'session-token-active',
      redirectUrl: `/${targetApp.toLowerCase().replace(/\s+/g, '')}`
    });
  }

  return res.status(401).json({
    success: false,
    message: 'Invalid email or password'
  });
});

// 3. Logout (referenced by driver.html's logout button, but was never defined)
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
    const { email, password, address, paymentMethod } = req.body;

    if (!email || !password || !address || !paymentMethod) {
      return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    const filePath = path.join(__dirname, 'users.json');

    let users = [];
    if (fs.existsSync(filePath)) {
      const fileData = fs.readFileSync(filePath, 'utf8');
      try {
        users = JSON.parse(fileData);
      } catch (e) {
        users = [];
      }
    }

    const userExists = users.find(u => u.email === email);
    if (userExists) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    const newUser = { email, password, address, paymentMethod };
    users.push(newUser);

    fs.writeFileSync(filePath, JSON.stringify(users, null, 2));

    return res.status(200).json({ success: true, message: 'Registration successful!' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: 'Server registration error' });
  }
});

// --- SOCKET.IO REAL-TIME MAP & FLEET TRACKING ---
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Handle live driver coordinates and update active fleet
  socket.on('driver_connect', (data) => {
    const existingDriver = activeDrivers.find(d => d.driverId == data.driverId);

    if (existingDriver) {
      existingDriver.lat = data.lat;
      existingDriver.lng = data.lng;
    } else {
      activeDrivers.push(data);
    }

    // Broadcast updated location data to map view clients
    io.emit('update_fleet', activeDrivers);
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
