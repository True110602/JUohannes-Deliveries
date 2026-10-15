// routes/media.js
// Upload (merchant/admin) and serve (public) images stored in MongoDB.
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Media = require('../models/Media');
const { requireRole } = require('../middleware/auth');
const { storeUploadedImage } = require('../utils/imageUpload');

router.post('/', ...requireRole('merchant', 'admin'), async (req, res) => {
  try {
    const url = await storeUploadedImage(req, res);
    res.status(201).json({ success: true, url });
  } catch (e) {
    res.status(e.status || 500).json({ success: false, message: e.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).end();
    const media = await Media.findById(req.params.id).select('data mimeType');
    if (!media) return res.status(404).end();
    const body = Buffer.isBuffer(media.data) ? media.data : Buffer.from(media.data.buffer || media.data);
    res.set({
      'Content-Type': media.mimeType,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // The Android app loads these from a different origin than the server.
      'Cross-Origin-Resource-Policy': 'cross-origin'
    });
    res.end(body);
  } catch (err) {
    res.status(500).end();
  }
});

module.exports = router;
