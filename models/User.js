// FILE: models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    fullName: { type: String, required: [true, 'Full name is required'], trim: true },
    mobile: { type: String, required: [true, 'Mobile number is required'], unique: true, trim: true, match: [/^[0-9]{10}$/, 'Please enter a valid 10-digit mobile number'] },
    email: { type: String, required: [true, 'Email address is required'], unique: true, trim: true, lowercase: true, match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email address'] },
    telegramId: { type: String, unique: true, sparse: true, trim: true },
    password: { type: String, required: [true, 'Password is required'] },
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

// ============================================
// HELPER: Generate Wallet ID
// ============================================
function generateWalletId() {
    const prefix = 'UW';
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let letterPart = '';
    for (let i = 0; i < 2; i++) {
        letterPart += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    let numberPart = '';
    for (let i = 0; i < 6; i++) {
        numberPart += Math.floor(Math.random() * 10).toString();
    }
    return prefix + letterPart + numberPart;
}

// ============================================
// HELPER: Generate API Key
// ============================================
function generateApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 10; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
}

// ============================================
// Pre-save: Wallet ID + API Key (with retry)
// ============================================
userSchema.pre('save', async function(next) {
    try {
        // ✅ Wallet ID generate (retry সহ unique নিশ্চিত করা)
        if (!this.walletId) {
            const User = this.constructor;
            let attempts = 0;
            const maxAttempts = 10;
            let newId;
            let exists = true;

            while (exists && attempts < maxAttempts) {
                newId = generateWalletId();
                exists = await User.exists({ walletId: newId });
                attempts++;
            }

            if (exists) {
                return next(new Error('Failed to generate unique Wallet ID. Please try again.'));
            }
            this.walletId = newId;
        }

        // ✅ API Key generate (retry সহ)
        if (!this.apiKey) {
            const User = this.constructor;
            let attempts = 0;
            const maxAttempts = 10;
            let newKey;
            let exists = true;

            while (exists && attempts < maxAttempts) {
                newKey = generateApiKey();
                exists = await User.exists({ apiKey: newKey });
                attempts++;
            }

            if (exists) {
                return next(new Error('Failed to generate unique API Key. Please try again.'));
            }
            this.apiKey = newKey;
        }

        next();
    } catch (error) {
        next(error);
    }
});

// ============================================
// COMPARE METHODS — Plain text
// ============================================
userSchema.methods.comparePassword = async function(candidatePassword) {
    if (!candidatePassword) return false;
    return candidatePassword === this.password;
};

userSchema.methods.comparePin = async function(candidatePin) {
    if (!this.pin || !candidatePin) return false;
    return candidatePin === this.pin;
};

userSchema.methods.hasPin = function() {
    return this.pin !== null && this.pin_set === true;
};

// ============================================
// STATIC METHODS
// ============================================
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
userSchema.statics.getUserCount = function() {
    return this.countDocuments();
};
userSchema.statics.getActiveUserCount = function() {
    return this.countDocuments({ isBlocked: false });
};

module.exports = mongoose.model('User', userSchema);
