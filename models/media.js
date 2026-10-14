// models/Media.js
// Images stored in MongoDB instead of on disk. Hosts like Render wipe the server's
// files on every restart/redeploy, which would make shop pictures and adverts
// disappear - the database keeps them. Served by GET /api/media/:id (routes/media.js).
const mongoose = require('mongoose');

const mediaSchema = new mongoose.Schema({
  data: { type: Buffer, required: true },
  mimeType: { type: String, required: true, enum: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] },
  size: { type: Number, default: 0 },
  uploadedBy: { type: String, default: '' } // email of the uploader
}, { timestamps: true });

module.exports = mongoose.model('Media', mediaSchema);
