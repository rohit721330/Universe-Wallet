// FILE: models/GiftCode.js
const mongoose = require('mongoose');

const giftCodeSchema = new mongoose.Schema({
    code: { type: String, unique: true, required: true, uppercase: true },
    amount: { type: Number, required: true, min: 0.01 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isUsed: { type: Boolean, default: false },
    redeemedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    redeemedAt: { type: Date, default: null },
    note: { type: String, maxlength: 200, default: '' },
    createdAt: { type: Date, default: Date.now }
});

// ============================================
// INDEXES FOR BETTER PERFORMANCE
// ============================================
giftCodeSchema.index({ isUsed: 1 });
giftCodeSchema.index({ createdBy: 1 });
giftCodeSchema.index({ redeemedBy: 1 });
giftCodeSchema.index({ code: 1, isUsed: 1 });

// ============================================
// VIRTUALS
// ============================================
giftCodeSchema.virtual('isActive').get(function() {
    return !this.isUsed;
});

giftCodeSchema.virtual('formattedAmount').get(function() {
    return `₹${this.amount.toFixed(2)}`;
});

giftCodeSchema.virtual('statusLabel').get(function() {
    return this.isUsed ? 'Used' : 'Active';
});

// ============================================
// METHODS
// ============================================
giftCodeSchema.methods.isValid = function() {
    return !this.isUsed;
};

giftCodeSchema.methods.use = async function(userId) {
    if (this.isUsed) {
        throw new Error('Gift code already used');
    }
    this.isUsed = true;
    this.redeemedBy = userId;
    this.redeemedAt = new Date();
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
    return this.find({ redeemedBy: userId }).sort({ redeemedAt: -1 });
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
