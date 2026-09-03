// server.js
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); // Using jsonwebtoken for standard JWT ops
const nodemailer = require('nodemailer');
const path = require('path');

const app = express();

// --- MIDDLEWARE ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // Serves your static HTML files

// --- MONGOOSE DATABASE SETUP ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/johannes_deliveries';
mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// --- USER SCHEMA & MODEL ---
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['customer', 'driver', 'merchant'], default: 'customer' },
  resetCode: { type: String, default: null },
  resetCodeExpires: { type: Date, default: null }
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

// --- NODEMAILER TRANSPORTER ---
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE || 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Helper function to resolve redirect path based on role
function getRedirectUrlByRole(role) {
  switch (role) {
    case 'driver':
      return '/driver.html';
    case 'merchant':
      return '/merchant.html';
    case 'customer':
    default:
      return '/customer.html';
  }
}

// ==========================================
// API ROUTES
// ==========================================

// 1. REGISTER NEW USER
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email is already registered.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({
      email,
      password: hashedPassword,
      role: role || 'customer'
    });

    // Issue JWT Token immediately upon registration
    const secret = process.env.JWT_SECRET || 'fallback_secret_key';
    const token = jwt.sign({ id: newUser._id, role: newUser.role }, secret, { expiresIn: '7d' });

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

// 2. LOGIN USER
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

    const secret = process.env.JWT_SECRET || 'fallback_secret_key';
    const token = jwt.sign({ id: user._id, role: user.role }, secret, { expiresIn: '7d' });

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

// 3. CHECK SESSION (Automated head script check)
app.get('/api/check-session', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ loggedIn: false });
    }

    const token = authHeader.split(' ')[1];
    const secret = process.env.JWT_SECRET || 'fallback_secret_key';

    const decoded = jwt.verify(token, secret);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({ loggedIn: false });
    }

    res.json({
      loggedIn: true,
      user: { id: user._id, email: user.email, role: user.role },
      redirectUrl: getRedirectUrlByRole(user.role)
    });
  } catch (err) {
    res.status(401).json({ loggedIn: false, message: 'Session expired or invalid.' });
  }
});

// 4. REQUEST PASSWORD RESET (Generate & Email Code)
app.post('/api/request-password-reset', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      // Return 200/404 based on design preference. 
      return res.status(404).json({ success: false, message: 'No account with that email was found.' });
    }

    // Generate random 6-digit verification code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Hash the code before saving to MongoDB
    const hashedCode = await bcrypt.hash(resetCode, 10);
    user.resetCode = hashedCode;
    user.resetCodeExpires = Date.now() + 15 * 60 * 1000; // Expires in 15 minutes
    await user.save();

    // Dispatch email
    await transporter.sendMail({
      from: `"Johannes Deliveries" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Password Reset Verification Code - Johannes Deliveries',
      text: `Your password reset code is: ${resetCode}\n\nThis code will expire in 15 minutes.`
    });

    res.json({ success: true, message: 'Verification code sent to email.' });
  } catch (err) {
    console.error('Password Reset Request Error:', err);
    res.status(500).json({ success: false, message: 'Failed to send reset code. Check server mail settings.' });
  }
});

// 5. SUBMIT RESET CODE & UPDATE PASSWORD
app.post('/api/reset-password', async (req, res) => {
  try {
    const { email, resetCode, newPassword } = req.body;

    if (!email || !resetCode || !newPassword) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    // Find user with active, non-expired reset request
    const user = await User.findOne({
      email,
      resetCodeExpires: { $gt: Date.now() }
    });

    if (!user || !user.resetCode) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code.' });
    }

    // Compare code
    const isCodeMatch = await bcrypt.compare(resetCode, user.resetCode);
    if (!isCodeMatch) {
      return res.status(400).json({ success: false, message: 'Invalid verification code.' });
    }

    // Save new password and clear fields
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetCode = null;
    user.resetCodeExpires = null;
    await user.save();

    // Return active JWT token to grant instant access
    const secret = process.env.JWT_SECRET || 'fallback_secret_key';
    const token = jwt.sign({ id: user._id, role: user.role }, secret, { expiresIn: '7d' });

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

// START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Johannes Deliveries server running on port ${PORT}`);
});
