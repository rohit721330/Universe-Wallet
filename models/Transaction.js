// FILE: models/Transaction.js
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    tx_id: { type: String, required: true, trim: true, index: true },
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sender_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    receiver_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    amount: { type: Number, required: true, min: 0 },
    fee: { type: Number, default: 0, min: 0 },
    type: {
        type: String,
        required: true,
        enum: [
            'deposit',
            'withdraw',
            'transfer', 'transfer_send', 'transfer_receive',
            'lifafa_creation', 'lifafa_claim', 'lifafa_referral',
            'game_win', 'game_loss',
            'gift',
            'admin_add', 'admin_deduct',
            'api', 'api_send', 'api_receive',
            'invoice_pay',
            'invoice_pay_send',
            'invoice_pay_receive'
        ],
        index: true
    },
    status: {
        type: String,
        required: true,
        enum: ['pending', 'success', 'failed', 'cancelled', 'expired'],
        default: 'pending',
        index: true
    },
    remark: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },
    tx_time: { type: Date, default: Date.now, index: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// ============================================
// INDEXES FOR BETTER PERFORMANCE
// ============================================

// ✅ CRITICAL: Compound unique index
// একই user-এর under-এ tx_id unique — sender এবং receiver আলাদা user, তাই conflict হবে না
transactionSchema.index({ tx_id: 1, user_id: 1 }, { unique: true });

// Regular performance indexes
transactionSchema.index({ user_id: 1, tx_time: -1 });
transactionSchema.index({ sender_id: 1, tx_time: -1 });
transactionSchema.index({ receiver_id: 1, tx_time: -1 });
transactionSchema.index({ type: 1, status: 1 });

// ============================================
// VIRTUAL: Formatted Amount
// ============================================
transactionSchema.virtual('formattedAmount').get(function() {
    return `₹${this.amount.toFixed(2)}`;
});

// ============================================
// VIRTUAL: Type Label
// ============================================
transactionSchema.virtual('typeLabel').get(function() {
    const labels = {
        'deposit': 'Deposit',
        'withdraw': 'Withdrawal',
        'transfer': 'Transfer',
        'transfer_send': 'Transfer Sent',
        'transfer_receive': 'Transfer Received',
        'lifafa_creation': 'Lifafa Creation',
        'lifafa_claim': 'Lifafa Claim',
        'lifafa_referral': 'Lifafa Referral',
        'game_win': 'Game Win',
        'game_loss': 'Game Loss',
        'gift': 'Gift',
        'admin_add': 'Admin Add',
        'admin_deduct': 'Admin Deduct',
        'api': 'API Transaction',
        'api_send': 'API Payment Sent',
        'api_receive': 'API Payment Received',
        'invoice_pay': 'Invoice Payment',
        'invoice_pay_send': 'Invoice Payment Sent',
        'invoice_pay_receive': 'Invoice Payment Received'
    };
    return labels[this.type] || this.type;
});

// ============================================
// VIRTUAL: Direction
// ============================================
transactionSchema.virtual('direction').get(function() {
    if (this.sender_id && this.receiver_id) {
        if (this.sender_id.toString() === this.user_id.toString()) {
            return 'sent';
        }
        if (this.receiver_id.toString() === this.user_id.toString()) {
            return 'received';
        }
    }
    if (this.type === 'lifafa_creation' ||
        this.type === 'admin_deduct' ||
        this.type === 'game_loss' ||
        this.type === 'api_send' ||
        this.type === 'invoice_pay_send') {
        return 'sent';
    }
    if (this.type === 'lifafa_claim' ||
        this.type === 'lifafa_referral' ||
        this.type === 'admin_add' ||
        this.type === 'game_win' ||
        this.type === 'deposit' ||
        this.type === 'api_receive' ||
        this.type === 'invoice_pay_receive') {
        return 'received';
    }
    return 'unknown';
});

// ============================================
// METHOD: isDebit
// ============================================
transactionSchema.methods.isDebit = function(userId) {
    if (!userId) return false;
    if (this.sender_id && this.sender_id.toString() === userId.toString()) {
        return true;
    }
    const debitTypes = ['lifafa_creation', 'admin_deduct', 'game_loss', 'api_send', 'invoice_pay_send'];
    return debitTypes.includes(this.type);
};

// ============================================
// METHOD: isCredit
// ============================================
transactionSchema.methods.isCredit = function(userId) {
    if (!userId) return false;
    if (this.receiver_id && this.receiver_id.toString() === userId.toString()) {
        return true;
    }
    const creditTypes = ['lifafa_claim', 'lifafa_referral', 'admin_add', 'game_win',
                         'deposit', 'api_receive',
                         'invoice_pay_receive'];
    return creditTypes.includes(this.type);
};

// ============================================
// METHOD: getSummary
// ============================================
transactionSchema.methods.getSummary = function() {
    return {
        id: this._id,
        tx_id: this.tx_id,
        amount: this.amount,
        formattedAmount: this.formattedAmount,
        type: this.type,
        typeLabel: this.typeLabel,
        status: this.status,
        remark: this.remark,
        description: this.description,
        tx_time: this.tx_time,
        createdAt: this.createdAt
    };
};

// ============================================
// STATIC: Get User Summary
// ============================================
transactionSchema.statics.getUserSummary = async function(userId) {
    const result = await this.aggregate([
        {
            $match: {
                $or: [
                    { user_id: mongoose.Types.ObjectId(userId) },
                    { sender_id: mongoose.Types.ObjectId(userId) },
                    { receiver_id: mongoose.Types.ObjectId(userId) }
                ],
                status: 'success'
            }
        },
        {
            $group: {
                _id: null,
                totalTransactions: { $sum: 1 },
                totalAmount: { $sum: '$amount' },
                totalDebit: {
                    $sum: {
                        $cond: [
                            { $or: [
                                { $eq: ['$type', 'lifafa_creation'] },
                                { $eq: ['$type', 'admin_deduct'] },
                                { $eq: ['$type', 'game_loss'] },
                                { $eq: ['$type', 'api_send'] },
                                { $eq: ['$type', 'invoice_pay_send'] },
                                { $eq: ['$sender_id', mongoose.Types.ObjectId(userId)] }
                            ]},
                            '$amount',
                            0
                        ]
                    }
                },
                totalCredit: {
                    $sum: {
                        $cond: [
                            { $or: [
                                { $eq: ['$type', 'lifafa_claim'] },
                                { $eq: ['$type', 'lifafa_referral'] },
                                { $eq: ['$type', 'admin_add'] },
                                { $eq: ['$type', 'game_win'] },
                                { $eq: ['$type', 'deposit'] },
                                { $eq: ['$type', 'api_receive'] },
                                { $eq: ['$type', 'invoice_pay_receive'] },
                                { $eq: ['$receiver_id', mongoose.Types.ObjectId(userId)] }
                            ]},
                            '$amount',
                            0
                        ]
                    }
                }
            }
        }
    ]);

    return result[0] || {
        totalTransactions: 0,
        totalAmount: 0,
        totalDebit: 0,
        totalCredit: 0
    };
};

// ============================================
// STATIC: Get Daily Summary
// ============================================
transactionSchema.statics.getDailySummary = async function(date) {
    const startDate = new Date(date);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(date);
    endDate.setHours(23, 59, 59, 999);

    const result = await this.aggregate([
        {
            $match: {
                tx_time: { $gte: startDate, $lte: endDate },
                status: 'success'
            }
        },
        {
            $group: {
                _id: '$type',
                count: { $sum: 1 },
                totalAmount: { $sum: '$amount' }
            }
        },
        {
            $group: {
                _id: null,
                types: {
                    $push: {
                        type: '$_id',
                        count: '$count',
                        totalAmount: '$totalAmount'
                    }
                },
                totalTransactions: { $sum: '$count' },
                totalAmount: { $sum: '$totalAmount' }
            }
        }
    ]);

    return result[0] || {
        types: [],
        totalTransactions: 0,
        totalAmount: 0
    };
};

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================
transactionSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    if (!this.tx_time) {
        this.tx_time = new Date();
    }
    next();
});

// ============================================
// PRE-VALIDATE
// ============================================
transactionSchema.pre('validate', function(next) {
    if (!this.tx_id) {
        this.tx_id = 'TXN' + Date.now() + Math.floor(Math.random() * 99999);
    }
    next();
});

// ============================================
// TRANSFORM: Remove sensitive fields
// ============================================
transactionSchema.set('toJSON', {
    virtuals: true,
    transform: function(doc, ret) {
        delete ret.__v;
        return ret;
    }
});

// ============================================
// CREATE MODEL
// ============================================
const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;
