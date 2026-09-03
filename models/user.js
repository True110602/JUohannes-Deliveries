// models/User.js (Mongoose Schema)
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  resetCode: { type: String, default: null },         // Stores the 6-digit code
  resetCodeExpires: { type: Date, default: null }     // Stores code expiration time
});
