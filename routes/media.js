// routes/media.js
// Upload (merchant/admin) and serve (public) images stored in MongoDB.
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const Media = require('../models/Media');
const { requireRole } = require('../middleware/auth');
const { detectImageType } = require('../utils/imageType');

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB
const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } });

router.post('/', ...requireRole('merchant', 'admin'), (req, res) => {
  memoryUpload.single('image')(req, res, async (err) => {
    if (err) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'That image is too large (maximum 3 MB).' : (err.message || 'Upload failed.');
      return res.status(400).json({ success: false, message });
    }
    if (!req.file) return res.status(400).json({ success: false, message: 'No image file was received.' });

    const mimeType = detectImageType(req.file.buffer);
    if (!mimeType) {
      return res.status(400).json({ success: false, message: 'Only JPG, PNG, WEBP or GIF images are allowed.' });
    }
    try {
      const media = await Media.create({ data: req.file.buffer, mimeType, size: req.file.size, uploadedBy: req.user.email });
      res.status(201).json({ success: true, url: `/api/media/${media._id}` });
    } catch (e) {
      console.error('Media upload error:', e);
      res.status(500).json({ success: false, message: 'Could not save the image. Please try again.' });
    }
  });
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
