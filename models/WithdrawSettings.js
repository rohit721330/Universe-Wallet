// FILE: models/WithdrawSettings.js
const mongoose = require('mongoose');

const withdrawSettingsSchema = new mongoose.Schema({
    enabled: { type: Boolean, default: true },
    minAmount: { type: Number, default: 1, min: 0 },
    maxAmount: { type: Number, default: 5000, min: 0 },
    fee: { type: Number, default: 0, min: 0 },
    feeType: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
    approvalRequired: { type: Boolean, default: true },
    maxDailyWithdrawals: { type: Number, default: 10, min: 0 },
    maxMonthlyWithdrawals: { type: Number, default: 50, min: 0 },
    requireBankDetails: { type: Boolean, default: true },
    requireUpiDetails: { type: Boolean, default: true },
    autoApproveBelow: { type: Number, default: 0, min: 0 },
    updatedBy: { type: String, default: 'System' },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// ============================================
// PRE-SAVE MIDDLEWARE: Update updatedAt timestamp
// ============================================
withdrawSettingsSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// ============================================
// STATIC: Get Default Settings
// ============================================
withdrawSettingsSchema.statics.getDefaults = function() {
    return {
        enabled: true,
        minAmount: 1,
        maxAmount: 5000,
        fee: 0,
        feeType: 'percentage',
        approvalRequired: true,
        maxDailyWithdrawals: 10,
        maxMonthlyWithdrawals: 50,
        requireBankDetails: true,
        requireUpiDetails: true,
        autoApproveBelow: 0,
        updatedBy: 'System'
    };
};

// ============================================
// STATIC: Get Current Settings (Auto-create if not exists)
// ============================================
withdrawSettingsSchema.statics.getCurrentSettings = async function() {
    try {
        let settings = await this.findOne();
        if (!settings) {
            settings = new this();
            await settings.save();
            console.log('Default Withdraw Settings Created');
        }
        return settings;
    } catch (error) {
        console.error('Get Settings Error:', error.message);
        return this.getDefaults();
    }
};

// ============================================
// STATIC: Update Settings
// ============================================
withdrawSettingsSchema.statics.updateSettings = async function(data, updatedBy = 'Admin') {
    try {
        let settings = await this.findOne();
        if (!settings) {
            settings = new this();
        }

        if (data.enabled !== undefined) settings.enabled = data.enabled;
        if (data.minAmount !== undefined) settings.minAmount = data.minAmount;
        if (data.maxAmount !== undefined) settings.maxAmount = data.maxAmount;
        if (data.fee !== undefined) settings.fee = data.fee;
        if (data.feeType !== undefined) settings.feeType = data.feeType;
        if (data.approvalRequired !== undefined) settings.approvalRequired = data.approvalRequired;
        if (data.maxDailyWithdrawals !== undefined) settings.maxDailyWithdrawals = data.maxDailyWithdrawals;
        if (data.maxMonthlyWithdrawals !== undefined) settings.maxMonthlyWithdrawals = data.maxMonthlyWithdrawals;
        if (data.requireBankDetails !== undefined) settings.requireBankDetails = data.requireBankDetails;
        if (data.requireUpiDetails !== undefined) settings.requireUpiDetails = data.requireUpiDetails;
        if (data.autoApproveBelow !== undefined) settings.autoApproveBelow = data.autoApproveBelow;

        settings.updatedBy = updatedBy;
        settings.updatedAt = new Date();

        await settings.save();
        console.log('Withdraw Settings Updated By:', updatedBy);
        return settings;
    } catch (error) {
        console.error('Update Settings Error:', error.message);
        throw error;
    }
};

// ============================================
// METHOD: Reset to Default Settings
// ============================================
withdrawSettingsSchema.methods.resetToDefault = function() {
    const defaults = this.constructor.getDefaults();
    Object.keys(defaults).forEach(key => {
        this[key] = defaults[key];
    });
    this.updatedAt = new Date();
    this.updatedBy = 'System (Reset)';
    return this.save();
};

// ============================================
// METHOD: Validate Amount Against Settings
// ============================================
withdrawSettingsSchema.methods.validateAmount = function(amount) {
    if (!this.enabled) {
        return { valid: false, message: 'Withdrawal Is Currently Disabled' };
    }
    if (amount < this.minAmount) {
        return { valid: false, message: `Minimum Withdrawal Amount Is ₹${this.minAmount}` };
    }
    if (amount > this.maxAmount) {
        return { valid: false, message: `Maximum Withdrawal Amount Is ₹${this.maxAmount}` };
    }
    return { valid: true };
};

// ============================================
// METHOD: Calculate Fee
// ============================================
withdrawSettingsSchema.methods.calculateFee = function(amount) {
    if (!this.fee || this.fee <= 0 || !amount || amount <= 0) return 0;
    
    let feeAmount = 0;
    if (this.feeType === 'percentage') {
        feeAmount = (amount * this.fee) / 100;
    } else if (this.feeType === 'fixed') {
        feeAmount = this.fee;
    }
    return Math.round(feeAmount * 100) / 100;
};

// ============================================
// METHOD: Check if Auto-Approve is Applicable
// ============================================
withdrawSettingsSchema.methods.shouldAutoApprove = function(amount) {
    if (!this.approvalRequired) return true;
    if (this.autoApproveBelow > 0 && amount <= this.autoApproveBelow) return true;
    return false;
};

// ============================================
// VIRTUAL: Get Fee Description
// ============================================
withdrawSettingsSchema.virtual('feeDescription').get(function() {
    if (this.fee === 0) return 'No Fee';
    if (this.feeType === 'percentage') return `${this.fee}% Fee`;
    return `₹${this.fee} Fixed Fee`;
});

// ============================================
// VIRTUAL: Get Amount Range Description
// ============================================
withdrawSettingsSchema.virtual('amountRange').get(function() {
    return `₹${this.minAmount} - ₹${this.maxAmount}`;
});

// ============================================
// TOJSON TRANSFORM
// ============================================
withdrawSettingsSchema.set('toJSON', {
    virtuals: true,
    transform: function(doc, ret) {
        delete ret.__v;
        return ret;
    }
});

module.exports = mongoose.model('WithdrawSettings', withdrawSettingsSchema);
