// FILE: models/Referral.js
const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
    referrerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    referredUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    referralCode: { type: String, required: true, uppercase: true, trim: true, index: true },
    status: { type: String, required: true, enum: ['pending', 'completed', 'failed', 'expired'], default: 'pending', index: true },
    bonusAmount: { type: Number, default: 10, min: 0 },
    referrerBonusPaid: { type: Boolean, default: false },
    referredBonusPaid: { type: Boolean, default: false },
    referrerBonusPaidAt: { type: Date, default: null },
    referredBonusPaidAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    notes: { type: String, default: '', trim: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

// ============================================
// INDEXES
// ============================================
// একই user একবারই refer করতে পারবে
referralSchema.index(
    { referrerId: 1, referredUserId: 1 },
    { unique: true, name: 'unique_referral_pair' }
);

// Query performance
referralSchema.index({ referrerId: 1, status: 1, createdAt: -1 });
referralSchema.index({ referredUserId: 1 });
referralSchema.index({ status: 1, createdAt: -1 });

// ============================================
// STATIC: Referral Pair Stats
// ============================================
referralSchema.statics.getStatsForUser = async function(userId) {
    const uid = new mongoose.Types.ObjectId(userId);

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

// ============================================
// STATIC: Monthly Count
// ============================================
referralSchema.statics.getMonthlyCount = async function(userId) {
    const uid = new mongoose.Types.ObjectId(userId);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    return await this.countDocuments({ referrerId: uid, createdAt: { $gte: startOfMonth } });
};

module.exports = mongoose.model('Referral', referralSchema);
