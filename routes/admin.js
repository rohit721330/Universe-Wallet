// FILE: routes/admin.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Deposit = require('../models/Deposit');
const Withdrawal = require('../models/Withdraw');
const Lifafa = require('../models/Lifafa');
const Gift = require('../models/GiftCode');
const Admin = require('../models/Admin');
const Referral = require('../models/Referral');
require('dotenv').config();

// ============================================
// ENVIRONMENT
// ============================================
const ADMIN_PATTERN = process.env.ADMIN_PATTERN;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID;
const JWT_SECRET = process.env.JWT_SECRET;

// ============================================
// HELPERS
// ============================================
function getCurrentDateTime() {
    const now = new Date();
    return now.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: true
    });
}

async function sendTelegramMessage(chatId, message) {
    return new Promise((resolve) => {
        const https = require('https');
        if (!BOT_TOKEN) { resolve({ success: false }); return; }
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const data = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' });
        const request = https.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                try { resolve({ success: JSON.parse(responseData).ok }); }
                catch (e) { resolve({ success: false }); }
            });
        });
        request.on('error', () => resolve({ success: false }));
        request.write(data);
        request.end();
    });
}

async function notifyAdmin(message) {
    try {
        if (!ADMIN_TG_ID) return;
        await sendTelegramMessage(ADMIN_TG_ID, message);
    } catch (error) {
        console.error('Admin notification failed:', error.message);
    }
}

// ✅ Get global referral settings (used by other modules too)
async function getGlobalReferralSettings() {
    try {
        const admin = await Admin.findOne({
            role: 'super_admin',
            isActive: true,
            isBlocked: false
        }).select('referralSettings').lean();

        if (admin && admin.referralSettings) {
            const s = admin.referralSettings;
            return {
                enabled: s.enabled !== false,
                bonusAmount: s.bonusAmount || 10,
                minDepositAmount: s.minDepositAmount || 50,
                maxReferralsPerUser: s.maxReferralsPerUser || 100
            };
        }
    } catch (err) {
        console.error('getGlobalReferralSettings error:', err.message);
    }
    return {
        enabled: true,
        bonusAmount: 10,
        minDepositAmount: 50,
        maxReferralsPerUser: 100
    };
}

// ============================================
// VERIFY ADMIN TOKEN
// ============================================
async function verifyAdminToken(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'No Token Provided.' });
        }
        const token = authHeader.split(' ')[1];
        if (!JWT_SECRET) {
            return res.status(500).json({ success: false, message: 'Server misconfiguration.' });
        }
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (!decoded.isAdmin || decoded.tokenType !== 'admin_jwt') {
                return res.status(403).json({ success: false, message: 'Access Denied. Admin Resource Only.' });
            }
            req.user = {
                isAdmin: true,
                adminDbId: decoded.adminDbId,
                adminId: decoded.adminId,
                fullName: decoded.fullName,
                role: decoded.role,
                tokenType: 'admin_jwt'
            };
            return next();
        } catch (jwtError) {
            if (jwtError.name === 'TokenExpiredError') {
                return res.status(401).json({ success: false, message: 'Token Expired.' });
            }
            return res.status(401).json({ success: false, message: 'Invalid Token.' });
        }
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Auth Error.' });
    }
}

// ============================================
// LOGIN STEP 1 — PATTERN
// ============================================
router.post('/login-step1', async (req, res) => {
    try {
        const { pattern } = req.body;
        if (!pattern) return res.status(400).json({ success: false, message: 'Pattern required.' });
        if (!/^[0-9]{6}$/.test(pattern)) return res.status(400).json({ success: false, message: 'Pattern must be 6 digits.' });
        if (!ADMIN_PATTERN) return res.status(500).json({ success: false, message: 'Server misconfiguration.' });

        if (pattern !== ADMIN_PATTERN) {
            await notifyAdmin(`⚠️ Wrong Pattern Attempt\nTime: ${getCurrentDateTime()}\nIP: ${req.ip}`);
            return res.status(401).json({ success: false, message: 'Incorrect pattern.' });
        }

        const tempToken = jwt.sign(
            { step: 'credentials_pending', patternVerified: true },
            JWT_SECRET,
            { expiresIn: '5m' }
        );
        res.json({ success: true, message: 'Pattern verified.', tempToken });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Login failed.' });
    }
});

