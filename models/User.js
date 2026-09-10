// FILE: models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    fullName: { type: String, required: [true, 'Full name is required'], trim: true },
    mobile: { type: String, required: [true, 'Mobile number is required'], unique: true, trim: true, match: [/^[0-9]{10}$/, 'Please enter a valid 10-digit mobile number'] },
    email: { type: String, required: [true, 'Email address is required'], unique: true, trim: true, lowercase: true, match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email address'] },
    telegramId: { type: String, unique: true, sparse: true, trim: true },
    password: { type: String, required: [true, 'Password is required'], minlength: [8, 'Password must be at least 8 characters long'], maxlength: [15, 'Password cannot exceed 15 characters'] },
    pin: { type: String, default: null },
    pin_set: { type: Boolean, default: false },
    balance: { type: Number, default: 0, min: 0 },
    isBlocked: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    isNewUser: { type: Boolean, default: true },
    apiKey: { type: String, unique: true, sparse: true, default: null },
    profilePicture: { type: String, default: null },
    walletId: { type: String, unique: true, required: true, uppercase: true },
    lastOTPTime: { type: Number, default: 0 }
}, { timestamps: true });

// Pre-save: Hash password
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    try {
        const salt = await bcrypt.genSalt(12);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Pre-save: Generate wallet ID (UW prefix - Universal Wallet)
userSchema.pre('save', async function(next) {
    if (this.walletId) return next();
    try {
        const prefix = 'UW';
        const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let letterPart = '';
        for (let i = 0; i < 2; i++) letterPart += letters.charAt(Math.floor(Math.random() * letters.length));
        let numberPart = '';
        for (let i = 0; i < 6; i++) numberPart += Math.floor(Math.random() * 10).toString();
        this.walletId = prefix + letterPart + numberPart;
        next();
    } catch (error) {
        next(error);
    }
});

// Pre-save: Generate API Key
userSchema.pre('save', async function(next) {
    if (this.apiKey) return next();
    try {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let key = '';
        for (let i = 0; i < 10; i++) key += chars.charAt(Math.floor(Math.random() * chars.length));
        this.apiKey = key;
        next();
    } catch (error) {
        next(error);
    }
});

// Compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
    try {
        if (!candidatePassword) return false;
        return await bcrypt.compare(candidatePassword, this.password);
    } catch (error) {
        console.error('Password comparison error:', error);
        return false;
    }
};

// Compare PIN
userSchema.methods.comparePin = async function(candidatePin) {
    try {
        if (!this.pin || !candidatePin) return false;
        return await bcrypt.compare(candidatePin, this.pin);
    } catch (error) {
        console.error('PIN comparison error:', error);
        return false;
    }
};

// Check if PIN is set
userSchema.methods.hasPin = function() {
    return this.pin !== null && this.pin_set === true;
};

// Static methods - Find by various fields
userSchema.statics.findByWalletId = function(walletId) {
    if (!walletId) return null;
    return this.findOne({ walletId: walletId.toUpperCase() });
};
userSchema.statics.findByMobile = function(mobile) {
    if (!mobile) return null;
    return this.findOne({ mobile: mobile });
};
userSchema.statics.findByEmail = function(email) {
    if (!email) return null;
    return this.findOne({ email: email.toLowerCase() });
};
userSchema.statics.findByTelegramId = function(telegramId) {
    if (!telegramId) return null;
    return this.findOne({ telegramId: telegramId });
};
userSchema.statics.findByApiKey = function(apiKey) {
    if (!apiKey) return null;
    return this.findOne({ apiKey: apiKey });
};

// Static methods - Count users
userSchema.statics.getUserCount = function() {
    return this.countDocuments();
};
userSchema.statics.getActiveUserCount = function() {
    return this.countDocuments({ isBlocked: false });
};

// ❌ REMOVED: Duplicate indexes (already created by unique: true)
// userSchema.index({ mobile: 1 });
// userSchema.index({ email: 1 });
// userSchema.index({ telegramId: 1 });
// userSchema.index({ walletId: 1 });
// userSchema.index({ apiKey: 1 });

module.exports = mongoose.model('User', userSchema);
