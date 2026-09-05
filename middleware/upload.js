// middleware/upload.js
// Handles merchant image uploads (profile picture / catalog item photos)
// so merchants can drag-drop or pick a file straight from their device
// instead of having to host an image somewhere else and paste a URL.
//
// Files are written to public/uploads and served statically from there
// (server.js already does app.use(express.static('public'))), so a saved
// file becomes reachable at /uploads/<filename>.
//
// NOTE: on hosts with an ephemeral filesystem (e.g. Render's free tier)
// anything written here can be wiped on redeploy/restart. That's a hosting
// limitation, not a bug in this code - if persistent storage is needed
// long-term, swap the multer storage engine for one backed by S3/Cloudinary/etc.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, uniqueName);
  }
});

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return cb(new Error('Only JPG, PNG, WEBP, or GIF images are allowed.'));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

module.exports = upload;
