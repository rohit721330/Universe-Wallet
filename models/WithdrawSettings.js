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

// ✅ Pre-save middleware to update updatedAt
withdrawSettingsSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// ✅ Static method to get default settings
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

// ✅ Method to reset to default settings
withdrawSettingsSchema.methods.resetToDefault = function() {
    const defaults = this.constructor.getDefaults();
    Object.keys(defaults).forEach(key => {
        this[key] = defaults[key];
    });
    this.updatedAt = new Date();
    this.updatedBy = 'System (Reset)';
    return this.save();
};

module.exports = mongoose.model('WithdrawSettings', withdrawSettingsSchema);
