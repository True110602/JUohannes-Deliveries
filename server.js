// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');
const { Resend } = require('resend'); // Switched from SendGrid to Resend
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
// 1. ENVIRONMENT VALIDATION (Fail Fast)
// ==========================================
function validateEnv() {
  const required = ['MONGODB_URI', 'JWT_SECRET']; 
  const optional = ['RESEND_API_KEY', 'PAYNOW_INTEGRATION_ID', 'PAYNOW_INTEGRATION_KEY'];
  
  const missing = required.filter(key => !process.env[key]);
  if (missing.length > 0) {
    console.error('\x1b[31m%s\x1b[0m', `CRITICAL ERROR: Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  
  const missingOpt = optional.filter(key => !process.env[key]);
  if (
