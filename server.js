const fs = require('fs');
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const session = require('express-session');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

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
  cookie: { secure: false } // Set to true if running over HTTPS
}));

// --- REAL-TIME DATA STORE ---
let activeDrivers = [];

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
})
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
