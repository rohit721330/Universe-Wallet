// FILE: models/Deposit.js
const mongoose = require('mongoose');

const depositSchema = new mongoose.Schema({
    depositId: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 1, max: 5000 },
    upiId: { type: String, required: true, default: 'admin@upi' },
    qrData: { type: String, default: null },
    status: {
        type: String,
        enum: ['pending', 'pending_approval', 'approved', 'rejected', 'cancelled'],
        default: 'pending',
        index: true
    },
    transactionRef: { type: String, default: null, sparse: true },
    verifiedAt: { type: Date, default: null },
    approvedBy: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    rejectedBy: { type: String, default: null },
    rejectedAt: { type: Date, default: null },
    adminNote: { type: String, default: '' },
    expiresAt: { type: Date, required: true, index: true },
    metadata: {
        ipAddress: String,
        userAgent: String,
        deviceId: String
    }
}, { timestamps: true });

// ============================================
// PRE-SAVE MIDDLEWARE: Generate Deposit ID with "PAY_" prefix
// ============================================
depositSchema.pre('save', function(next) {
    if (!this.depositId) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        this.depositId = `PAY_${timestamp}_${random}`;
    }

    if (!this.expiresAt) {
        // ✅ 30 MINUTES expiry
        this.expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    }

    next();
});

// ============================================
// PRE-VALIDATE MIDDLEWARE: Ensure depositId exists
// ============================================
depositSchema.pre('validate', function(next) {
    if (!this.depositId) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        this.depositId = `PAY_${timestamp}_${random}`;
    }
    next();
});

// ============================================
// METHODS
// ============================================
depositSchema.methods.isExpired = function() {
    return new Date() > this.expiresAt;
};

depositSchema.methods.canBeApproved = function() {
    return (this.status === 'pending' || this.status === 'pending_approval') && !this.isExpired();
};

depositSchema.methods.canBeRejected = function() {
    return this.status === 'pending' || this.status === 'pending_approval' || this.status === 'approved';
};

depositSchema.methods.approve = async function(adminId, note = '') {
    this.status = 'approved';
    this.approvedBy = adminId || null;
    this.approvedAt = new Date();
    if (note) this.adminNote = note;
    await this.save();
    return this;
};

depositSchema.methods.reject = async function(adminId, reason = '') {
    this.status = 'rejected';
    this.rejectedBy = adminId || null;
    this.rejectedAt = new Date();
    if (reason) this.adminNote = reason;
    await this.save();
    return this;
};

// ============================================
// STATIC METHODS
// ============================================
depositSchema.statics.findByDepositId = function(depositId) {
    return this.findOne({ depositId });
};

depositSchema.statics.getUserDeposits = function(userId, limit = 50, skip = 0) {
    return this.find({ userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
};

depositSchema.statics.getPendingCount = async function(userId) {
    return this.countDocuments({
        userId,
        status: 'pending',
        expiresAt: { $gt: new Date() }
    });
};

depositSchema.statics.getPendingDeposits = function(limit = 100, skip = 0) {
    return this.find({
        status: { $in: ['pending', 'pending_approval'] },
        expiresAt: { $gt: new Date() }
    })
    .populate('userId', 'username email balance')
    .sort({ createdAt: 1 })
    .skip(skip)
    .limit(limit);
};

depositSchema.statics.cleanupExpired = async function() {
    const result = await this.updateMany(
        {
            status: { $in: ['pending', 'pending_approval'] },
            expiresAt: { $lt: new Date() }
        },
        {
            $set: { status: 'cancelled' }
        }
    );
    return result;
};

// ============================================
// STATIC: Force expire old pending deposits (B1)
// 30 মিনিটের বেশি পুরোনো → cancel
// 30 মিনিটের কম পুরোনো → expiry adjust
// ============================================
depositSchema.statics.forceExpireOldPending = async function() {
    const now = Date.now();
    const thirtyMinAgo = new Date(now - 30 * 60 * 1000);

    // Step 1: 30 মিনিটের বেশি পুরোনো pending → cancelled
    const cancelledResult = await this.updateMany(
        {
            status: 'pending',
            createdAt: { $lt: thirtyMinAgo }
        },
        {
            $set: { status: 'cancelled' }
        }
    );

    // Step 2: 30 মিনিটের কম পুরোনো pending → expiresAt = createdAt + 30 min
    const pendingDeposits = await this.find({
        status: 'pending',
        createdAt: { $gte: thirtyMinAgo }
    });

    let updatedCount = 0;
    for (const deposit of pendingDeposits) {
        const newExpiry = new Date(deposit.createdAt.getTime() + 30 * 60 * 1000);
        if (newExpiry < deposit.expiresAt) {
            deposit.expiresAt = newExpiry;
            await deposit.save();
            updatedCount++;
        }
    }

    return {
        cancelled: cancelledResult.modifiedCount,
        updated: updatedCount
    };
};

// ============================================
// INDEXES
// ============================================
depositSchema.index({ depositId: 1, status: 1 });
depositSchema.index({ userId: 1, createdAt: -1 });
depositSchema.index({ status: 1, createdAt: 1 });
depositSchema.index({ approvedBy: 1, approvedAt: -1 });

module.exports = mongoose.model('Deposit', depositSchema);
