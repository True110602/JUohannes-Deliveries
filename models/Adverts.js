// models/Advert.js
// A picture advert shown in the home page slideshow. merchantEmail is empty for
// adverts the platform owner (admin) posts themselves.
const mongoose = require('mongoose');

const advertSchema = new mongoose.Schema({
  merchantEmail: { type: String, default: null },
  title: { type: String, default: '', maxlength: 80 },
  imageUrl: { type: String, required: true } // always /api/media/<id>
}, { timestamps: true });

module.exports = mongoose.model('Advert', advertSchema);
