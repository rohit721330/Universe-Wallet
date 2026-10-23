// FILE: models/Admin.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
    adminId: { type: String, required: false, unique: true, trim: true, uppercase: true },
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
    // Password hash
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 10);
    }

    // Auto-generate Wallet ID for new admins
    if (!this.walletId && this.isNew) {
        let unique = false;
        let attempts = 0;
        while (!unique && attempts < 10) {
            const candidate = 'ADM' +
                Date.now().toString(36).toUpperCase() +
                Math.random().toString(36).substring(2, 6).toUpperCase();
            const exists = await mongoose.model('Admin').findOne({ walletId: candidate });
            if (!exists) {
                this.walletId = candidate;
                unique = true;
            }
            attempts++;
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

module.exports = mongoose.model('Admin', adminSchema);