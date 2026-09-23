// FILE: models/User.js
const mongoose = require('mongoose');
const crypto = require('crypto');

const default_logo = 'https://raw.githubusercontent.com/rohit721330/Logo-Picture/main/universe-wallet-logo.png';

const userSchema = new mongoose.Schema({
    fullName: { type: String, required: [true, 'Full name is required'], trim: true },
    mobile: { type: String, required: [true, 'Mobile number is required'], trim: true, match: [/^[0-9]{10}$/, 'Please enter a valid 10-digit mobile number'] },
    email: { type: String, required: [true, 'Email address is required'], trim: true, lowercase: true, match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email address'] },
    telegramId: { type: String, trim: true },
    password: { type: String, required: [true, 'Password is required'] },
    pin: { type: String, default: null },
    pin_set: { type: Boolean, default: false },
    balance: { type: Number, default: 0, min: 0 },
    isBlocked: { type: Boolean, default: false },
    isAdmin: { type: Boolean, default: false },
    isNewUser: { type: Boolean, default: true },

    apiKey: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
    apiKeyActive: { type: Boolean, default: true, index: true },
    apiKeyCreatedAt: { type: Date, default: null },
    apiKeyUpdatedAt: { type: Date, default: null },

    totalApiCalls: { type: Number, default: 0, min: 0 },
    successfulApiCalls: { type: Number, default: 0, min: 0 },
    failedApiCalls: { type: Number, default: 0, min: 0 },
    lastApiUsedAt: { type: Date, default: null },
    lastApiSuccessAt: { type: Date, default: null },

    // ✅ Referral System fields
    referralCode: { type: String, unique: true, sparse: true, uppercase: true, trim: true, index: true },
    referralCodeCustom: { type: Boolean, default: false },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    referredByCode: { type: String, uppercase: true, trim: true, default: null },
    referralCount: { type: Number, default: 0, min: 0 },
    referralPendingCount: { type: Number, default: 0, min: 0 },
    referralEarnings: { type: Number, default: 0, min: 0 },
    referralSettings: {
        enabled: { type: Boolean, default: true },
        bonusAmount: { type: Number, default: 10, min: 0 },
        requireFirstTransaction: { type: Boolean, default: true },
        allowCustomCode: { type: Boolean, default: true }
    },

    profilePicture: { type: String, default: default_logo },
    walletId: { type: String, unique: true, uppercase: true },
    lastOTPTime: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: null },
    blockReason: { type: String, default: null },
    blockedAt: { type: Date, default: null }
}, { timestamps: true });

// =========================================================
// INDEXES
// =========================================================
userSchema.index({ mobile: 1 }, { unique: true, partialFilterExpression: { isDeleted: false }, name: 'mobile_unique_active' });
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { isDeleted: false }, name: 'email_unique_active' });
userSchema.index({ telegramId: 1 }, { unique: true, sparse: true, partialFilterExpression: { isDeleted: false }, name: 'telegramId_unique_active' });
userSchema.index({ walletId: 1 }, { unique: true, name: 'walletId_unique' });
userSchema.index({ apiKey: 1 }, { unique: true, sparse: true, name: 'apiKey_unique' });
userSchema.index({ referralCode: 1 }, { unique: true, sparse: true, name: 'referralCode_unique' });
userSchema.index({ referredBy: 1, createdAt: -1 }, { name: 'referredBy_index' });
userSchema.index({ isDeleted: 1, isBlocked: 1, isActive: 1 });

// ============================================
// HELPER: Generate Wallet ID
// ============================================
function generateWalletId() {
    const prefix = 'UW';
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    let letterPart = '';
    while (letterPart.length < 2) {
        const byte = crypto.randomBytes(1)[0];
        if (byte < 234) letterPart += letters[byte % 26];
    }
    let numberPart = '';
    while (numberPart.length < 6) {
        const byte = crypto.randomBytes(1)[0];
        if (byte < 250) numberPart += digits[byte % 10];
    }
    return prefix + letterPart + numberPart;
}

// ============================================
// HELPER: Generate API Key
// ============================================
function generateApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    while (key.length < 10) {
        const byte = crypto.randomBytes(1)[0];
        if (byte < 252) key += chars[byte % chars.length];
    }
    return key;
}

// ============================================
// HELPER: Generate Referral Code (10 alphanumeric)
// ============================================
function generateReferralCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    while (code.length < 10) {
        const byte = crypto.randomBytes(1)[0];
        if (byte < 252) code += chars[byte % chars.length];
    }
    return code;
}

