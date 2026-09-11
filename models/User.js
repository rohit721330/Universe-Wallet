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
    lastOTPTime: { type: Number, default: 0 },

    // ✅ NEW FIELDS — Deletion / Deactivation Support
    isDeleted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: null },
    blockReason: { type: String, default: null },
    blockedAt: { type: Date, default: null }
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
        // Wallet ID generate (retry সহ unique নিশ্চিত করা)
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

        // API Key generate (retry সহ)
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
// INSTANCE METHODS — Account Status Checks
// ============================================
userSchema.methods.isAccountActive = function() {
    return !this.isBlocked && !this.isDeleted && this.isActive === true;
};

userSchema.methods.canLogin = function() {
    if (this.isDeleted) return { canLogin: false, reason: 'Account Deleted' };
    if (this.isBlocked) return { canLogin: false, reason: 'Account Blocked' };
    if (this.isActive === false) return { canLogin: false, reason: 'Account Deactivated' };
    return { canLogin: true };
};

// ============================================
// INSTANCE METHODS — Soft Delete / Restore
// ============================================
userSchema.methods.softDelete = async function(adminName = 'Admin') {
    this.isDeleted = true;
    this.isActive = false;
    this.isBlocked = true;
    this.deletedAt = new Date();
    this.deletedBy = adminName;
    return await this.save();
};

userSchema.methods.restore = async function() {
    this.isDeleted = false;
    this.isActive = true;
    this.isBlocked = false;
    this.deletedAt = null;
    this.deletedBy = null;
    this.blockReason = null;
    this.blockedAt = null;
    return await this.save();
};

userSchema.methods.blockAccount = async function(reason = 'Blocked by admin') {
    this.isBlocked = true;
    this.blockReason = reason;
    this.blockedAt = new Date();
    return await this.save();
};

userSchema.methods.unblockAccount = async function() {
    this.isBlocked = false;
    this.blockReason = null;
    this.blockedAt = null;
    return await this.save();
};

// ============================================
// STATIC METHODS — Find by various fields
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

// ============================================
// STATIC METHODS — Counts (excluding deleted)
// ============================================
userSchema.statics.getUserCount = function() {
    return this.countDocuments({ isDeleted: false });
};
userSchema.statics.getActiveUserCount = function() {
    return this.countDocuments({
        isBlocked: false,
        isDeleted: false,
        isActive: true
    });
};
userSchema.statics.getBlockedUserCount = function() {
    return this.countDocuments({ isBlocked: true, isDeleted: false });
};
userSchema.statics.getDeletedUserCount = function() {
    return this.countDocuments({ isDeleted: true });
};

// ============================================
// STATIC METHODS — Only active users
// ============================================
userSchema.statics.findActiveUsers = function(query = {}) {
    return this.find({
        ...query,
        isBlocked: false,
        isDeleted: false,
        isActive: true
    });
};

userSchema.statics.findActiveUserById = function(userId) {
    if (!userId) return null;
    return this.findOne({
        _id: userId,
        isBlocked: false,
        isDeleted: false,
        isActive: true
    });
};

module.exports = mongoose.model('User', userSchema);
