// routes/adverts.js
// Picture adverts for the home page slideshow.
//  - GET /          public: adverts from approved shops + the platform's own
//  - GET /mine      merchant: their adverts / admin: every advert
//  - POST /         merchant or admin: { title, imageUrl } (image uploaded via POST /api/media first)
//  - DELETE /:id    the advert's owner, or an admin
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Advert = require('../models/Advert');
const Media = require('../models/Media');
const User = require('../models/user');
const { requireRole } = require('../middleware/auth');

const MAX_ADVERTS_PER_MERCHANT = 5;
const MEDIA_URL = /^\/api\/media\/([a-f0-9]{24})$/i;

router.get('/', async (req, res) => {
  try {
    const adverts = await Advert.find().sort({ createdAt: -1 }).limit(60);
    const emails = [...new Set(adverts.map(a => a.merchantEmail).filter(Boolean))];
    const merchants = emails.length
      ? await User.find({ email: { $in: emails }, approved: true }).select('email shopName shopCategory')
      : [];
    const byEmail = new Map(merchants.map(m => [m.email, m]));

    const visible = adverts
      .filter(a => !a.merchantEmail || byEmail.has(a.merchantEmail)) // platform ads, or approved shops only
      .slice(0, 20)
      .map(a => {
        const m = a.merchantEmail ? byEmail.get(a.merchantEmail) : null;
        return {
          _id: a._id,
          title: a.title,
          imageUrl: a.imageUrl,
          merchantEmail: a.merchantEmail || null,
          shopName: m ? (m.shopName || m.email) : '',
          shopCategory: m ? (m.shopCategory || '') : ''
        };
      });
    res.json(visible);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/mine', ...requireRole('merchant', 'admin'), async (req, res) => {
  try {
    const filter = req.user.role === 'admin' ? {} : { merchantEmail: req.user.email };
    const adverts = await Advert.find(filter).sort({ createdAt: -1 }).limit(100);
    const emails = [...new Set(adverts.map(a => a.merchantEmail).filter(Boolean))];
    const merchants = emails.length ? await User.find({ email: { $in: emails } }).select('email shopName') : [];
    const nameByEmail = new Map(merchants.map(m => [m.email, m.shopName || m.email]));
    res.json({
      success: true,
      max: req.user.role === 'admin' ? null : MAX_ADVERTS_PER_MERCHANT,
      adverts: adverts.map(a => ({
        _id: a._id, title: a.title, imageUrl: a.imageUrl, createdAt: a.createdAt,
        shopName: a.merchantEmail ? (nameByEmail.get(a.merchantEmail) || a.merchantEmail) : 'Platform advert'
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', ...requireRole('merchant', 'admin'), async (req, res) => {
  try {
    const title = typeof req.body.title === 'string' ? req.body.title.trim().slice(0, 80) : '';
    const imageUrl = req.body.imageUrl;
    const match = typeof imageUrl === 'string' ? imageUrl.match(MEDIA_URL) : null;
    if (!match) return res.status(400).json({ success: false, message: 'Please upload an image for the advert.' });

    const media = await Media.findById(match[1]).select('uploadedBy');
    if (!media) return res.status(400).json({ success: false, message: 'That image could not be found. Please upload it again.' });
    if (req.user.role !== 'admin' && media.uploadedBy !== req.user.email) {
      return res.status(403).json({ success: false, message: 'You can only use images you uploaded yourself.' });
    }

    const isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      const count = await Advert.countDocuments({ merchantEmail: req.user.email });
      if (count >= MAX_ADVERTS_PER_MERCHANT) {
        return res.status(400).json({ success: false, message: `You can have up to ${MAX_ADVERTS_PER_MERCHANT} adverts at a time. Delete one to add another.` });
      }
    }

    const advert = await Advert.create({ merchantEmail: isAdmin ? null : req.user.email, title, imageUrl });
    res.status(201).json({ success: true, advert });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/:id', ...requireRole('merchant', 'admin'), async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid advert id.' });
    const advert = await Advert.findById(req.params.id);
    if (!advert) return res.status(404).json({ success: false, message: 'Advert not found.' });
    if (req.user.role !== 'admin' && advert.merchantEmail !== req.user.email) {
      return res.status(403).json({ success: false, message: 'You can only delete your own adverts.' });
    }
    const match = advert.imageUrl.match(MEDIA_URL);
    await advert.deleteOne();
    if (match) await Media.deleteOne({ _id: match[1] });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
