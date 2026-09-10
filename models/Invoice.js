// FILE: models/Invoice.js
const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
    invoiceId: { type: String, required: true, unique: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    status: {
        type: String,
        enum: ['pending', 'paid', 'expired', 'cancelled'],
        default: 'pending',
        index: true
    },
    paymentRef: { type: String, default: null },
    expiresAt: { type: Date, required: true, index: true },
    paidAt: { type: Date },
    verifiedAt: { type: Date },
    notes: { type: String, default: '' },
    metadata: {
        senderMobile: String,
        senderName: String,
        senderWalletId: String,
        receiverMobile: String,
        receiverName: String,
        receiverWalletId: String,
        source: { type: String, enum: ['web', 'mobile', 'telegram', 'api'], default: 'web' },
        webhook: { type: String, default: null },
        txt_id: { type: String, default: null },
        expire_after: { type: Number, default: 30 },
        apiKey: { type: String, default: null },
        transactionId: { type: String, default: null }
    }
}, { timestamps: true });

// ============================================
// INDEXES
// ============================================
invoiceSchema.index({ invoiceId: 1, status: 1 });
invoiceSchema.index({ senderId: 1, createdAt: -1 });
invoiceSchema.index({ userId: 1, createdAt: -1 });
invoiceSchema.index({ status: 1, expiresAt: 1 });
// ❌ paymentRef index সম্পূর্ণ সরানো হয়েছে — কোনো দরকার নেই

// ============================================
// PRE-SAVE: Generate Invoice ID & Expires At
// ============================================
invoiceSchema.pre('save', function(next) {
    if (!this.invoiceId) {
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        this.invoiceId = `INV${timestamp}${random}`;
    }
    if (!this.expiresAt) {
        this.expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    }
    next();
});

// ============================================
// METHODS
// ============================================
invoiceSchema.methods.isExpired = function() {
    return new Date() > this.expiresAt;
};

invoiceSchema.methods.canBePaid = function() {
    return this.status === 'pending' && !this.isExpired();
};

invoiceSchema.methods.markAsPaid = async function() {
    this.status = 'paid';
    this.paidAt = new Date();
    this.verifiedAt = new Date();
    await this.save();
    return this;
};

invoiceSchema.methods.markAsExpired = async function() {
    if (this.status === 'pending') {
        this.status = 'expired';
        await this.save();
    }
    return this;
};

invoiceSchema.methods.markAsCancelled = async function(reason = '') {
    this.status = 'cancelled';
    this.notes = reason || 'Cancelled By User';
    await this.save();
    return this;
};

invoiceSchema.methods.getRemainingTime = function() {
    const now = new Date();
    const diff = this.expiresAt - now;
    return Math.max(0, Math.floor(diff / 1000));
};

invoiceSchema.methods.getFormattedRemainingTime = function() {
    const seconds = this.getRemainingTime();
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

// ============================================
// STATIC METHODS
// ============================================
invoiceSchema.statics.createInvoice = async function(senderId, receiverId, amount, note = '', metadata = {}) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    const invoiceId = `INV${timestamp}${random}`;

    const invoice = new this({
        invoiceId: invoiceId,
        senderId: senderId,
        userId: receiverId,
        amount: amount,
        notes: note || 'Payment Request',
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        metadata: {
            ...metadata,
            source: metadata.source || 'web'
        }
    });
    await invoice.save();
    return invoice;
};

invoiceSchema.statics.createPublicInvoice = async function(userId, adminId, amount, metadata = {}) {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    const invoiceId = `INV${timestamp}${random}`;

    const expireMinutes = metadata.expire_after || 30;
    const expiresAt = new Date(Date.now() + expireMinutes * 60 * 1000);

    const invoice = new this({
        invoiceId: invoiceId,
        senderId: adminId,
        userId: userId,
        amount: amount,
        notes: metadata.remark || 'API Generated Invoice',
        expiresAt: expiresAt,
        status: 'pending',
        metadata: {
            ...metadata,
            source: 'api',
            expire_after: expireMinutes
        }
    });
    await invoice.save();
    return invoice;
};

invoiceSchema.statics.findByInvoiceId = function(invoiceId) {
    return this.findOne({ invoiceId });
};

invoiceSchema.statics.getUserInvoices = function(userId, limit = 20, skip = 0) {
    return this.find({
        $or: [
            { senderId: userId },
            { userId: userId }
        ]
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

invoiceSchema.statics.cleanupExpired = async function() {
    const result = await this.updateMany(
        {
            status: 'pending',
            expiresAt: { $lt: new Date() }
        },
        {
            $set: { status: 'expired' }
        }
    );
    return result;
};

invoiceSchema.statics.getStats = async function() {
    const [total, pending, paid, expired] = await Promise.all([
        this.countDocuments(),
        this.countDocuments({ status: 'pending', expiresAt: { $gt: new Date() } }),
        this.countDocuments({ status: 'paid' }),
        this.countDocuments({ status: 'expired' })
    ]);
    
    const totalAmount = await this.aggregate([
        { $match: { status: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    return {
        total,
        pending,
        paid,
        expired,
        totalAmount: totalAmount[0]?.total || 0
    };
};

// ============================================
// VIRTUALS
// ============================================
invoiceSchema.virtual('isActive').get(function() {
    return this.status === 'pending' && !this.isExpired();
});

invoiceSchema.virtual('isCompleted').get(function() {
    return this.status === 'paid' || this.status === 'cancelled';
});

invoiceSchema.virtual('formattedAmount').get(function() {
    return `₹${this.amount.toFixed(2)}`;
});

invoiceSchema.virtual('statusLabel').get(function() {
    const labels = {
        'pending': 'Pending',
        'paid': 'Paid',
        'expired': 'Expired',
        'cancelled': 'Cancelled'
    };
    return labels[this.status] || this.status;
});

// ============================================
// TRANSFORM
// ============================================
invoiceSchema.set('toJSON', {
    virtuals: true,
    transform: function(doc, ret) {
        delete ret.__v;
        ret.remainingTime = doc.getRemainingTime();
        ret.formattedRemainingTime = doc.getFormattedRemainingTime();
        ret.isExpired = doc.isExpired();
        ret.canBePaid = doc.canBePaid();
        return ret;
    }
});

module.exports = mongoose.model('Invoice', invoiceSchema);
