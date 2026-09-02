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

// =========================================================================
//  PASTE THE LINE RIGHT HERE:
// =========================================================================
const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URL || process.env.mongodb_url;

if (!MONGO_URI) {
  console.error('------------------------------------------------------------');
  console.error('CRITICAL ERROR: No MongoDB connection string found!');
  console.error('Please check Environment Variables on Render.');
  console.error('------------------------------------------------------------');
  process.exit(1);
}
// =========================================================================

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ... (Rest of your schemas and routes stay here) ...

// Database Connection call near the bottom of the file uses MONGO_URI:
mongoose.connect(MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected successfully');
    // ...
