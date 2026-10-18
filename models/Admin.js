// FILE: models/Admin.js — SECURED VERSION
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const adminSchema = new mongoose.Schema({
    // 🔧 FIX: uppercase: true বাদ — route-এ decision নিন
    adminId: { type: String, required: true, unique: true, trim: true },
    walletId: { type: String, unique: true, sparse: true, trim: true, uppercase: true },
    password: { type: String, required: true, select: false }, // 🔧 select: false
    fullName: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, unique: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    telegramId: { type: String, trim: true, unique: true, sparse: true },
    role: { type: String, enum: ['super_admin', 'admin', 'moderator'], default: 'admin' },
    isActive: { type: Boolean, default: true },
    isBlocked: { type: Boolean, default: false },
    lastLoginAt: Date,
    lastLoginIP: String,
    lastLoginMethod: String,
    createdBy: String,
    updatedBy: String,

    referralSettings: {
        enabled: { type: Boolean, default: true },
        bonusAmount: { type: Number, default: 10, min: 1 },
        minDepositAmount: { type: Number, default: 50, min: 1 },
        maxReferralsPerUser: { type: Number, default: 100, min: 1 },
        updatedAt: { type: Date, default: null },
        updatedBy: { type: String, default: null }
    }
}, { timestamps: true });

// ============================================
// PRE-SAVE HOOKS
// ============================================
adminSchema.pre('save', async function(next) {
    // 🔧 FIX: Password hash — already-hashed হলে আবার hash করবেন না
    if (this.isModified('password')) {
        const isAlreadyHashed = typeof this.password === 'string' &&
                                /^\$2[aby]\$\d{2}\$/.test(this.password);
        if (!isAlreadyHashed) {
            // 🔧 FIX: rounds 10 → 12
            this.password = await bcrypt.hash(this.password, 12);
        }
    }

    // 🔧 FIX: WalletId generation — crypto ব্যবহার (Math.random নয়)
    if (!this.walletId && this.isNew) {
        let unique = false;
        let attempts = 0;
        while (!unique && attempts < 10) {
            const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
            const time = Date.now().toString(36).toUpperCase();
            const candidate = 'ADM' + time + rand;
            const exists = await mongoose.model('Admin').findOne({ walletId: candidate });
            if (!exists) {
                this.walletId = candidate;
                unique = true;
            }
            attempts++;
        }
        if (!unique) {
            return next(new Error('Failed to generate unique walletId'));
        }
    }

    next();
});

// ============================================
// METHODS
// ============================================
adminSchema.methods.comparePassword = async function(candidate) {
    return await bcrypt.compare(candidate, this.password);
};

// 🔧 ADD: নিরাপদ public representation (password কখনো leak না হয়)
adminSchema.methods.toSafeJSON = function() {
    return {
        id: this._id,
        adminId: this.adminId,
        fullName: this.fullName,
        mobile: this.mobile,
        email: this.email,
        role: this.role,
        isActive: this.isActive,
        isBlocked: this.isBlocked,
        createdAt: this.createdAt,
    };
};

module.exports = mongoose.model('Admin', adminSchema);