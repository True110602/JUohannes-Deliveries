const mongoose = require('mongoose');

const driverLocationSchema = new mongoose.Schema({
  driverId: { type: String, required: true, unique: true },
  lat: Number,
  lng: Number
}, { timestamps: true });

module.exports = mongoose.model('DriverLocation', driverLocationSchema);
