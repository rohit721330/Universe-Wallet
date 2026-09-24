// FILE: models/Referral.js
const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
    // ══════════════════════════════════════════════
    // ✅ Referral PAIR (referrer → referred)
    // ══════════════════════════════════════════════
    referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    referredUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: ['pending', 'completed', 'failed', 'expired'], default: 'pending', index: true },
    bonusAmount: { type: Number, default: 10, min: 0 },
    referrerBonusPaid: { type: Boolean, default: false },
    referredBonusPaid: { type: Boolean, default: false },
    referrerBonusPaidAt: { type: Date, default: null },
    referredBonusPaidAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    notes: { type: String, default: '', trim: true },

    // ══════════════════════════════════════════════
    // ✅ Referral CODE (ownership)
    // ══════════════════════════════════════════════
    referralCode: { type: String, uppercase: true, trim: true },
    codeOwner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    codeStatus: { type: String, enum: ['active', 'inactive'], default: 'active', index: true },
    isCustom: { type: Boolean, default: false },
    usedCount: { type: Number, default: 0, min: 0 },
    replacedBy: { type: String, default: null },
    replacedAt: { type: Date, default: null },

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

// ============================================
// INDEXES
// ============================================

// ✅ Referral pair unique — শুধু যাদের referrerId ও referredUserId দুটোতেই objectId
referralSchema.index(
    { referrerId: 1, referredUserId: 1 },
    {
        unique: true,
        partialFilterExpression: {
            referrerId: { $type: 'objectId' },
            referredUserId: { $type: 'objectId' }
        },
        name: 'unique_referral_pair'
    }
);

// ✅ Code unique — শুধু যাদের referralCode আছে string হিসেবে
referralSchema.index(
    { referralCode: 1 },
    {
        unique: true,
        partialFilterExpression: { referralCode: { $type: 'string' } },
        name: 'code_unique'
    }
);

// ✅ Active code per user — এক user-এর একটাই active code
referralSchema.index(
    { codeOwner: 1, codeStatus: 1 },
    {
        unique: true,
        partialFilterExpression: { codeStatus: 'active', codeOwner: { $type: 'objectId' } },
        name: 'user_active_code_unique'
    }
);

// ✅ Query performance
referralSchema.index({ referrerId: 1, status: 1, createdAt: -1 });
referralSchema.index({ referredUserId: 1 });
referralSchema.index({ status: 1, createdAt: -1 });
referralSchema.index({ codeOwner: 1, createdAt: -1 });

// ============================================
// STATIC: Referral Pair Stats
// ============================================
referralSchema.statics.getStatsForUser = async function(userId) {
    const uid = mongoose.Types.ObjectId(userId);

    const stats = await this.aggregate([
        { $match: { referrerId: uid } },
        {
            $group: {
                _id: null,
                totalReferrals: { $sum: 1 },
                completedReferrals: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
                pendingReferrals: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
                failedReferrals: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
                totalEarned: {
                    $sum: {
                        $cond: [
                            { $and: [{ $eq: ['$status', 'completed'] }, { $eq: ['$referrerBonusPaid', true] }] },
                            '$bonusAmount',
                            0
                        ]
                    }
                },
                totalPendingBonus: {
                    $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$bonusAmount', 0] }
                }
            }
        }
    ]);

    return stats[0] || {
        totalReferrals: 0,
        completedReferrals: 0,
        pendingReferrals: 0,
        failedReferrals: 0,
        totalEarned: 0,
        totalPendingBonus: 0
    };
};

referralSchema.statics.getMonthlyCount = async function(userId) {
    const uid = mongoose.Types.ObjectId(userId);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    return await this.countDocuments({ referrerId: uid, createdAt: { $gte: startOfMonth } });
};

// ============================================
// ✅ STATIC: CODE MANAGEMENT
// ============================================

// এক user-এর active code আনা
referralSchema.statics.getActiveCode = async function(userId) {
    return await this.findOne({
        codeOwner: mongoose.Types.ObjectId(userId),
        codeStatus: 'active'
    }).lean();
};

// Code আছে কি না চেক (any status)
referralSchema.statics.codeExists = async function(code) {
    const exists = await this.findOne({
        referralCode: String(code).toUpperCase().trim()
    }).select('_id').lean();
    return !!exists;
};

// নতুন code তৈরি (old গুলো inactive করে)
referralSchema.statics.createCode = async function(userId, code, isCustom = false) {
    const cleanedCode = String(code).toUpperCase().trim();
    const uid = mongoose.Types.ObjectId(userId);

    // ✅ পুরনো active code গুলো inactive করো
    await this.updateMany(
        { codeOwner: uid, codeStatus: 'active' },
        {
            $set: {
                codeStatus: 'inactive',
                replacedBy: cleanedCode,
                replacedAt: new Date()
            }
        }
    );

    // ✅ নতুন code document তৈরি
    const newCode = new this({
        referralCode: cleanedCode,
        codeOwner: uid,
        codeStatus: 'active',
        isCustom
    });

    return await newCode.save();
};

// Code usage বাড়ানো
referralSchema.statics.incrementUsage = async function(code) {
    return await this.updateOne(
        {
            referralCode: String(code).toUpperCase().trim(),
            codeStatus: 'active'
        },
        { $inc: { usedCount: 1 } }
    );
};

// User-এর সব code history
referralSchema.statics.getUserCodeHistory = async function(userId, limit = 50) {
    return await this.find({
        codeOwner: mongoose.Types.ObjectId(userId)
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('referralCode codeStatus isCustom usedCount createdAt replacedBy replacedAt')
    .lean();
};

// ============================================
// ✅ STATIC: Check if code belongs to user
// ============================================
referralSchema.statics.isUserCode = async function(userId, code) {
    const found = await this.findOne({
        codeOwner: mongoose.Types.ObjectId(userId),
        referralCode: String(code).toUpperCase().trim()
    }).select('_id').lean();
    return !!found;
};

module.exports = mongoose.model('Referral', referralSchema);
