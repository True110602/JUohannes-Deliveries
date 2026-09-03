const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// --- MONGODB CONNECTION ---
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/johannes_deliveries';

mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB connected successfully'))
.catch(err => console.error('❌ MongoDB connection error:', err));

// --- IN-MEMORY FALLBACK RESET CODES (Ensures reset works even without DB updates) ---
const passwordResetCodes = new Map();

// --- USER SCHEMA & MODEL ---
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['customer', 'driver', 'merchant', 'admin'], default: 'customer' },
  resetCode: { type: String },
  resetCodeExpiry: { type: Date }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);

// --- API ENDPOINTS ---

// 1. REGISTER
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists.' });
    }

    const newUser = new User({
      email,
      password, // Note: Consider hashing with bcrypt in production
      role: role || 'customer'
    });

    await newUser.save();
    console.log(`[USER REGISTERED] Email: ${email} | Role: ${newUser.role}`);

    res.json({ success: true, message: 'Account registered successfully.' });
  } catch (err) {
    console.error('Error in /api/register:', err);
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
});

// 2. LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email });

    if (!user || user.password !== password) {
      return res.status(400).json({ success: false, message: 'Invalid email or password.' });
    }

    let redirectUrl = '/customer.html';
    if (user.role === 'driver') redirectUrl = '/driver.html';
    if (user.role === 'merchant') redirectUrl = '/merchant.html';
    if (user.role === 'admin') redirectUrl = '/admin.html';

    console.log(`[LOGIN SUCCESS] Email: ${email} | Redirect: ${redirectUrl}`);

    res.json({
      success: true,
      token: 'fake-jwt-token-' + Date.now(),
      redirectUrl
    });
  } catch (err) {
    console.error('Error in /api/login:', err);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
});

// 3. REQUEST PASSWORD RESET (Safe Handler)
app.post('/api/request-password-reset', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email address is required.' });
    }

    // Generate 6-digit verification code
    const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = Date.now() + 15 * 60 * 1000; // Valid for 15 minutes

    // Save in Memory
    passwordResetCodes.set(email, { code: resetCode, expiry });

    // Try saving to MongoDB if user exists
    try {
      await User.updateOne({ email }, { resetCode, resetCodeExpiry: new Date(expiry) });
    } catch (dbErr) {
      console.warn('Could not store reset code in DB, using memory storage:', dbErr.message);
    }

    console.log(`==========================================`);
    console.log(`[PASSWORD RESET CODE] Email: ${email} | Code: ${resetCode}`);
    console.log(`==========================================`);

    res.json({
      success: true,
      message: 'Reset code generated successfully.',
      devResetCode: resetCode // Useful for testing directly from console
    });

  } catch (err) {
    console.error('Error in /api/request-password-reset:', err);
    res.status(500).json({ success: false, message: 'Failed to process password reset request.' });
  }
});

// 4. SUBMIT RESET PASSWORD
app.post('/api/reset-password', async (req, res) => {
  try {
    const { email, resetCode, newPassword } = req.body;

    if (!email || !resetCode || !newPassword) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    // Verify against Memory first
    const memoryRecord = passwordResetCodes.get(email);
    let isValid = false;

    if (memoryRecord && memoryRecord.code === resetCode && memoryRecord.expiry > Date.now()) {
      isValid = true;
    } else {
      // Fallback check against Database
      const user = await User.findOne({ email });
      if (user && user.resetCode === resetCode && user.resetCodeExpiry > new Date()) {
        isValid = true;
      }
    }

    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification code.' });
    }

    // Update password in DB
    await User.updateOne({ email }, { password: newPassword, resetCode: null, resetCodeExpiry: null });
    passwordResetCodes.delete(email);

    console.log(`[PASSWORD UPDATED] Email: ${email}`);

    res.json({ success: true, message: 'Password has been successfully updated.' });

  } catch (err) {
    console.error('Error in /api/reset-password:', err);
    res.status(500).json({ success: false, message: 'Failed to reset password.' });
  }
});

// 5. DEMO SEED ENDPOINT
app.post('/api/seed-demo-users', async (req, res) => {
  try {
    const defaultUsers = [
      { email: 'customer', password: '1234', role: 'customer' },
      { email: 'driver', password: '1234', role: 'driver' },
      { email: 'merchant', password: '1234', role: 'merchant' },
      { email: 'admin', password: '1234', role: 'admin' }
    ];

    for (const u of defaultUsers) {
      await User.updateOne({ email: u.email }, u, { upsert: true });
    }

    res.json({ success: true, message: 'Demo accounts reseeded successfully.' });
  } catch (err) {
    console.error('Error seeding demo users:', err);
    res.status(500).json({ success: false, message: 'Error seeding demo users.' });
  }
});

// Fallback to index.html/login.html for SPA routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Johannes Deliveries server running on port ${PORT}`);
});
