// FILE: models/Admin.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
    adminId: { type: String, required: true, unique: true, trim: true, uppercase: true },
    walletId: { type: String, unique: true, sparse: true, trim: true, uppercase: true },
    password: { type: String, required: true },
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

    depositSettings: {
        minDeposit: { type: Number, default: 10, min: 1 },
        maxDeposit: { type: Number, default: 100000, min: 1 },
        taxPercent: { type: Number, default: 0, min: 0, max: 100 },
        taxEnabled: { type: Boolean, default: false },
        updatedAt: { type: Date, default: null },
        updatedBy: { type: String, default: null }
    },

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
// PRE-VALIDATE: Auto-generate walletId + sync adminId
// ============================================
adminSchema.pre('validate', async function(next) {
    try {
        // 1) Auto-generate walletId for new admin (if not provided)
        if (!this.walletId && this.isNew) {
            let unique = false;
            let attempts = 0;
            while (!unique && attempts < 10) {
                const candidate = 'ADM' +
                    Date.now().toString(36).toUpperCase() +
                    Math.random().toString(36).substring(2, 6).toUpperCase();
                const exists = await mongoose.model('Admin').findOne({ walletId: candidate }).lean();
                if (!exists) {
                    this.walletId = candidate;
                    unique = true;
                }
                attempts++;
            }
            if (!unique) {
                return next(new Error('Could not generate unique walletId. Try again.'));
            }
        }

        // 2) CRITICAL: Set adminId = walletId (if adminId missing)
        if (!this.adminId && this.walletId) {
            this.adminId = this.walletId;
        }

        next();
    } catch (err) {
        next(err);
    }
});

// ============================================
// PRE-SAVE: Hash password + ensure adminId sync
// ============================================
adminSchema.pre('save', async function(next) {
    try {
        // Hash password
        if (this.isModified('password')) {
            this.password = await bcrypt.hash(this.password, 10);
        }

        // Safety: if walletId changed, update adminId
        if (this.isModified('walletId') && this.walletId) {
            this.adminId = this.walletId;
        }

        // Safety: ensure adminId always exists
        if (!this.adminId && this.walletId) {
            this.adminId = this.walletId;
        }

        next();
    } catch (err) {
        next(err);
    }
});

// ============================================
// METHODS
// ============================================
adminSchema.methods.comparePassword = async function(candidate) {
    return await bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('Admin', adminSchema);