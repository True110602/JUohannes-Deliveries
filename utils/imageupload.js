// utils/imageUpload.js
// One place that receives an uploaded image, verifies it really is an image, and
// stores it in MongoDB (models/Media.js). Used by every upload endpoint so pictures
// survive restarts/redeploys (Render wipes files saved to disk).
const multer = require('multer');
const Media = require('../models/Media');
const { detectImageType } = require('./imageType');

const MAX_BYTES = 3 * 1024 * 1024; // 3 MB
const receive = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1 } }).single('image');

const fail = (status, message) => { const e = new Error(message); e.status = status; return e; };

// Resolves with the picture's URL (/api/media/<id>); rejects with an Error carrying .status.
function storeUploadedImage(req, res) {
  return new Promise((resolve, reject) => {
    receive(req, res, async (err) => {
      if (err) return reject(fail(400, err.code === 'LIMIT_FILE_SIZE' ? 'That image is too large (maximum 3 MB).' : (err.message || 'Upload failed.')));
      if (!req.file) return reject(fail(400, 'No image file was received.'));
      const mimeType = detectImageType(req.file.buffer);
      if (!mimeType) return reject(fail(400, 'Only JPG, PNG, WEBP or GIF images are allowed.'));
      try {
        const media = await Media.create({ data: req.file.buffer, mimeType, size: req.file.size, uploadedBy: (req.user && req.user.email) || '' });
        resolve('/api/media/' + media._id);
      } catch (e) {
        console.error('Image save error:', e);
        reject(fail(500, 'Could not save the image. Please try again.'));
      }
    });
  });
}

module.exports = { storeUploadedImage };
