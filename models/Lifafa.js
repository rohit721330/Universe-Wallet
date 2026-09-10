// FILE: models/Lifafa.js
const Mongoose = require('mongoose');

const LifafaSchema = new Mongoose.Schema({
    lifafaId: { type: String, required: true, unique: true },
    userId: { type: Mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: ['normal', 'dice', 'toss', 'scratch'], default: 'normal' },
    winChance: { 
        type: Number, 
        min: 0, 
        max: 100, 
        default: null, 
        validate: { 
            validator: function(v) { 
                if (this.type === 'normal') return v === null || v === undefined; 
                return v !== null && v !== undefined && v >= 0 && v <= 100; 
            }, 
            message: 'Win chance is required for dice, toss, and scratch types' 
        } 
    },
    totalUsers: { type: Number, required: true, min: 1 },
    perUser: { type: Number, required: true, min: 0.01 },
    totalAmount: { type: Number, required: true, min: 0 },
    comment: { type: String, trim: true, default: '' },
    redirectLink: { type: String, trim: true, default: '' },
    accessCode: { type: String, trim: true, default: null },
    specialUsers: { type: String, trim: true, default: null },
    channels: { type: [String], default: [] },
    referAmount: { type: Number, default: 0, min: 0 },
    referComment: { type: String, trim: true, default: '' },
    youtubeVideo: { type: String, trim: true, default: '' },
    requireRefer: { type: Boolean, default: false },
    requireVerify: { type: Boolean, default: true },
    requireYoutube: { type: Boolean, default: false },
    requireChannel: { type: Boolean, default: false },
    requireType: { type: Boolean, default: true },
    status: { type: String, enum: ['active', 'completed', 'expired', 'cancelled'], default: 'active' },
    claimedUsers: [{
        userId: { type: Mongoose.Schema.Types.ObjectId, ref: 'User' },
        telegramId: { type: String, trim: true },
        mobile: { type: String, trim: true },
        fingerprint: { type: String, trim: true },
        claimedAt: { type: Date, default: Date.now },
        referrerId: { type: Mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        winAmount: { type: Number, default: 0 },
        isWinner: { type: Boolean, default: false }
    }],
    remainingUsers: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    channelPermissions: { 
        type: [{ 
            channel: { type: String }, 
            hasInvitePermission: { type: Boolean, default: false }, 
            checkedAt: { type: Date, default: Date.now }, 
            error: { type: String, default: null } 
        }], 
        default: [] 
    },
    allChannelsHavePermission: { type: Boolean, default: false },
    isExpired: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null }
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

// ============================================
// INDEXES FOR BETTER PERFORMANCE
// ============================================
LifafaSchema.index({ userId: 1, createdAt: -1 });
LifafaSchema.index({ status: 1 });
LifafaSchema.index({ 'claimedUsers.telegramId': 1 });
LifafaSchema.index({ 'claimedUsers.fingerprint': 1 });
LifafaSchema.index({ type: 1, winChance: 1 });

// ============================================
// VIRTUALS
// ============================================
LifafaSchema.virtual('claimPercentage').get(function() { 
    if (this.totalUsers === 0) return 0; 
    return (this.claimedUsers.length / this.totalUsers) * 100; 
});

LifafaSchema.virtual('formattedTotalAmount').get(function() {
    return `₹${this.totalAmount.toFixed(2)}`;
});

LifafaSchema.virtual('formattedPerUser').get(function() {
    return `₹${this.perUser.toFixed(2)}`;
});

LifafaSchema.virtual('statusLabel').get(function() {
    const labels = {
        'active': 'Active',
        'completed': 'Completed',
        'expired': 'Expired',
        'cancelled': 'Cancelled'
    };
    return labels[this.status] || this.status;
});

LifafaSchema.virtual('typeLabel').get(function() {
    const labels = {
        'normal': 'Normal',
        'dice': 'Dice',
        'toss': 'Toss',
        'scratch': 'Scratch'
    };
    return labels[this.type] || this.type;
});

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================
LifafaSchema.pre('save', function(Next) {
    this.remainingUsers = this.totalUsers - this.claimedUsers.length;
    if (this.remainingUsers <= 0 && this.status === 'active') this.status = 'completed';
    if (this.expiresAt && this.expiresAt < new Date()) { 
        this.isExpired = true; 
        if (this.status === 'active') this.status = 'expired'; 
    }
    Next();
});

// ============================================
// STATIC METHODS
// ============================================
LifafaSchema.statics.findActive = function() { 
    return this.find({ status: 'active', remainingUsers: { $gt: 0 }, isExpired: false }); 
};

LifafaSchema.statics.findByLifafaId = function(lifafaId) {
    return this.findOne({ lifafaId: lifafaId });
};

LifafaSchema.statics.getUserLifafas = function(userId, limit = 50, skip = 0) {
    return this.find({ userId: userId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);
};

LifafaSchema.statics.getPendingCount = async function(userId) {
    return this.countDocuments({
        userId: userId,
        status: 'active'
    });
};

LifafaSchema.statics.cleanupExpired = async function() {
    const result = await this.updateMany(
        {
            status: 'active',
            expiresAt: { $lt: new Date() }
        },
        {
            $set: { status: 'expired', isExpired: true }
        }
    );
    return result;
};

LifafaSchema.statics.getStats = async function() {
    const [total, active, completed, expired, cancelled] = await Promise.all([
        this.countDocuments(),
        this.countDocuments({ status: 'active' }),
        this.countDocuments({ status: 'completed' }),
        this.countDocuments({ status: 'expired' }),
        this.countDocuments({ status: 'cancelled' })
    ]);

    const totalAmount = await this.aggregate([
        { $match: { status: { $in: ['active', 'completed'] } } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);

    return {
        total,
        active,
        completed,
        expired,
        cancelled,
        totalAmount: totalAmount[0]?.total || 0
    };
};

// ============================================
// METHODS
// ============================================
LifafaSchema.methods.canClaim = function(UserId, TelegramId, AccessCode, Fingerprint) {
    if (this.status !== 'active') return { canClaim: false, reason: 'Lifafa Is Not Active' };
    if (this.remainingUsers <= 0) return { canClaim: false, reason: 'All Users Have Already Claimed' };
    if (this.isExpired) return { canClaim: false, reason: 'Lifafa Has Expired' };
    if (this.accessCode && this.accessCode !== AccessCode) return { canClaim: false, reason: 'Invalid Access Code' };
    if (Fingerprint && this.claimedUsers.some(c => c.fingerprint === Fingerprint)) return { canClaim: false, reason: 'This Device Has Already Claimed' };
    if (this.requireChannel && this.channels.length > 0 && !this.allChannelsHavePermission) return { canClaim: false, reason: 'Bot Does Not Have Invite Permission In All Channels' };
    const AlreadyClaimed = this.claimedUsers.some(C => C.userId?.toString() === UserId?.toString() || C.telegramId === TelegramId);
    if (AlreadyClaimed) return { canClaim: false, reason: 'You Have Already Claimed This Lifafa' };
    return { canClaim: true };
};

LifafaSchema.methods.addClaim = async function(UserId, TelegramId, Mobile, Fingerprint, ReferrerId, WinAmount = 0, IsWinner = false) {
    if (this.claimedUsers.some(C => C.userId?.toString() === UserId?.toString() || C.telegramId === TelegramId)) 
        throw new Error('User already claimed this lifafa');
    if (Fingerprint && this.claimedUsers.some(c => c.fingerprint === Fingerprint)) 
        throw new Error('This device has already claimed this lifafa');
    this.claimedUsers.push({ 
        userId: UserId, 
        telegramId: TelegramId, 
        mobile: Mobile, 
        fingerprint: Fingerprint || null, 
        referrerId: ReferrerId || null, 
        claimedAt: new Date(), 
        winAmount: WinAmount, 
        isWinner: IsWinner 
    });
    this.remainingUsers = this.totalUsers - this.claimedUsers.length;
    if (this.remainingUsers <= 0) this.status = 'completed';
    await this.save();
    return this;
};

LifafaSchema.methods.markAsExpired = async function() {
    if (this.status === 'active') {
        this.status = 'expired';
        this.isExpired = true;
        await this.save();
    }
    return this;
};

LifafaSchema.methods.markAsCancelled = async function(reason = '') {
    this.status = 'cancelled';
    if (reason) this.comment = reason;
    await this.save();
    return this;
};

// ============================================
// TRANSFORM
// ============================================
LifafaSchema.set('toJSON', {
    virtuals: true,
    transform: function(doc, ret) {
        delete ret.__v;
        return ret;
    }
});

module.exports = Mongoose.model('Lifafa', LifafaSchema);
