const mongoose = require('mongoose');

const depositSchema = new mongoose.Schema({
  depositId: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amount: { type: Number, required: true, min: 1, max: 5000 },
  upiId: { type: String, required: true, default: 'rohit.1474@superyes' },
  qrData: { type: String, default: null },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'cancelled'],
    default: 'pending',
    index: true
  },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  approvedAt: { type: Date, default: null },
  rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  rejectedAt: { type: Date, default: null },
  adminNote: { type: String, default: '' },
  expiresAt: { type: Date, required: true, index: true },
  metadata: {
    ipAddress: String,
    userAgent: String,
    deviceId: String
  }
}, { timestamps: true });

// ✅ Pre-save middleware to generate depositId with "PAY_" prefix
depositSchema.pre('save', function(next) {
  console.log('🔄 Pʀᴇ-sᴀᴠᴇ Hᴏᴏᴋ Rᴜɴɴɪɴɢ...');
  
  if (!this.depositId) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    this.depositId = `PAY_${timestamp}_${random}`;
    console.log('✅ Gᴇɴᴇʀᴀᴛᴇᴅ Dᴇᴘᴏꜱɪᴛ Iᴅ:', this.depositId);
  }
  
  if (!this.expiresAt) {
    this.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
  
  next();
});

// ✅ Pre-validate middleware to ensure depositId exists
depositSchema.pre('validate', function(next) {
  if (!this.depositId) {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    this.depositId = `PAY_${timestamp}_${random}`;
    console.log('✅ Gᴇɴᴇʀᴀᴛᴇᴅ Dᴇᴘᴏꜱɪᴛ Iᴅ (Vᴀʟɪᴅᴀᴛᴇ):', this.depositId);
  }
  next();
});

// Methods
depositSchema.methods.isExpired = function() {
  return new Date() > this.expiresAt;
};

depositSchema.methods.canBeApproved = function() {
  return this.status === 'pending' && !this.isExpired();
};

depositSchema.methods.canBeRejected = function() {
  return this.status === 'pending' || this.status === 'approved';
};

depositSchema.methods.approve = async function(adminId, note = '') {
  this.status = 'approved';
  this.approvedBy = adminId;
  this.approvedAt = new Date();
  if (note) this.adminNote = note;
  await this.save();
  return this;
};

depositSchema.methods.reject = async function(adminId, reason = '') {
  this.status = 'rejected';
  this.rejectedBy = adminId;
  this.rejectedAt = new Date();
  if (reason) this.adminNote = reason;
  await this.save();
  return this;
};

// Static methods
depositSchema.statics.findByDepositId = function(depositId) {
  return this.findOne({ depositId });
};

depositSchema.statics.getUserDeposits = function(userId, limit = 50, skip = 0) {
  return this.find({ userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);
};

depositSchema.statics.getPendingCount = async function(userId) {
  return this.countDocuments({
    userId,
    status: 'pending',
    expiresAt: { $gt: new Date() }
  });
};

depositSchema.statics.getPendingDeposits = function(limit = 100, skip = 0) {
  return this.find({
    status: 'pending',
    expiresAt: { $gt: new Date() }
  })
  .populate('userId', 'username email balance')
  .sort({ createdAt: 1 })
  .skip(skip)
  .limit(limit);
};

depositSchema.statics.cleanupExpired = async function() {
  const result = await this.updateMany(
    {
      status: 'pending',
      expiresAt: { $lt: new Date() }
    },
    {
      $set: { status: 'cancelled' }
    }
  );
  return result;
};

// Indexes
depositSchema.index({ depositId: 1, status: 1 });
depositSchema.index({ userId: 1, createdAt: -1 });
depositSchema.index({ status: 1, createdAt: 1 });
depositSchema.index({ approvedBy: 1, approvedAt: -1 });

module.exports = mongoose.model('Deposit', depositSchema);
