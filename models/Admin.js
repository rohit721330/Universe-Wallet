// models/Admin.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
    adminId: { type: String, required: true, unique: true, trim: true, lowercase: true },
    password: { type: String, required: true },
    fullName: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, unique: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    telegramId: { type: String, trim: true },
    role: { type: String, enum: ['super_admin', 'admin', 'moderator'], default: 'admin' },
    isActive: { type: Boolean, default: true },
    isBlocked: { type: Boolean, default: false },
    lastLoginAt: Date,
    lastLoginIP: String,
    createdBy: String,
    updatedBy: String
}, { timestamps: true });

adminSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

adminSchema.methods.comparePassword = async function(candidate) {
    return await bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('Admin', adminSchema);
