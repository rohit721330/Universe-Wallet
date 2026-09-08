const Mongoose = require('mongoose');

const LifafaSchema = new Mongoose.Schema({
    lifafaId: { type: String, required: true, unique: true, index: true },
    userId: { type: Mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: ['normal', 'dice', 'toss', 'scratch'], default: 'normal' },
    winChance: { type: Number, min: 0, max: 100, default: null, validate: { validator: function(v) { if (this.type === 'normal') return v === null || v === undefined; return v !== null && v !== undefined && v >= 0 && v <= 100; }, message: 'Wɪɴ ᴄʜᴀɴᴄᴇ ɪꜱ ʀᴇǫᴜɪʀᴇᴅ ꜰᴏʀ ᴅɪᴄᴇ, ᴛᴏꜱꜱ, ᴀɴᴅ ꜱᴄʀᴀᴛᴄʜ ᴛʏᴘᴇꜱ' } },
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
    channelPermissions: { type: [{ channel: { type: String }, hasInvitePermission: { type: Boolean, default: false }, checkedAt: { type: Date, default: Date.now }, error: { type: String, default: null } }], default: [] },
    allChannelsHavePermission: { type: Boolean, default: false },
    isExpired: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null }
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

LifafaSchema.index({ userId: 1, createdAt: -1 });
LifafaSchema.index({ status: 1 });
LifafaSchema.index({ 'claimedUsers.telegramId': 1 });
LifafaSchema.index({ 'claimedUsers.fingerprint': 1 });
LifafaSchema.index({ type: 1, winChance: 1 });

LifafaSchema.virtual('claimPercentage').get(function() { if (this.totalUsers === 0) return 0; return (this.claimedUsers.length / this.totalUsers) * 100; });

LifafaSchema.pre('save', function(Next) {
    this.remainingUsers = this.totalUsers - this.claimedUsers.length;
    if (this.remainingUsers <= 0 && this.status === 'active') this.status = 'completed';
    if (this.expiresAt && this.expiresAt < new Date()) { this.isExpired = true; if (this.status === 'active') this.status = 'expired'; }
    Next();
});

LifafaSchema.statics.findActive = function() { return this.find({ status: 'active', remainingUsers: { $gt: 0 }, isExpired: false }); };

LifafaSchema.methods.canClaim = function(UserId, TelegramId, AccessCode, Fingerprint) {
    if (this.status !== 'active') return { canClaim: false, reason: 'Lɪꜰᴀꜰᴀ Iꜱ Nᴏᴛ Aᴄᴛɪᴠᴇ' };
    if (this.remainingUsers <= 0) return { canClaim: false, reason: 'Aʟʟ Uꜱᴇʀꜱ Hᴀᴠᴇ Aʟʀᴇᴀᴅʏ Cʟᴀɪᴍᴇᴅ' };
    if (this.isExpired) return { canClaim: false, reason: 'Lɪꜰᴀꜰᴀ Hᴀꜱ Exᴘɪʀᴇᴅ' };
    if (this.accessCode && this.accessCode !== AccessCode) return { canClaim: false, reason: 'Iɴᴠᴀʟɪᴅ Aᴄᴄᴇꜱꜱ Cᴏᴅᴇ' };
    if (Fingerprint && this.claimedUsers.some(c => c.fingerprint === Fingerprint)) return { canClaim: false, reason: 'Tʜɪꜱ Dᴇᴠɪᴄᴇ Hᴀꜱ Aʟʀᴇᴀᴅʏ Cʟᴀɪᴍᴇᴅ' };
    if (this.requireChannel && this.channels.length > 0 && !this.allChannelsHavePermission) return { canClaim: false, reason: 'Bᴏᴛ Dᴏᴇꜱ Nᴏᴛ Hᴀᴠᴇ Iɴᴠɪᴛᴇ Pᴇʀᴍɪꜱꜱɪᴏɴ Iɴ Aʟʟ Cʜᴀɴɴᴇʟꜱ' };
    const AlreadyClaimed = this.claimedUsers.some(C => C.userId?.toString() === UserId?.toString() || C.telegramId === TelegramId);
    if (AlreadyClaimed) return { canClaim: false, reason: 'Yᴏᴜ Hᴀᴠᴇ Aʟʀᴇᴀᴅʏ Cʟᴀɪᴍᴇᴅ Tʜɪꜱ Lɪꜰᴀꜰᴀ' };
    return { canClaim: true };
};

LifafaSchema.methods.addClaim = async function(UserId, TelegramId, Mobile, Fingerprint, ReferrerId, WinAmount = 0, IsWinner = false) {
    if (this.claimedUsers.some(C => C.userId?.toString() === UserId?.toString() || C.telegramId === TelegramId)) throw new Error('Uꜱᴇʀ Aʟʀᴇᴀᴅʏ Cʟᴀɪᴍᴇᴅ Tʜɪꜱ Lɪꜰᴀꜰᴀ');
    if (Fingerprint && this.claimedUsers.some(c => c.fingerprint === Fingerprint)) throw new Error('Tʜɪꜱ Dᴇᴠɪᴄᴇ Hᴀꜱ Aʟʀᴇᴀᴅʏ Cʟᴀɪᴍᴇᴅ Tʜɪꜱ Lɪꜰᴀꜰᴀ');
    this.claimedUsers.push({ userId: UserId, telegramId: TelegramId, mobile: Mobile, fingerprint: Fingerprint || null, referrerId: ReferrerId || null, claimedAt: new Date(), winAmount: WinAmount, isWinner: IsWinner });
    this.remainingUsers = this.totalUsers - this.claimedUsers.length;
    if (this.remainingUsers <= 0) this.status = 'completed';
    await this.save();
    return this;
};

module.exports = Mongoose.model('Lifafa', LifafaSchema);