// ============================================
// Pre-save
// ============================================
userSchema.pre('save', async function(next) {
    try {
        if (!this.profilePicture) this.profilePicture = default_logo;

        // Wallet ID
        if (this.isNew && !this.walletId) {
            const User = this.constructor;
            let attempts = 0;
            let newId;
            let exists = true;
            while (exists && attempts < 10) {
                newId = generateWalletId();
                exists = await User.exists({ walletId: newId, _id: { $ne: this._id } });
                attempts++;
            }
            if (exists) return next(new Error('Failed to generate unique Wallet ID.'));
            this.walletId = newId;
        }

        // API Key
        if (this.isNew && !this.apiKey) {
            const User = this.constructor;
            let attempts = 0;
            let newKey;
            let exists = true;
            while (exists && attempts < 10) {
                newKey = generateApiKey();
                exists = await User.exists({ apiKey: newKey, _id: { $ne: this._id } });
                attempts++;
            }
            if (exists) return next(new Error('Failed to generate unique API Key.'));
            this.apiKey = newKey;
            if (this.apiKeyActive === undefined || this.apiKeyActive === null) this.apiKeyActive = true;
            if (!this.apiKeyCreatedAt) this.apiKeyCreatedAt = new Date();
            this.apiKeyUpdatedAt = new Date();
        }

        // ✅ Referral Code
        if (this.isNew && !this.referralCode) {
            const User = this.constructor;
            let attempts = 0;
            let newCode;
            let exists = true;
            while (exists && attempts < 10) {
                newCode = generateReferralCode();
                exists = await User.exists({ referralCode: newCode, _id: { $ne: this._id } });
                attempts++;
            }
            if (exists) return next(new Error('Failed to generate unique Referral Code.'));
            this.referralCode = newCode;
        }

        next();
    } catch (error) {
        next(error);
    }
});

// ============================================
// METHODS
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

userSchema.methods.isAccountActive = function() {
    return !this.isBlocked && !this.isDeleted && this.isActive === true;
};

userSchema.methods.canLogin = function() {
    if (this.isDeleted) return { canLogin: false, reason: 'Account Deleted' };
    if (this.isBlocked) return { canLogin: false, reason: 'Account Blocked' };
    if (this.isActive === false) return { canLogin: false, reason: 'Account Deactivated' };
    return { canLogin: true };
};

userSchema.methods.isApiKeyActive = function() {
    if (!this.apiKey) return false;
    if (this.apiKeyActive === undefined || this.apiKeyActive === null) return true;
    return this.apiKeyActive === true;
};

userSchema.methods.toggleApiKey = async function(active) {
    if (typeof active !== 'boolean') throw new Error('active must be a boolean');
    if (!this.apiKey) throw new Error('No API Key found. Generate one first.');
    this.apiKeyActive = active;
    this.apiKeyUpdatedAt = new Date();
    return await this.save();
};

userSchema.methods.regenerateApiKey = async function() {
    const User = this.constructor;
    let attempts = 0;
    let newKey;
    let exists = true;
    while (exists && attempts < 10) {
        newKey = generateApiKey();
        exists = await User.exists({ apiKey: newKey, _id: { $ne: this._id } });
        attempts++;
    }
    if (exists) throw new Error('Failed to generate unique API Key');
    this.apiKey = newKey;
    this.apiKeyActive = true;
    this.apiKeyCreatedAt = new Date();
    this.apiKeyUpdatedAt = new Date();
    return await this.save();
};

userSchema.methods.softDelete = async function(adminName = 'Admin') {
    this.isDeleted = true;
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
// STATICS
// ============================================
userSchema.statics.findByWalletId = function(walletId) {
    if (!walletId) return null;
    return this.findOne({ walletId: walletId.toUpperCase() });
};
userSchema.statics.findByMobile = function(mobile) {
    if (!mobile) return null;
    return this.findOne({ mobile });
};
userSchema.statics.findByEmail = function(email) {
    if (!email) return null;
    return this.findOne({ email: email.toLowerCase() });
};
userSchema.statics.findByTelegramId = function(telegramId) {
    if (!telegramId) return null;
    return this.findOne({ telegramId });
};
userSchema.statics.findByApiKey = function(apiKey) {
    if (!apiKey) return null;
    return this.findOne({ apiKey: apiKey.toUpperCase() });
};
userSchema.statics.findByReferralCode = function(code) {
    if (!code) return null;
    return this.findOne({ referralCode: code.toUpperCase() });
};
userSchema.statics.findActiveByApiKey = function(apiKey) {
    if (!apiKey) return null;
    return this.findOne({ apiKey: apiKey.toUpperCase(), isDeleted: false, isBlocked: false });
};
userSchema.statics.findActiveByMobile = function(mobile) {
    if (!mobile) return null;
    return this.findOne({ mobile, isDeleted: false });
};
userSchema.statics.findActiveByEmail = function(email) {
    if (!email) return null;
    return this.findOne({ email: email.toLowerCase(), isDeleted: false });
};
userSchema.statics.findActiveByTelegramId = function(telegramId) {
    if (!telegramId) return null;
    return this.findOne({ telegramId, isDeleted: false });
};
userSchema.statics.getUserCount = function() {
    return this.countDocuments({ isDeleted: false });
};
userSchema.statics.getActiveUserCount = function() {
    return this.countDocuments({ isBlocked: false, isDeleted: false, isActive: true });
};
userSchema.statics.getBlockedUserCount = function() {
    return this.countDocuments({ isBlocked: true, isDeleted: false });
};
userSchema.statics.getDeletedUserCount = function() {
    return this.countDocuments({ isDeleted: true });
};
userSchema.statics.findActiveUsers = function(query = {}) {
    return this.find({ ...query, isBlocked: false, isDeleted: false, isActive: true });
};
userSchema.statics.findActiveUserById = function(userId) {
    if (!userId) return null;
    return this.findOne({ _id: userId, isBlocked: false, isDeleted: false, isActive: true });
};

module.exports = mongoose.model('User', userSchema);
module.exports.default_logo = default_logo;
module.exports.generateReferralCode = generateReferralCode;
