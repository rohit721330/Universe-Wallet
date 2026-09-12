//FILE models/Otp.js
const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
    identifier: { type: String, required: true, index: true }, // email, mobile, or tgId
    type: { 
        type: String, 
        required: true, 
        enum: ['login', 'register_email', 'register_telegram', 'reset_password'] 
    },
    otp: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }, // TTL index
    createdAt: { type: Date, default: Date.now }
});

// Compound unique index
otpSchema.index({ identifier: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('Otp', otpSchema);