// ============================================
// LOGIN STEP 2 — CREDENTIALS
// ============================================
router.post('/login-step2', async (req, res) => {
    try {
        const { tempToken, adminId, password } = req.body;
        if (!tempToken || !adminId || !password) {
            return res.status(400).json({ success: false, message: 'Required fields missing.' });
        }

        let decoded;
        try { decoded = jwt.verify(tempToken, JWT_SECRET); }
        catch (err) { return res.status(401).json({ success: false, message: 'Session expired.' }); }

        if (decoded.step !== 'credentials_pending' || !decoded.patternVerified) {
            return res.status(401).json({ success: false, message: 'Invalid session.' });
        }

        const admin = await Admin.findOne({ adminId: adminId.toLowerCase().trim() });
        if (!admin) {
            await notifyAdmin(`⚠️ Admin Login Failed\nReason: ID not found\nID: ${adminId}\nTime: ${getCurrentDateTime()}`);
            return res.status(401).json({ success: false, message: 'Invalid Admin ID or Password.' });
        }

        if (admin.isBlocked) return res.status(403).json({ success: false, message: 'Account blocked.' });
        if (!admin.isActive) return res.status(403).json({ success: false, message: 'Account inactive.' });

        const isMatch = await admin.comparePassword(password);
        if (!isMatch) {
            await notifyAdmin(`⚠️ Admin Login Failed\nReason: Wrong password\nID: ${adminId}\nTime: ${getCurrentDateTime()}`);
            return res.status(401).json({ success: false, message: 'Invalid Admin ID or Password.' });
        }

        admin.lastLoginAt = new Date();
        admin.lastLoginIP = req.ip;
        await admin.save();

        const adminToken = jwt.sign(
            {
                adminDbId: admin._id.toString(),
                adminId: admin.adminId,
                fullName: admin.fullName,
                role: admin.role,
                isAdmin: true,
                tokenType: 'admin_jwt'
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        await notifyAdmin(`✅ Admin Login\nAdmin: ${admin.fullName}\nID: ${admin.adminId}\nTime: ${getCurrentDateTime()}`);

        res.json({
            success: true,
            message: 'Login successful.',
            token: adminToken,
            isAdmin: true,
            admin: {
                _id: admin._id,
                adminId: admin.adminId,
                fullName: admin.fullName,
                mobile: admin.mobile,
                email: admin.email,
                telegramId: admin.telegramId,
                role: admin.role,
                lastLoginAt: admin.lastLoginAt
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Login failed.' });
    }
});

// ============================================
// MY PROFILE
// ============================================
router.get('/my-profile', verifyAdminToken, async (req, res) => {
    try {
        const admin = await Admin.findById(req.user.adminDbId).select('-password');
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });
        res.json({ success: true, admin });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.put('/update-my-profile', verifyAdminToken, async (req, res) => {
    try {
        const { fullName, mobile, email, telegramId } = req.body;
        const admin = await Admin.findById(req.user.adminDbId);
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });

        if (fullName) admin.fullName = fullName;
        if (mobile) {
            if (!/^[0-9]{10}$/.test(mobile)) return res.status(400).json({ success: false, message: 'Mobile must be 10 digits.' });
            const exists = await Admin.findOne({ mobile, _id: { $ne: admin._id } });
            if (exists) return res.status(400).json({ success: false, message: 'Mobile already in use.' });
            admin.mobile = mobile;
        }
        if (email) admin.email = email;
        if (telegramId) admin.telegramId = telegramId;
        admin.updatedBy = admin.adminId;
        await admin.save();

        res.json({ success: true, message: 'Profile updated.', admin });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.put('/change-my-password', verifyAdminToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.status(400).json({ success: false, message: 'Both passwords required.' });
        if (newPassword.length < 6) return res.status(400).json({ success: false, message: 'Min 6 characters.' });

        const admin = await Admin.findById(req.user.adminDbId);
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });

        const isMatch = await admin.comparePassword(currentPassword);
        if (!isMatch) return res.status(401).json({ success: false, message: 'Current password incorrect.' });

        admin.password = newPassword;
        admin.updatedBy = admin.adminId;
        await admin.save();

        res.json({ success: true, message: 'Password changed.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// ADMIN LIST (super_admin only)
// ============================================
router.get('/admins-list', verifyAdminToken, async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Only super admin can view.' });
        }
        const admins = await Admin.find().select('-password').sort({ createdAt: -1 });
        res.json({ success: true, admins });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.post('/create-admin-account', verifyAdminToken, async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Only super admin can create.' });
        }
        const { adminId, password, fullName, mobile, email, telegramId, role } = req.body;
        if (!adminId || !password || !fullName || !mobile) {
            return res.status(400).json({ success: false, message: 'Required fields missing.' });
        }
        if (password.length < 6) return res.status(400).json({ success: false, message: 'Password min 6 chars.' });

        const existing = await Admin.findOne({ $or: [{ adminId: adminId.toLowerCase() }, { mobile }] });
        if (existing) return res.status(400).json({ success: false, message: 'Admin ID or mobile exists.' });

        const newAdmin = new Admin({
            adminId: adminId.toLowerCase(),
            password, fullName, mobile, email, telegramId,
            role: role || 'admin',
            createdBy: req.user.adminId
        });
        await newAdmin.save();

        await notifyAdmin(`🆕 New Admin\nName: ${fullName}\nID: ${adminId}\nBy: ${req.user.fullName}\nTime: ${getCurrentDateTime()}`);

        res.json({ success: true, message: 'Admin created.', admin: { adminId: newAdmin.adminId, fullName: newAdmin.fullName, role: newAdmin.role } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.put('/update-admin/:adminDbId', verifyAdminToken, async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }
        const { fullName, mobile, email, telegramId, role, isActive, isBlocked, newPassword } = req.body;
        const admin = await Admin.findById(req.params.adminDbId);
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });

        if (fullName) admin.fullName = fullName;
        if (mobile) admin.mobile = mobile;
        if (email) admin.email = email;
        if (telegramId) admin.telegramId = telegramId;
        if (role) admin.role = role;
        if (typeof isActive === 'boolean') admin.isActive = isActive;
        if (typeof isBlocked === 'boolean') admin.isBlocked = isBlocked;
        if (newPassword) admin.password = newPassword;
        admin.updatedBy = req.user.adminId;
        await admin.save();

        res.json({ success: true, message: 'Admin updated.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.delete('/delete-admin/:adminDbId', verifyAdminToken, async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }
        const admin = await Admin.findById(req.params.adminDbId);
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });
        if (admin._id.toString() === req.user.adminDbId) {
            return res.status(400).json({ success: false, message: 'Cannot delete yourself.' });
        }
        await Admin.findByIdAndDelete(req.params.adminDbId);
        await notifyAdmin(`🗑️ Admin Deleted\nName: ${admin.fullName}\nBy: ${req.user.fullName}\nTime: ${getCurrentDateTime()}`);
        res.json({ success: true, message: 'Admin deleted.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// ✅ REFERRAL SETTINGS (inside admin.js)
// ============================================
router.get('/referral-settings', verifyAdminToken, async (req, res) => {
    try {
        const settings = await getGlobalReferralSettings();
        res.json({ success: true, settings });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.put('/referral-settings', verifyAdminToken, async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Only super admin can change settings.' });
        }

        const { enabled, bonusAmount, minDepositAmount, maxReferralsPerUser } = req.body;
        const update = {};

        if (typeof enabled === 'boolean') update['referralSettings.enabled'] = enabled;
        if (typeof bonusAmount === 'number' && bonusAmount > 0) update['referralSettings.bonusAmount'] = bonusAmount;
        if (typeof minDepositAmount === 'number' && minDepositAmount > 0) update['referralSettings.minDepositAmount'] = minDepositAmount;
        if (typeof maxReferralsPerUser === 'number' && maxReferralsPerUser > 0) update['referralSettings.maxReferralsPerUser'] = maxReferralsPerUser;

        update['referralSettings.updatedAt'] = new Date();
        update['referralSettings.updatedBy'] = req.user.adminId;

        // ✅ Update super_admin's document
        const superAdmin = await Admin.findOne({ role: 'super_admin' });
        if (!superAdmin) {
            return res.status(404).json({ success: false, message: 'Super admin not found.' });
        }

        await Admin.findByIdAndUpdate(superAdmin._id, { $set: update }, { new: true });

        await notifyAdmin(
`⚙️ Referral Settings Updated

By: ${req.user.fullName}
Enabled: ${enabled !== undefined ? enabled : 'unchanged'}
Bonus: ₹${bonusAmount || 'unchanged'}
Min Deposit: ₹${minDepositAmount || 'unchanged'}
Max Refs: ${maxReferralsPerUser || 'unchanged'}
Time: ${getCurrentDateTime()}`
        );

        res.json({ success: true, message: 'Referral settings updated.' });
    } catch (error) {
        console.error('Update referral settings error:', error.message);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// REFERRAL MANAGEMENT
// ============================================
router.get('/referrals', verifyAdminToken, async (req, res) => {
    try {
        const { status, search, page = 1, limit = 20 } = req.query;
        let query = {};
        if (status && status !== 'all') query.status = status;

        if (search) {
            const users = await User.find({
                $or: [
                    { fullName: { $regex: search, $options: 'i' } },
                    { mobile: { $regex: search, $options: 'i' } },
                    { referralCode: { $regex: search, $options: 'i' } }
                ]
            }).select('_id').lean();
            const userIds = users.map(u => u._id);
            query.$or = [
                { referrerId: { $in: userIds } },
                { referredUserId: { $in: userIds } },
                { referralCode: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const referrals = await Referral.find(query)
            .populate('referrerId', 'fullName mobile walletId referralCode')
            .populate('referredUserId', 'fullName mobile walletId')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const total = await Referral.countDocuments(query);
        const stats = await Referral.aggregate([
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
                    pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
                    failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
                    totalBonusPaid: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ['$status', 'completed'] }, { $eq: ['$referrerBonusPaid', true] }] },
                                '$bonusAmount', 0
                            ]
                        }
                    }
                }
            }
        ]);

        res.json({
            success: true,
            referrals,
            stats: stats[0] || { total: 0, completed: 0, pending: 0, failed: 0, totalBonusPaid: 0 },
            pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.get('/top-referrers', verifyAdminToken, async (req, res) => {
    try {
        const top = await Referral.aggregate([
            { $match: { status: 'completed' } },
            { $group: { _id: '$referrerId', count: { $sum: 1 }, totalEarned: { $sum: '$bonusAmount' } } },
            { $sort: { count: -1 } },
            { $limit: 20 },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
            { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } }
        ]);

        const leaderboard = top.map(t => ({
            userId: t._id,
            name: t.user?.fullName || 'Unknown',
            mobile: t.user?.mobile || '',
            walletId: t.user?.walletId || '',
            referralCode: t.user?.referralCode || '',
            count: t.count,
            totalEarned: t.totalEarned
        }));

        res.json({ success: true, leaderboard });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.put('/update-referral/:id', verifyAdminToken, async (req, res) => {
    try {
        const { status, notes } = req.body;
        const referral = await Referral.findById(req.params.id);
        if (!referral) return res.status(404).json({ success: false, message: 'Not found.' });
        if (status) referral.status = status;
        if (notes !== undefined) referral.notes = notes;
        if (status === 'completed' && !referral.completedAt) referral.completedAt = new Date();
        await referral.save();
        res.json({ success: true, message: 'Updated.', referral });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.delete('/delete-referral/:id', verifyAdminToken, async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }
        const referral = await Referral.findByIdAndDelete(req.params.id);
        if (!referral) return res.status(404).json({ success: false, message: 'Not found.' });
        res.json({ success: true, message: 'Deleted.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.get('/user-referrals/:userId', verifyAdminToken, async (req, res) => {
    try {
        const userId = req.params.userId;
        const asReferrer = await Referral.find({ referrerId: userId })
            .populate('referredUserId', 'fullName mobile walletId')
            .sort({ createdAt: -1 }).lean();
        const asReferred = await Referral.findOne({ referredUserId: userId })
            .populate('referrerId', 'fullName mobile walletId referralCode').lean();
        res.json({ success: true, asReferrer, asReferred });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// DASHBOARD STATS
// ============================================
router.get('/stats', verifyAdminToken, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments({ isDeleted: { $ne: true } });
        const activeUsers = await User.countDocuments({ isBlocked: false, isDeleted: { $ne: true }, isActive: { $ne: false } });
        const blockedUsers = await User.countDocuments({ isBlocked: true, isDeleted: { $ne: true } });
        const deletedUsers = await User.countDocuments({ isDeleted: true });

        const approvedDeposits = await Deposit.countDocuments({ status: 'approved' });
        const pendingDeposits = await Deposit.countDocuments({ status: { $in: ['pending', 'pending_approval'] } });
        const rejectedDeposits = await Deposit.countDocuments({ status: 'rejected' });

        const allDeposits = await Deposit.find({ status: 'approved' });
        const totalVolume = allDeposits.reduce((sum, d) => sum + d.amount, 0);

        const totalWithdrawals = await Withdrawal.countDocuments();
        const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });
        const completedWithdrawals = await Withdrawal.countDocuments({ status: 'completed' });

        const allWithdrawals = await Withdrawal.find({ status: 'completed' });
        const totalWithdrawn = allWithdrawals.reduce((sum, w) => sum + w.amount, 0);

        const totalLifafas = await Lifafa.countDocuments();
        const totalGifts = await Gift.countDocuments();

        const recentTransactions = await Transaction.find()
            .populate('sender_id', 'fullName mobile walletId')
            .populate('receiver_id', 'fullName mobile walletId')
            .populate('user_id', 'fullName mobile walletId')
            .sort({ createdAt: -1 })
            .limit(10);

        res.json({
            success: true,
            stats: {
                totalUsers, activeUsers, blockedUsers, deletedUsers,
                approvedDeposits, pendingDeposits, rejectedDeposits, totalVolume,
                totalWithdrawals, pendingWithdrawals, completedWithdrawals, totalWithdrawn,
                totalLifafas, totalGifts
            },
            recentTransactions
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// TRANSACTIONS
// ============================================
router.get('/transactions', verifyAdminToken, async (req, res) => {
    try {
        const { type, status, search, page = 1, limit = 20 } = req.query;
        let query = {};
        if (type) query.type = type;
        if (status) query.status = status;
        if (search) {
            query.$or = [
                { tx_id: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
                { remark: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const transactions = await Transaction.find(query)
            .populate('sender_id', 'fullName mobile walletId')
            .populate('receiver_id', 'fullName mobile walletId')
            .populate('user_id', 'fullName mobile walletId')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Transaction.countDocuments(query);

        res.json({
            success: true,
            transactions,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// USERS
// ============================================
router.get('/users', verifyAdminToken, async (req, res) => {
    try {
        const { search, page = 1, limit = 20, status } = req.query;
        let query = {};
        if (status === 'active') query = { isBlocked: false, isDeleted: { $ne: true }, isActive: { $ne: false } };
        else if (status === 'blocked') query = { isBlocked: true, isDeleted: { $ne: true } };
        else if (status === 'deleted') query = { isDeleted: true };
        else if (status === 'all') query = {};
        else query = { isDeleted: { $ne: true } };

        if (search) {
            query.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { mobile: { $regex: search, $options: 'i' } },
                { walletId: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const users = await User.find(query).select('-password -pin -__v')
            .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));

        const total = await User.countDocuments(query);

        res.json({
            success: true,
            users,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.get('/user/:identifier', verifyAdminToken, async (req, res) => {
    try {
        const { identifier } = req.params;
        let user = null;
        if (mongoose.Types.ObjectId.isValid(identifier)) {
            user = await User.findById(identifier).select('-password -pin -__v');
        }
        if (!user && /^[0-9]{10}$/.test(identifier)) {
            user = await User.findOne({ mobile: identifier }).select('-password -pin -__v');
        }
        if (!user) {
            user = await User.findOne({ walletId: identifier.toUpperCase() }).select('-password -pin -__v');
        }
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

        const transactions = await Transaction.find({
            $or: [{ sender_id: user._id }, { receiver_id: user._id }, { user_id: user._id }]
        }).sort({ createdAt: -1 }).limit(100);

        res.json({ success: true, user, transactions });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.post('/toggle-block', verifyAdminToken, async (req, res) => {
    try {
        const { userId, reason } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

        if (user.isBlocked) await user.unblockAccount();
        else await user.blockAccount(reason || 'Blocked by admin');

        const status = user.isBlocked ? 'Blocked' : 'Unblocked';
        res.json({ success: true, message: `User ${status}.`, isBlocked: user.isBlocked });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.delete('/delete-user/:userId', verifyAdminToken, async (req, res) => {
    try {
        const userToDelete = await User.findById(req.params.userId);
        if (!userToDelete) return res.status(404).json({ success: false, message: 'User not found.' });
        if (userToDelete.isAdmin) return res.status(400).json({ success: false, message: 'Cannot delete admin.' });

        await userToDelete.softDelete(req.user.fullName || 'Admin');
        res.json({ success: true, message: `User "${userToDelete.fullName}" deleted.` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.post('/restore-user/:userId', verifyAdminToken, async (req, res) => {
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
        if (!user.isDeleted) return res.status(400).json({ success: false, message: 'Not deleted.' });

        await user.restore();
        res.json({ success: true, message: `User "${user.fullName}" restored.` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// ADJUST BALANCE
// ============================================
router.post('/adjust-balance', verifyAdminToken, async (req, res) => {
    try {
        const { userId, amount, type, reason } = req.body;
        if (!userId || !amount || !type) return res.status(400).json({ success: false, message: 'Missing fields.' });
        if (!['add', 'deduct'].includes(type)) return res.status(400).json({ success: false, message: 'Invalid type.' });

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

        const amountNum = parseFloat(amount);
        if (type === 'deduct' && user.balance < amountNum) {
            return res.status(400).json({ success: false, message: `Insufficient balance. Current: ₹${user.balance}` });
        }

        const finalAmount = type === 'add' ? amountNum : -amountNum;
        user.balance += finalAmount;
        await user.save();

        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.floor(Math.random() * 99999).toString().padStart(5, '0');
        const tx_id = `TXN${timestamp}${random}`;

        await Transaction.create({
            tx_id,
            user_id: user._id,
            sender_id: type === 'add' ? null : user._id,
            receiver_id: type === 'add' ? user._id : null,
            amount: amountNum,
            fee: 0,
            type: type === 'add' ? 'admin_add' : 'admin_deduct',
            status: 'success',
            remark: reason || 'No reason',
            description: `Admin ${type === 'add' ? 'added' : 'deducted'} ₹${amountNum}`
        });

        res.json({ success: true, message: `Balance ${type === 'add' ? 'added' : 'deducted'}. New: ₹${user.balance}.`, newBalance: user.balance });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// DEPOSITS
// ============================================
router.get('/deposits', verifyAdminToken, async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        let query = {};
        if (status) query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const deposits = await Deposit.find(query)
            .populate('userId', 'fullName mobile walletId balance')
            .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const total = await Deposit.countDocuments(query);

        res.json({
            success: true,
            deposits,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// LIFAFA
// ============================================
router.get('/lifafas', verifyAdminToken, async (req, res) => {
    try {
        const { search, page = 1, limit = 20 } = req.query;
        let query = {};
        if (search) query.$or = [{ title: { $regex: search, $options: 'i' } }];

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const lifafas = await Lifafa.find(query)
            .populate('userId', 'fullName mobile')
            .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const total = await Lifafa.countDocuments(query);

        res.json({
            success: true, lifafas,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.delete('/delete-lifafa/:id', verifyAdminToken, async (req, res) => {
    try {
        const lifafa = await Lifafa.findByIdAndDelete(req.params.id);
        if (!lifafa) return res.status(404).json({ success: false, message: 'Not found.' });
        res.json({ success: true, message: 'Deleted.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// GIFTS
// ============================================
router.get('/gifts', verifyAdminToken, async (req, res) => {
    try {
        const { search, page = 1, limit = 20 } = req.query;
        let query = {};
        if (search) query.code = { $regex: search, $options: 'i' };

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const gifts = await Gift.find(query)
            .populate('userId', 'fullName mobile')
            .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const total = await Gift.countDocuments(query);

        res.json({
            success: true, gifts,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.delete('/delete-gift/:id', verifyAdminToken, async (req, res) => {
    try {
        const gift = await Gift.findByIdAndDelete(req.params.id);
        if (!gift) return res.status(404).json({ success: false, message: 'Not found.' });
        res.json({ success: true, message: 'Deleted.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

module.exports = router;
