// FILE: models/Withdraw.js
const mongoose = require('mongoose');

const withdrawSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    walletId: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
    fee: { type: Number, default: 0, min: 0 },
    feeType: { type: String, enum: ['percentage', 'fixed'], default: 'percentage' },
    feeRate: { type: Number, default: 0, min: 0 },
    userReceives: { type: Number, default: 0, min: 0 },
    totalDeduction: { type: Number, default: 0, min: 0 },
    method: { type: String, enum: ['upi', 'bank'], required: true, default: 'upi' },
    upiId: { type: String, trim: true, default: null },
    bankName: { type: String, trim: true, default: null },
    accountNumber: { type: String, trim: true, default: null },
    accountHolderName: { type: String, trim: true, default: null },
    ifscCode: { type: String, trim: true, default: null },
    status: { 
        type: String, 
        enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'], 
        default: 'pending',
        index: true
    },
    transactionId: { type: String, unique: true, sparse: true, index: true },
    apiKeyUsed: { type: String, default: null },
    adminNote: { type: String, default: null },
    userNote: { type: String, default: null },
    processedAt: { type: Date, default: null },
    processedBy: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// ============================================
// STATIC: Generate unique transaction ID
// ============================================
withdrawSchema.statics.generateTransactionId = function() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `WD${timestamp}${random}`;
};

// ============================================
// PRE-SAVE MIDDLEWARE: Auto-generate transaction ID & update timestamp
// ============================================
withdrawSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    if (!this.transactionId) {
        this.transactionId = this.constructor.generateTransactionId();
    }
    next();
});

// ============================================
// INDEXES FOR BETTER PERFORMANCE
// ============================================
withdrawSchema.index({ userId: 1, createdAt: -1 });
withdrawSchema.index({ status: 1, createdAt: -1 });
withdrawSchema.index({ method: 1, status: 1 });
withdrawSchema.index({ transactionId: 1 });

// ============================================
// VIRTUALS
// ============================================
withdrawSchema.virtual('formattedAmount').get(function() {
    return `₹${this.amount.toFixed(2)}`;
});

withdrawSchema.virtual('statusLabel').get(function() {
    const labels = {
        'pending': 'Pending',
        'processing': 'Processing',
        'completed': 'Completed',
        'failed': 'Failed',
        'cancelled': 'Cancelled'
    };
    return labels[this.status] || this.status;
});

withdrawSchema.virtual('methodLabel').get(function() {
    return this.method === 'upi' ? 'UPI' : 'Bank Transfer';
});

// ============================================
// METHODS
// ============================================
withdrawSchema.methods.isPending = function() {
    return this.status === 'pending';
};

withdrawSchema.methods.canBeProcessed = function() {
    return this.status === 'pending' || this.status === 'processing';
};

withdrawSchema.methods.markAsProcessing = async function(adminId = null) {
    this.status = 'processing';
    if (adminId) this.processedBy = adminId;
    await this.save();
    return this;
};

withdrawSchema.methods.markAsCompleted = async function(adminId = null, note = '') {
    this.status = 'completed';
    this.processedAt = new Date();
    if (adminId) this.processedBy = adminId;
    if (note) this.adminNote = note;
    await this.save();
    return this;
};

withdrawSchema.methods.markAsFailed = async function(adminId = null, reason = '') {
    this.status = 'failed';
    this.processedAt = new Date();
    if (adminId) this.processedBy = adminId;
    if (reason) this.adminNote = reason;
    await this.save();
    return this;
};

// ============================================
// STATIC METHODS
// ============================================
withdrawSchema.statics.findByTransactionId = function(transactionId) {
    return this.findOne({ transactionId });
};

withdrawSchema.statics.getUserWithdrawals = function(userId, limit = 50, skip = 0) {
    return this.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
};

withdrawSchema.statics.getPendingWithdrawals = function(limit = 100, skip = 0) {
    return this.find({
        status: { $in: ['pending', 'processing'] }
    })
    .populate('userId', 'fullName mobile walletId balance')
    .sort({ createdAt: 1 })
    .skip(skip)
    .limit(limit);
};

withdrawSchema.statics.getPendingCount = async function(userId) {
    return this.countDocuments({
        userId,
        status: { $in: ['pending', 'processing'] }
    });
};

withdrawSchema.statics.getDailyCount = async function(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return this.countDocuments({
        userId,
        createdAt: { $gte: today }
    });
};

withdrawSchema.statics.getMonthlyCount = async function(userId) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return this.countDocuments({
        userId,
        createdAt: { $gte: monthStart }
    });
};

withdrawSchema.statics.getStats = async function() {
    const [total, pending, processing, completed, failed] = await Promise.all([
        this.countDocuments(),
        this.countDocuments({ status: 'pending' }),
        this.countDocuments({ status: 'processing' }),
        this.countDocuments({ status: 'completed' }),
        this.countDocuments({ status: 'failed' })
    ]);

    const totalAmount = await this.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    return {
        total,
        pending,
        processing,
        completed,
        failed,
        totalAmount: totalAmount[0]?.total || 0
    };
};

// ============================================
// TRANSFORM
// ============================================
withdrawSchema.set('toJSON', {
    virtuals: true,
    transform: function(doc, ret) {
        delete ret.__v;
        return ret;
    }
});

module.exports = mongoose.model('Withdraw', withdrawSchema);
