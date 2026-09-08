// FILE: models/Withdraw.js
const mongoose = require('mongoose');

const withdrawSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    walletId: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
    fee: { type: Number, default: 0, min: 0 },
    feeType: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
    feeRate: { type: Number, default: 0, min: 0 },
    totalDeduction: { type: Number, default: 0, min: 0 },
    method: { type: String, enum: ['upi', 'bank'], required: true, default: 'upi' },
    upiId: { type: String, trim: true, default: null },
    bankName: { type: String, trim: true, default: null },
    accountNumber: { type: String, trim: true, default: null },
    accountHolderName: { type: String, trim: true, default: null },
    ifscCode: { type: String, trim: true, default: null },
    status: { type: String, enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'], default: 'pending' },
    transactionId: { type: String, unique: true, sparse: true },
    apiKeyUsed: { type: String, default: null },
    adminNote: { type: String, default: null },
    userNote: { type: String, default: null },
    processedAt: { type: Date, default: null },
    processedBy: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// ✅ Generate unique transaction ID
withdrawSchema.statics.generateTransactionId = function() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `WD${timestamp}${random}`;
};

// ✅ Pre-save middleware
withdrawSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    if (!this.transactionId) {
        this.transactionId = this.constructor.generateTransactionId();
    }
    next();
});

module.exports = mongoose.model('Withdraw', withdrawSchema);
