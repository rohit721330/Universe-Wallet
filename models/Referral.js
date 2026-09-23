// FILE: models/ReferralCode.js
const mongoose = require('mongoose');

const referralCodeSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    code: { type: String, required: true, uppercase: true, trim: true, unique: true, index: true },
    isCustom: { type: Boolean, default: false },
    status: { type: String, enum: ['active', 'inactive', 'expired'], default: 'active', index: true },
    replacedBy: { type: String, default: null },
    replacedAt: { type: Date, default: null },
    usedCount: { type: Number, default: 0, min: 0 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

// ✅ এক user-এর একটাই active code থাকবে
referralCodeSchema.index(
    { userId: 1, status: 1 },
    {
        unique: true,
        partialFilterExpression: { status: 'active' },
        name: 'user_active_code_unique'
    }
);

// ✅ Code সবসময় unique
referralCodeSchema.index({ code: 1 }, { unique: true, name: 'code_unique' });

// ============================================
// STATIC METHODS
// ============================================
referralCodeSchema.statics.getActiveCode = async function(userId) {
    return await this.findOne({ userId, status: 'active' }).lean();
};

referralCodeSchema.statics.deactivateAllForUser = async function(userId, replacedBy = null) {
    return await this.updateMany(
        { userId, status: 'active' },
        { $set: { status: 'inactive', replacedBy, replacedAt: new Date() } }
    );
};

referralCodeSchema.statics.createCode = async function(userId, code, isCustom = false) {
    await this.deactivateAllForUser(userId, code.toUpperCase().trim());
    const newCode = new this({
        userId,
        code: code.toUpperCase().trim(),
        isCustom,
        status: 'active'
    });
    return await newCode.save();
};

referralCodeSchema.statics.codeExists = async function(code) {
    const exists = await this.findOne({ code: code.toUpperCase().trim() }).select('_id').lean();
    return !!exists;
};

referralCodeSchema.statics.incrementUsage = async function(code) {
    return await this.updateOne(
        { code: code.toUpperCase().trim(), status: 'active' },
        { $inc: { usedCount: 1 } }
    );
};

module.exports = mongoose.model('ReferralCode', referralCodeSchema);
