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

giftCodeSchema.index({ isUsed: 1 });
giftCodeSchema.index({ createdBy: 1 });
giftCodeSchema.index({ redeemedBy: 1 });

giftCodeSchema.virtual('isActive').get(function() {
    return !this.isUsed;
});

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

giftCodeSchema.statics.findAvailable = function() {
    return this.find({ isUsed: false });
};

giftCodeSchema.statics.findUsed = function() {
    return this.find({ isUsed: true });
};

module.exports = mongoose.model('GiftCode', giftCodeSchema);
