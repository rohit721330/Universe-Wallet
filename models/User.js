// FILE: models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  mobile: { type: String, required: true },
  telegramId: { type: String, unique: true, sparse: true },
  password: { type: String, required: true },
  pin: { type: String, default: null },
  pin_set: { type: Boolean, default: false },
  balance: { type: Number, default: 0 },
  isBlocked: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  apiKey: { type: String, default: null },
  profilePicture: { type: String, default: null },
  walletId: { type: String, unique: true, required: true, uppercase: true }
}, { timestamps: true });

// Pre-save: Hash password
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-save: Generate wallet ID (PW prefix)
userSchema.pre('save', async function(next) {
  if (!this.walletId) {
    const prefix = 'PW';
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let letterPart = '';
    for (let i = 0; i < 2; i++) {
      letterPart += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    let numberPart = '';
    for (let i = 0; i < 6; i++) {
      numberPart += Math.floor(Math.random() * 10).toString();
    }
    this.walletId = prefix + letterPart + numberPart;
  }
  next();
});

// Compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password);
  } catch (error) {
    throw error;
  }
};

// Compare PIN
userSchema.methods.comparePin = async function(candidatePin) {
  try {
    if (!this.pin) return false;
    return await bcrypt.compare(candidatePin, this.pin);
  } catch (error) {
    return false;
  }
};

// Static methods
userSchema.statics.findByWalletId = function(walletId) {
  return this.findOne({ walletId: walletId.toUpperCase() });
};

module.exports = mongoose.model('User', userSchema);
