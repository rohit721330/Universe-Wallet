// FILE: models/Deposit.js
const mongoose = require('mongoose');

const depositSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    depositId: { type: String, required: true, unique: true, index: true, trim: true },
    amount: { type: Number, required: true, min: 1 },
    upiId: { type: String, default: '' },
    qrData: { type: String, default: '' },
    transactionRef: { type: String, default: null, index: true },
    // ✅ Simplified status: pending → approved | rejected | cancelled
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
    // Admin action tracking
    adminNote: { type: String, default: null },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    rejectedBy: { type: String, default: null },
    rejectedAt: { type: Date, default: null },
    cancelledBy: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    // Tax tracking
    taxPercent: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    creditAmount: { type: Number, default: 0 },
    // Submission time
    verifiedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// ============================================
// INDEXES
// ============================================
depositSchema.index({ userId: 1, status: 1 });
depositSchema.index({ status: 1, createdAt: -1 });
depositSchema.index({ transactionRef: 1, status: 1 });

// ============================================
// METHODS
// ============================================
depositSchema.methods.markApproved = function(adminName, creditAmount, taxAmount, taxPercent, note) {
    this.status = 'approved';
    this.approvedBy = adminName;
    this.approvedAt = new Date();
    this.creditAmount = creditAmount;
    this.taxAmount = taxAmount;
    this.taxPercent = taxPercent;
    this.adminNote = note || 'Approved by admin';
    return this;
};

depositSchema.methods.markRejected = function(adminName, note) {
    this.status = 'rejected';
    this.rejectedBy = adminName;
    this.rejectedAt = new Date();
    this.adminNote = note || 'Rejected by admin';
    return this;
};

depositSchema.methods.markCancelled = function(adminName, note) {
    this.status = 'cancelled';
    this.cancelledBy = adminName;
    this.cancelledAt = new Date();
    this.adminNote = note || 'Cancelled by admin';
    return this;
};

depositSchema.methods.isPending = function() {
    return this.status === 'pending';
};

// ============================================
// PRE-SAVE
// ============================================
depositSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

// ============================================
// JSON
// ============================================
depositSchema.set('toJSON', {
    virtuals: true,
    transform: function(doc, ret) {
        delete ret.__v;
        return ret;
    }
});

module.exports = mongoose.model('Deposit', depositSchema);