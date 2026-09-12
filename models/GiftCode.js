// FILE: models/GiftCode.js
const mongoose = require('mongoose');

const giftCodeSchema = new mongoose.Schema({
    code: { type: String, unique: true, required: true, uppercase: true },
    amount: { type: Number, required: true, min: 0.01 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    
    // ✅ NEW: Multi-user support
    maxUsers: { type: Number, default: 1, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    usedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    
    // Legacy fields (for backward compatibility)
    isUsed: { type: Boolean, default: false },
    redeemedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    redeemedAt: { type: Date, default: null },
    
    note: { type: String, maxlength: 200, default: '' },
    createdAt: { type: Date, default: Date.now }
});

// ============================================
// INDEXES
// ============================================
giftCodeSchema.index({ isUsed: 1 });
giftCodeSchema.index({ createdBy: 1 });
giftCodeSchema.index({ code: 1, isUsed: 1 });
giftCodeSchema.index({ usedBy: 1 });

// ============================================
// VIRTUALS
// ============================================
giftCodeSchema.virtual('isActive').get(function() {
    return this.usedCount < this.maxUsers;
});

giftCodeSchema.virtual('isFullyUsed').get(function() {
    return this.usedCount >= this.maxUsers;
});

giftCodeSchema.virtual('remainingSlots').get(function() {
    return Math.max(0, this.maxUsers - this.usedCount);
});

giftCodeSchema.virtual('formattedAmount').get(function() {
    return `₹${this.amount.toFixed(2)}`;
});

giftCodeSchema.virtual('statusLabel').get(function() {
    if (this.usedCount >= this.maxUsers) return 'Used';
    if (this.usedCount > 0) return 'Partially Used';
    return 'Active';
});

// ============================================
// METHODS
// ============================================
giftCodeSchema.methods.isValid = function() {
    return this.usedCount < this.maxUsers;
};

giftCodeSchema.methods.canUserRedeem = function(userId) {
    // Check if user already redeemed
    if (this.usedBy && this.usedBy.some(id => id.toString() === userId.toString())) {
        return false;
    }
    return this.usedCount < this.maxUsers;
};

giftCodeSchema.methods.use = async function(userId) {
    // Check slots available
    if (this.usedCount >= this.maxUsers) {
        throw new Error('Gift code has reached maximum usage limit');
    }
    
    // Check if user already used
    if (this.usedBy && this.usedBy.some(id => id.toString() === userId.toString())) {
        throw new Error('You have already redeemed this gift code');
    }
    
    // Add user to usedBy array
    this.usedBy = this.usedBy || [];
    this.usedBy.push(userId);
    this.usedCount = (this.usedCount || 0) + 1;
    
    // Update legacy fields
    if (this.usedCount === 1) {
        this.redeemedBy = userId;
        this.redeemedAt = new Date();
    }
    
    // Mark as fully used if reached limit
    if (this.usedCount >= this.maxUsers) {
        this.isUsed = true;
    }
    
    await this.save();
    return this;
};

// ============================================
// STATIC METHODS
// ============================================
giftCodeSchema.statics.findAvailable = function() {
    return this.find({ isUsed: false });
};

giftCodeSchema.statics.findUsed = function() {
    return this.find({ isUsed: true });
};

giftCodeSchema.statics.findByCode = function(code) {
    return this.findOne({ code: code.toUpperCase() });
};

giftCodeSchema.statics.checkCodeExists = async function(code) {
    const existing = await this.findOne({ code: code.toUpperCase() });
    return !!existing;
};

giftCodeSchema.statics.getUserCreatedCodes = function(userId) {
    return this.find({ createdBy: userId }).sort({ createdAt: -1 });
};

giftCodeSchema.statics.getUserRedeemedCodes = function(userId) {
    return this.find({ usedBy: userId }).sort({ redeemedAt: -1 });
};

giftCodeSchema.statics.getStats = async function() {
    const [total, used, available] = await Promise.all([
        this.countDocuments(),
        this.countDocuments({ isUsed: true }),
        this.countDocuments({ isUsed: false })
    ]);

    const totalAmount = await this.aggregate([
        { $match: { isUsed: true } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    return {
        total,
        used,
        available,
        totalRedeemedAmount: totalAmount[0]?.total || 0
    };
};

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================
giftCodeSchema.pre('save', function(next) {
    if (this.code) {
        this.code = this.code.toUpperCase().trim();
    }
    
    // Auto-set isUsed based on usedCount
    if (this.usedCount >= this.maxUsers) {
        this.isUsed = true;
    }
    
    next();
});

// ============================================
// TRANSFORM
// ============================================
giftCodeSchema.set('toJSON', {
    virtuals: true,
    transform: function(doc, ret) {
        delete ret.__v;
        return ret;
    }
});

module.exports = mongoose.model('GiftCode', giftCodeSchema);
