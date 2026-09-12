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
require('dotenv').config();

// ============================================
// ENVIRONMENT VARIABLES
// ============================================
const ADMIN_PATTERN = process.env.ADMIN_PATTERN;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID;
const JWT_SECRET = process.env.JWT_SECRET;

// ============================================
// HELPER FUNCTIONS
// ============================================
function getCurrentDateTime() {
    const now = new Date();
    const options = {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: true
    };
    return now.toLocaleString('en-IN', options);
}

async function sendTelegramMessage(chatId, message) {
    return new Promise((resolve) => {
        const https = require('https');
        if (!BOT_TOKEN) {
            console.warn('BOT_TOKEN not configured');
            resolve({ success: false, error: 'BOT_TOKEN not configured' });
            return;
        }
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const data = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' });
        const request = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(responseData);
                    resolve({ success: result.ok, error: result.description });
                } catch (e) {
                    resolve({ success: false, error: e.message });
                }
            });
        });
        request.on('error', (error) => resolve({ success: false, error: error.message }));
        request.write(data);
        request.end();
    });
}

async function notifyAdmin(message) {
    try {
        if (!ADMIN_TG_ID) return;
        await sendTelegramMessage(ADMIN_TG_ID, message);
    } catch (error) {
        console.error('Failed to send admin notification:', error);
    }
}

// ============================================
// VERIFY ADMIN TOKEN MIDDLEWARE
// ============================================
async function verifyAdminToken(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'No Token Provided. Please Login To Access This Resource.'
            });
        }

        const token = authHeader.split(' ')[1];

        if (!JWT_SECRET) {
            console.error('❌ JWT_SECRET not configured on server');
            return res.status(500).json({
                success: false,
                message: 'Server misconfiguration.'
            });
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET);

            if (!decoded.isAdmin || decoded.tokenType !== 'admin_jwt') {
                return res.status(403).json({
                    success: false,
                    message: 'Access Denied. Admin Resource Only.'
                });
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
                return res.status(401).json({
                    success: false,
                    message: 'Token Has Expired. Please Login Again.'
                });
            }
            return res.status(401).json({
                success: false,
                message: 'Invalid Token. Please Login Again.'
            });
        }
    } catch (error) {
        console.error('Token Verification Error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Internal Server Error During Authentication.'
        });
    }
}

// ============================================
// ADMIN LOGIN — STEP 1: PATTERN LOCK (First)
// ============================================
router.post('/login-step1', async (req, res) => {
    try {
        const { pattern } = req.body;

        if (!pattern) {
            return res.status(400).json({
                success: false,
                message: 'Security pattern is required.'
            });
        }

        if (!/^[0-9]{6}$/.test(pattern)) {
            return res.status(400).json({
                success: false,
                message: 'Pattern must be exactly 6 digits.'
            });
        }

        if (!ADMIN_PATTERN) {
            console.error('❌ ADMIN_PATTERN not configured');
            return res.status(500).json({
                success: false,
                message: 'Server misconfiguration. Contact support.'
            });
        }

        if (pattern !== ADMIN_PATTERN) {
            const dateTime = getCurrentDateTime();
            await notifyAdmin(
`⚠️ Wrong Pattern Attempt (Step 1)

Time: ${dateTime}
IP: ${req.ip}`
            );
            return res.status(401).json({
                success: false,
                message: 'Incorrect pattern. Access denied.'
            });
        }

        const tempToken = jwt.sign(
            {
                step: 'credentials_pending',
                patternVerified: true
            },
            JWT_SECRET,
            { expiresIn: '5m' }
        );

        res.json({
            success: true,
            message: 'Pattern verified. Enter your admin credentials.',
            tempToken
        });

    } catch (error) {
        console.error('Admin login step1 (pattern) error:', error.message);
        res.status(500).json({ success: false, message: 'Login failed. Try again.' });
    }
});

// ============================================
// ADMIN LOGIN — STEP 2: ADMIN ID + PASSWORD (Second)
// ============================================
router.post('/login-step2', async (req, res) => {
    try {
        const { tempToken, adminId, password } = req.body;

        if (!tempToken || !adminId || !password) {
            return res.status(400).json({
                success: false,
                message: 'Session token, Admin ID and Password are required.'
            });
        }

        let decoded;
        try {
            decoded = jwt.verify(tempToken, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({
                success: false,
                message: 'Session expired. Please start over.'
            });
        }

        if (decoded.step !== 'credentials_pending' || !decoded.patternVerified) {
            return res.status(401).json({
                success: false,
                message: 'Invalid session. Please start over.'
            });
        }

        const admin = await Admin.findOne({
            adminId: adminId.toLowerCase().trim()
        });

        if (!admin) {
            const dateTime = getCurrentDateTime();
            await notifyAdmin(
`⚠️ Admin Login Failed (Step 2)

Reason: Admin ID not found
Admin ID attempted: ${adminId}
Time: ${dateTime}`
            );
            return res.status(401).json({
                success: false,
                message: 'Invalid Admin ID or Password.'
            });
        }

        if (admin.isBlocked) {
            return res.status(403).json({
                success: false,
                message: 'Your admin account is blocked.'
            });
        }

        if (!admin.isActive) {
            return res.status(403).json({
                success: false,
                message: 'Your admin account is inactive.'
            });
        }

        const isMatch = await admin.comparePassword(password);
        if (!isMatch) {
            const dateTime = getCurrentDateTime();
            await notifyAdmin(
`⚠️ Admin Login Failed (Step 2)

Reason: Wrong password
Admin ID: ${adminId}
Time: ${dateTime}`
            );
            return res.status(401).json({
                success: false,
                message: 'Invalid Admin ID or Password.'
            });
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

        await notifyAdmin(
`✅ Admin Login Success

Admin: ${admin.fullName}
Admin ID: ${admin.adminId}
Role: ${admin.role}
Time: ${getCurrentDateTime()}`
        );

        res.json({
            success: true,
            message: 'Admin login successful.',
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
        console.error('Admin login step2 (credentials) error:', error.message);
        res.status(500).json({ success: false, message: 'Login failed. Try again.' });
    }
});

// ============================================
// ADMIN — MY PROFILE
// ============================================
router.get('/my-profile', verifyAdminToken, async (req, res) => {
    try {
        const admin = await Admin.findById(req.user.adminDbId).select('-password');
        if (!admin) {
            return res.status(404).json({ success: false, message: 'Admin not found.' });
        }
        res.json({ success: true, admin });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch profile.' });
    }
});

// ============================================
// ADMIN — UPDATE MY PROFILE
// ============================================
router.put('/update-my-profile', verifyAdminToken, async (req, res) => {
    try {
        const { fullName, mobile, email, telegramId } = req.body;

        const admin = await Admin.findById(req.user.adminDbId);
        if (!admin) {
            return res.status(404).json({ success: false, message: 'Admin not found.' });
        }

        if (fullName) admin.fullName = fullName;

        if (mobile) {
            if (!/^[0-9]{10}$/.test(mobile)) {
                return res.status(400).json({ success: false, message: 'Mobile must be 10 digits.' });
            }
            const exists = await Admin.findOne({ mobile, _id: { $ne: admin._id } });
            if (exists) {
                return res.status(400).json({ success: false, message: 'Mobile already in use.' });
            }
            admin.mobile = mobile;
        }

        if (email) admin.email = email;
        if (telegramId) admin.telegramId = telegramId;

        admin.updatedBy = admin.adminId;
        await admin.save();

        res.json({
            success: true,
            message: 'Profile updated successfully.',
            admin: {
                _id: admin._id,
                adminId: admin.adminId,
                fullName: admin.fullName,
                mobile: admin.mobile,
                email: admin.email,
                telegramId: admin.telegramId,
                role: admin.role
            }
        });
    } catch (error) {
        console.error('Update profile error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to update profile.' });
    }
});

// ============================================
// ADMIN — CHANGE MY PASSWORD
// ============================================
router.put('/change-my-password', verifyAdminToken, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Both passwords required.' });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'New password must be at least 6 characters.'
            });
        }

        const admin = await Admin.findById(req.user.adminDbId);
        if (!admin) {
            return res.status(404).json({ success: false, message: 'Admin not found.' });
        }

        const isMatch = await admin.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Current password incorrect.' });
        }

        admin.password = newPassword;
        admin.updatedBy = admin.adminId;
        await admin.save();

        res.json({ success: true, message: 'Password changed successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to change password.' });
    }
});

// ============================================
// ADMIN — LIST ALL ADMINS (super_admin only)
// ============================================
router.get('/admins-list', verifyAdminToken, async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({
                success: false,
                message: 'Only super admin can view admin list.'
            });
        }
        const admins = await Admin.find().select('-password').sort({ createdAt: -1 });
        res.json({ success: true, admins });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch admins.' });
    }
});

// ============================================
// ADMIN — CREATE NEW ADMIN (super_admin only)
// ============================================
router.post('/create-admin-account', verifyAdminToken, async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({
                success: false,
                message: 'Only super admin can create admins.'
            });
        }

        const { adminId, password, fullName, mobile, email, telegramId, role } = req.body;

        if (!adminId || !password || !fullName || !mobile) {
            return res.status(400).json({
                success: false,
                message: 'adminId, password, fullName, mobile are required.'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters.'
            });
        }

        const existing = await Admin.findOne({
            $or: [{ adminId: adminId.toLowerCase() }, { mobile }]
        });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Admin ID or mobile already exists.'
            });
        }

        const newAdmin = new Admin({
            adminId: adminId.toLowerCase(),
            password,
            fullName,
            mobile,
            email,
            telegramId,
            role: role || 'admin',
            createdBy: req.user.adminId
        });

        await newAdmin.save();

        await notifyAdmin(
`🆕 New Admin Created

Name: ${fullName}
Admin ID: ${adminId}
Role: ${role || 'admin'}
By: ${req.user.fullName}
Time: ${getCurrentDateTime()}`
        );

        res.json({
            success: true,
            message: 'New admin created successfully.',
            admin: {
                adminId: newAdmin.adminId,
                fullName: newAdmin.fullName,
                mobile: newAdmin.mobile,
                role: newAdmin.role
            }
        });
    } catch (error) {
        console.error('Create admin error:', error.message);
        res.status(500).json({ success: false, message: 'Failed to create admin.' });
    }
});

// ============================================
// ADMIN — UPDATE ANOTHER ADMIN (super_admin only)
// ============================================
router.put('/update-admin/:adminDbId', verifyAdminToken, async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({
                success: false,
                message: 'Only super admin can update admins.'
            });
        }

        const { fullName, mobile, email, telegramId, role, isActive, isBlocked, newPassword } = req.body;

        const admin = await Admin.findById(req.params.adminDbId);
        if (!admin) {
            return res.status(404).json({ success: false, message: 'Admin not found.' });
        }

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

        res.json({ success: true, message: 'Admin updated successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update admin.' });
    }
});

// ============================================
// ADMIN — DELETE ADMIN (super_admin only)
// ============================================
router.delete('/delete-admin/:adminDbId', verifyAdminToken, async (req, res) => {
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({
                success: false,
                message: 'Only super admin can delete admins.'
            });
        }

        const admin = await Admin.findById(req.params.adminDbId);
        if (!admin) {
            return res.status(404).json({ success: false, message: 'Admin not found.' });
        }

        if (admin._id.toString() === req.user.adminDbId) {
            return res.status(400).json({
                success: false,
                message: 'You cannot delete your own account.'
            });
        }

        await Admin.findByIdAndDelete(req.params.adminDbId);

        await notifyAdmin(
`🗑️ Admin Deleted

Name: ${admin.fullName}
Admin ID: ${admin.adminId}
By: ${req.user.fullName}
Time: ${getCurrentDateTime()}`
        );

        res.json({ success: true, message: `Admin "${admin.fullName}" deleted.` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete admin.' });
    }
});

// ============================================
// DASHBOARD STATS
// ============================================
router.get('/stats', verifyAdminToken, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments({ isDeleted: { $ne: true } });
        const activeUsers = await User.countDocuments({
            isBlocked: false,
            isDeleted: { $ne: true },
            isActive: { $ne: false }
        });
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
        console.error('Stats error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Fetch Dashboard Statistics.' });
    }
});

// ============================================
// TRANSACTION MANAGEMENT
// ============================================
router.get('/transactions', verifyAdminToken, async (req, res) => {
    try {
        const { type, status, search, page = 1, limit = 20 } = req.query;
        let query = {};

        if (type) {
            if (!['deposit', 'withdrawal', 'transfer', 'lifafa', 'gift', 'admin_add', 'admin_deduct'].includes(type)) {
                return res.status(400).json({ success: false, message: `Invalid Transaction Type: "${type}".` });
            }
            query.type = type;
        }

        if (status) {
            if (!['pending', 'success', 'failed', 'cancelled'].includes(status)) {
                return res.status(400).json({ success: false, message: `Invalid Status: "${status}".` });
            }
            query.status = status;
        }

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
            pagination: {
                total, page: parseInt(page), limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get transactions error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Fetch Transactions.' });
    }
});

router.get('/search-transaction', verifyAdminToken, async (req, res) => {
    try {
        const { query } = req.query;
        if (!query || query.trim() === '') {
            return res.status(400).json({ success: false, message: 'Please Provide A Transaction ID Or UTR Number.' });
        }
        const transaction = await Transaction.findOne({
            $or: [
                { tx_id: { $regex: query, $options: 'i' } },
                { _id: query },
                { remark: { $regex: query, $options: 'i' } }
            ]
        })
            .populate('sender_id', 'fullName mobile walletId')
            .populate('receiver_id', 'fullName mobile walletId')
            .populate('user_id', 'fullName mobile walletId');

        if (!transaction) {
            return res.status(404).json({ success: false, message: `No Transaction Found With: "${query}".` });
        }
        res.json({ success: true, transaction });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed To Search Transaction.' });
    }
});

// ============================================
// USER MANAGEMENT
// ============================================
router.get('/user/:identifier', verifyAdminToken, async (req, res) => {
    try {
        const { identifier } = req.params;
        if (!identifier || identifier.trim() === '') {
            return res.status(400).json({ success: false, message: 'Please Provide A Valid User ID.' });
        }

        let user = null;
        let searchBy = '';
        const isValidObjectId = mongoose.Types.ObjectId.isValid(identifier);

        if (isValidObjectId) {
            user = await User.findById(identifier).select('-password -pin -__v');
            if (user) searchBy = '_id';
        }

        if (!user && /^[0-9]{10}$/.test(identifier)) {
            user = await User.findOne({ mobile: identifier }).select('-password -pin -__v');
            if (user) searchBy = 'mobile';
        }

        if (!user) {
            const walletId = identifier.toUpperCase();
            if (walletId.startsWith('UW') || walletId.startsWith('PW')) {
                user = await User.findOne({ walletId }).select('-password -pin -__v');
                if (user) searchBy = 'walletId';
            }
        }

        if (!user) {
            user = await User.findOne({ telegramId: identifier }).select('-password -pin -__v');
            if (user) searchBy = 'telegramId';
        }

        if (!user) {
            user = await User.findOne({ fullName: { $regex: new RegExp('^' + identifier + '$', 'i') } }).select('-password -pin -__v');
            if (user) searchBy = 'fullName';
        }

        if (!user) {
            user = await User.findOne({
                $or: [
                    { mobile: { $regex: identifier, $options: 'i' } },
                    { walletId: { $regex: identifier, $options: 'i' } }
                ]
            }).select('-password -pin -__v');
            if (user) searchBy = 'partial_match';
        }

        if (!user) {
            return res.status(404).json({ success: false, message: `User With "${identifier}" Not Found.` });
        }

        const transactions = await Transaction.find({
            $or: [{ sender_id: user._id }, { receiver_id: user._id }, { user_id: user._id }]
        })
            .populate('sender_id', 'fullName mobile walletId')
            .populate('receiver_id', 'fullName mobile walletId')
            .populate('user_id', 'fullName mobile walletId')
            .sort({ createdAt: -1 })
            .limit(100);

        const deposits = await Deposit.find({ userId: user._id }).sort({ createdAt: -1 }).limit(20);
        const withdrawals = await Withdrawal.find({ userId: user._id }).sort({ createdAt: -1 }).limit(20);

        res.json({ success: true, user, transactions, deposits, withdrawals, searchBy });
    } catch (error) {
        console.error('Get user error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Fetch User Details: ' + error.message });
    }
});

router.get('/users', verifyAdminToken, async (req, res) => {
    try {
        const { search, page = 1, limit = 20, status } = req.query;
        let query = {};

        if (status === 'active') {
            query.isBlocked = false;
            query.isDeleted = { $ne: true };
            query.isActive = { $ne: false };
        } else if (status === 'blocked') {
            query.isBlocked = true;
            query.isDeleted = { $ne: true };
        } else if (status === 'deleted') {
            query.isDeleted = true;
        } else if (status === 'all') {
            // no filter
        } else {
            query.isDeleted = { $ne: true };
        }

        if (search) {
            query.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { mobile: { $regex: search, $options: 'i' } },
                { walletId: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const users = await User.find(query)
            .select('-password -pin -__v')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await User.countDocuments(query);

        res.json({
            success: true,
            users,
            pagination: {
                total, page: parseInt(page), limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed To Fetch Users.' });
    }
});

router.put('/update-user/:userId', verifyAdminToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const { fullName, mobile, telegramId, balance, pin } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: `User With ID "${userId}" Not Found.` });
        }

        if (fullName) {
            if (fullName.length < 2) {
                return res.status(400).json({ success: false, message: 'Full Name Must Be At Least 2 Characters.' });
            }
            user.fullName = fullName;
        }

        if (mobile) {
            if (!/^[0-9]{10}$/.test(mobile)) {
                return res.status(400).json({ success: false, message: 'Mobile Must Be 10 Digits.' });
            }
            const existingUser = await User.findOne({ mobile, _id: { $ne: userId } });
            if (existingUser) {
                return res.status(400).json({ success: false, message: `Mobile "${mobile}" Already Registered.` });
            }
            user.mobile = mobile;
        }

        if (telegramId) user.telegramId = telegramId;

        if (balance !== undefined) {
            const parsedBalance = parseFloat(balance);
            if (isNaN(parsedBalance) || parsedBalance < 0) {
                return res.status(400).json({ success: false, message: 'Balance Must Be Valid Positive Number.' });
            }
            user.balance = parsedBalance;
        }

        if (pin) {
            if (!/^[0-9]{4}$/.test(pin)) {
                return res.status(400).json({ success: false, message: 'PIN Must Be 4 Digits.' });
            }
            user.pin = pin;
            user.pin_set = true;
        }

        await user.save();

        res.json({ success: true, message: 'User Updated Successfully.', user });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed To Update User.' });
    }
});

// ============================================
// TOGGLE BLOCK/UNBLOCK USER
// ============================================
router.post('/toggle-block', verifyAdminToken, async (req, res) => {
    try {
        const { userId, reason } = req.body;

        if (!userId) {
            return res.status(400).json({ success: false, message: 'Please Provide A Valid User ID.' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: `User With ID "${userId}" Not Found.` });
        }

        if (user.isBlocked) {
            await user.unblockAccount();
        } else {
            await user.blockAccount(reason || 'Blocked by admin');
        }

        const status = user.isBlocked ? 'Blocked' : 'Unblocked';

        if (user.telegramId && BOT_TOKEN) {
            await sendTelegramMessage(user.telegramId,
`Account ${status}

Name: ${user.fullName}
Mobile: ${user.mobile}
${user.isBlocked && user.blockReason ? `Reason: ${user.blockReason}` : ''}
Time: ${getCurrentDateTime()}`
            );
        }

        res.json({
            success: true,
            message: `User "${user.fullName}" Has Been ${status}.`,
            isBlocked: user.isBlocked,
            blockReason: user.blockReason
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed To Toggle Block Status.' });
    }
});

// ============================================
// SOFT DELETE USER
// ============================================
router.delete('/delete-user/:userId', verifyAdminToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const dateTime = getCurrentDateTime();

        if (!userId) {
            return res.status(400).json({ success: false, message: 'Please Provide A Valid User ID.' });
        }

        const userToDelete = await User.findById(userId);
        if (!userToDelete) {
            return res.status(404).json({ success: false, message: `User With ID "${userId}" Not Found.` });
        }

        if (userToDelete.isAdmin) {
            return res.status(400).json({ success: false, message: 'Cannot Delete Admin Account.' });
        }

        await userToDelete.softDelete(req.user.fullName || 'Admin');

        const userData = {
            fullName: userToDelete.fullName,
            mobile: userToDelete.mobile,
            walletId: userToDelete.walletId,
            telegramId: userToDelete.telegramId,
            balance: userToDelete.balance
        };

        if (userData.telegramId && BOT_TOKEN) {
            await sendTelegramMessage(userData.telegramId,
`Account Deactivated

Name: ${userData.fullName}
Mobile: ${userData.mobile}
Time: ${dateTime}`
            );
        }

        await notifyAdmin(
`User Deleted (Soft Delete)

Name: ${userData.fullName}
Mobile: ${userData.mobile}
By: ${req.user.fullName}
Time: ${dateTime}`
        );

        res.json({
            success: true,
            message: `User "${userData.fullName}" Deleted.`,
            user: {
                id: userToDelete._id,
                fullName: userToDelete.fullName,
                isDeleted: userToDelete.isDeleted,
                deletedAt: userToDelete.deletedAt
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed To Delete User.' });
    }
});

// ============================================
// RESTORE DELETED USER
// ============================================
router.post('/restore-user/:userId', verifyAdminToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const dateTime = getCurrentDateTime();

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: `User With ID "${userId}" Not Found.` });
        }

        if (!user.isDeleted) {
            return res.status(400).json({ success: false, message: 'User Is Not Deleted.' });
        }

        await user.restore();

        if (user.telegramId && BOT_TOKEN) {
            await sendTelegramMessage(user.telegramId,
`Account Restored

Name: ${user.fullName}
Mobile: ${user.mobile}
Time: ${dateTime}`
            );
        }

        await notifyAdmin(
`User Restored

Name: ${user.fullName}
Mobile: ${user.mobile}
By: ${req.user.fullName}
Time: ${dateTime}`
        );

        res.json({
            success: true,
            message: `User "${user.fullName}" Restored Successfully.`,
            user: { id: user._id, fullName: user.fullName, isDeleted: user.isDeleted }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed To Restore User.' });
    }
});

// ============================================
// ADJUST BALANCE
// ============================================
router.post('/adjust-balance', verifyAdminToken, async (req, res) => {
    try {
        const { userId, amount, type, reason } = req.body;

        if (!userId) return res.status(400).json({ success: false, message: 'Please Provide A Valid User ID.' });
        if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Please Provide Valid Amount.' });
        if (!type || !['add', 'deduct'].includes(type)) {
            return res.status(400).json({ success: false, message: 'Invalid Operation. Must Be "add" Or "deduct".' });
        }

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: `User With ID "${userId}" Not Found.` });

        const amountNum = parseFloat(amount);

        if (type === 'deduct' && user.balance < amountNum) {
            return res.status(400).json({ success: false, message: `Insufficient Balance. Current: ₹${user.balance}` });
        }

        const finalAmount = type === 'add' ? amountNum : -amountNum;
        user.balance += finalAmount;
        await user.save();

        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.floor(Math.random() * 99999).toString().padStart(5, '0');
        const tx_id = `TXN${timestamp}${random}`;

        const transactionType = type === 'add' ? 'admin_add' : 'admin_deduct';
        const transaction = new Transaction({
            tx_id,
            user_id: user._id,
            sender_id: type === 'add' ? null : user._id,
            receiver_id: type === 'add' ? user._id : null,
            amount: amountNum,
            fee: 0,
            type: transactionType,
            status: 'success',
            remark: reason || 'No Reason',
            description: `Admin ${type === 'add' ? 'Added' : 'Deducted'} ₹${amountNum}`
        });

        await transaction.save();

        if (ADMIN_TG_ID && BOT_TOKEN) {
            await sendTelegramMessage(ADMIN_TG_ID,
`Balance Adjusted

Name: ${user.fullName}
${type === 'add' ? 'Added' : 'Deducted'}: ₹${amountNum}
New Balance: ₹${user.balance}
Reason: ${reason || 'N/A'}
By: ${req.user.fullName}`
            );
        }

        res.json({
            success: true,
            message: `Balance ${type === 'add' ? 'Added' : 'Deducted'}. New: ₹${user.balance}.`,
            newBalance: user.balance,
            transaction: {
                id: transaction._id, tx_id: transaction.tx_id,
                amount: transaction.amount, type: transaction.type, status: transaction.status
            }
        });
    } catch (error) {
        console.error('Adjust Balance Error:', error.message);
        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: 'Duplicate Transaction ID. Try Again.' });
        }
        res.status(500).json({ success: false, message: 'Failed To Adjust Balance.' });
    }
});

// ============================================
// DEPOSIT MANAGEMENT
// ============================================
router.get('/deposits', verifyAdminToken, async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        let query = {};

        if (status) {
            if (!['pending', 'pending_approval', 'approved', 'rejected', 'cancelled'].includes(status)) {
                return res.status(400).json({ success: false, message: `Invalid Status: "${status}".` });
            }
            query.status = status;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const deposits = await Deposit.find(query)
            .populate('userId', 'fullName mobile walletId balance')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Deposit.countDocuments(query);

        res.json({
            success: true,
            deposits,
            pagination: {
                total, page: parseInt(page), limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed To Fetch Deposits.' });
    }
});

router.post('/verify-deposit', verifyAdminToken, async (req, res) => {
    try {
        const { depositId, action, adminNotes } = req.body;
        const dateTime = getCurrentDateTime();

        if (!depositId) return res.status(400).json({ success: false, message: 'Please Provide Deposit ID.' });
        if (!action || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Invalid Action.' });
        }

        const deposit = await Deposit.findById(depositId).populate('userId');
        if (!deposit) return res.status(404).json({ success: false, message: `Deposit "${depositId}" Not Found.` });

        if (deposit.status !== 'pending' && deposit.status !== 'pending_approval') {
            return res.status(400).json({ success: false, message: `Status Is "${deposit.status}".` });
        }

        if (action === 'approve') {
            deposit.status = 'approved';
            deposit.approvedBy = req.user.adminId || req.user.fullName;
            deposit.approvedAt = new Date();
            deposit.adminNote = adminNotes || 'Approved By Admin';

            const user = await User.findById(deposit.userId._id);
            const oldBalance = user.balance;
            user.balance += deposit.amount;
            await user.save();

            const timestamp = Date.now().toString(36).toUpperCase();
            const random = Math.random().toString(36).substring(2, 8).toUpperCase();
            const tx_id = `TXN_DEPOSIT_${timestamp}_${random}`;

            await Transaction.create({
                tx_id,
                user_id: deposit.userId._id,
                sender_id: deposit.userId._id,
                receiver_id: deposit.userId._id,
                amount: deposit.amount,
                type: 'deposit',
                status: 'success',
                remark: 'Manual deposit approved by admin',
                description: `Deposit ${deposit.depositId} approved - UTR: ${deposit.transactionRef || 'N/A'}`,
                metadata: {
                    depositId: deposit.depositId,
                    transactionRef: deposit.transactionRef,
                    type: 'admin_approved',
                    approvedBy: req.user.fullName || 'Admin',
                    oldBalance, newBalance: user.balance
                }
            });

            await notifyAdmin(
`Deposit Approved

Name: ${deposit.userId.fullName}
Amount: ₹${deposit.amount}
UTR: ${deposit.transactionRef || 'N/A'}
By: ${req.user.fullName}
Time: ${dateTime}`
            );

            if (deposit.userId.telegramId && BOT_TOKEN) {
                await sendTelegramMessage(deposit.userId.telegramId,
`Deposit Approved!

Amount: ₹${deposit.amount}
New Balance: ₹${user.balance}
Time: ${dateTime}`
                );
            }
        } else {
            deposit.status = 'rejected';
            deposit.rejectedBy = req.user.adminId || req.user.fullName;
            deposit.rejectedAt = new Date();
            deposit.adminNote = adminNotes || 'Rejected By Admin';

            await notifyAdmin(
`Deposit Rejected

Name: ${deposit.userId.fullName}
Amount: ₹${deposit.amount}
Reason: ${adminNotes || 'Rejected By Admin'}
By: ${req.user.fullName}
Time: ${dateTime}`
            );

            if (deposit.userId.telegramId && BOT_TOKEN) {
                await sendTelegramMessage(deposit.userId.telegramId,
`Deposit Rejected

Amount: ₹${deposit.amount}
Reason: ${adminNotes || 'Rejected By Admin'}
Time: ${dateTime}`
                );
            }
        }

        await deposit.save();

        res.json({
            success: true,
            message: `Deposit ${action === 'approve' ? 'Approved' : 'Rejected'} Successfully.`,
            deposit: {
                id: deposit._id, depositId: deposit.depositId,
                status: deposit.status, amount: deposit.amount, adminNote: deposit.adminNote
            }
        });
    } catch (error) {
        console.error('Verify deposit error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Verify Deposit: ' + error.message });
    }
});

// ============================================
// LIFAFA MANAGEMENT
// ============================================
router.get('/lifafas', verifyAdminToken, async (req, res) => {
    try {
        const { search, page = 1, limit = 20 } = req.query;
        let query = {};

        if (search) {
            query = {
                $or: [
                    { title: { $regex: search, $options: 'i' } },
                    { description: { $regex: search, $options: 'i' } }
                ]
            };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const lifafas = await Lifafa.find(query)
            .populate('userId', 'fullName mobile')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Lifafa.countDocuments(query);

        res.json({
            success: true,
            lifafas,
            pagination: {
                total, page: parseInt(page), limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed To Fetch Lifafas.' });
    }
});

router.delete('/delete-lifafa/:id', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        const lifafa = await Lifafa.findById(id);
        if (!lifafa) return res.status(404).json({ success: false, message: `Lifafa "${id}" Not Found.` });
        await Lifafa.findByIdAndDelete(id);
        res.json({ success: true, message: `Lifafa "${lifafa.title}" Deleted.` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed To Delete Lifafa.' });
    }
});

// ============================================
// GIFT MANAGEMENT
// ============================================
router.get('/gifts', verifyAdminToken, async (req, res) => {
    try {
        const { search, page = 1, limit = 20 } = req.query;
        let query = {};

        if (search) {
            query = {
                $or: [
                    { code: { $regex: search, $options: 'i' } },
                    { description: { $regex: search, $options: 'i' } }
                ]
            };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const gifts = await Gift.find(query)
            .populate('userId', 'fullName mobile')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Gift.countDocuments(query);

        res.json({
            success: true,
            gifts,
            pagination: {
                total, page: parseInt(page), limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed To Fetch Gifts.' });
    }
});

router.delete('/delete-gift/:id', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        const gift = await Gift.findById(id);
        if (!gift) return res.status(404).json({ success: false, message: `Gift "${id}" Not Found.` });
        await Gift.findByIdAndDelete(id);
        res.json({ success: true, message: `Gift Code "${gift.code}" Deleted.` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed To Delete Gift.' });
    }
});

// ============================================
// ADMIN: GET ANY USER'S TRANSACTION DETAILS
// ============================================
router.get('/transaction/:txnId', verifyAdminToken, async (req, res) => {
    try {
        const { txnId } = req.params;
        if (!txnId) return res.status(400).json({ success: false, message: 'Transaction ID is required' });

        let transaction = await Transaction.findOne({ tx_id: txnId })
            .populate('sender_id', 'fullName mobile walletId')
            .populate('receiver_id', 'fullName mobile walletId')
            .populate('user_id', 'fullName mobile walletId');

        if (!transaction && mongoose.Types.ObjectId.isValid(txnId)) {
            transaction = await Transaction.findById(txnId)
                .populate('sender_id', 'fullName mobile walletId')
                .populate('receiver_id', 'fullName mobile walletId')
                .populate('user_id', 'fullName mobile walletId');
        }

        if (!transaction) {
            return res.status(404).json({ success: false, message: `Transaction "${txnId}" not found` });
        }

        const txObj = transaction.toObject();
        let isCredit = false;
        let counterparty = null;
        let userRole = 'unknown';

        const userId = txObj.user_id?._id?.toString() || txObj.user_id?.toString() || null;
        const senderId = txObj.sender_id?._id?.toString() || txObj.sender_id?.toString() || null;
        const receiverId = txObj.receiver_id?._id?.toString() || txObj.receiver_id?.toString() || null;

        if (userId && senderId && userId === senderId) {
            userRole = 'sender'; isCredit = false; counterparty = txObj.receiver_id;
        } else if (userId && receiverId && userId === receiverId) {
            userRole = 'receiver'; isCredit = true; counterparty = txObj.sender_id;
        } else if (senderId && receiverId) {
            if (['deposit', 'admin_add', 'game_win', 'lifafa_claim', 'lifafa_referral'].includes(txObj.type)) {
                isCredit = true; counterparty = txObj.sender_id;
            } else if (['withdraw', 'admin_deduct', 'game_loss', 'lifafa_creation'].includes(txObj.type)) {
                isCredit = false; counterparty = txObj.receiver_id;
            }
        }

        const typeLabels = {
            'deposit': 'Deposit', 'auto-deposit': 'Auto Deposit',
            'web-deposit': 'Webhook Deposit', 'manual-deposit': 'Manual Deposit',
            'withdraw': 'Withdrawal', 'transfer': 'Transfer',
            'transfer_send': 'Transfer Sent', 'transfer_receive': 'Transfer Received',
            'api': 'API Payment', 'lifafa_creation': 'Lifafa Creation',
            'lifafa_claim': 'Lifafa Claim', 'lifafa_referral': 'Lifafa Referral',
            'game_win': 'Game Win', 'game_loss': 'Game Loss',
            'gift': 'Gift', 'admin_add': 'Admin Add', 'admin_deduct': 'Admin Deduct'
        };

        const response = {
            _id: txObj._id,
            tx_id: txObj.tx_id,
            user_id: txObj.user_id,
            sender_id: txObj.sender_id,
            receiver_id: txObj.receiver_id,
            amount: txObj.amount || 0,
            fee: txObj.fee || 0,
            type: txObj.type,
            typeLabel: typeLabels[txObj.type] || txObj.type,
            status: txObj.status || 'success',
            remark: txObj.remark || '',
            description: txObj.description || '',
            tx_time: txObj.tx_time,
            createdAt: txObj.createdAt,
            updatedAt: txObj.updatedAt,
            metadata: txObj.metadata || {},
            isCredit, userRole, counterparty,
            formattedAmount: `₹${(txObj.amount || 0).toFixed(2)}`
        };

        res.json({ success: true, transaction: response });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch transaction: ' + error.message });
    }
});

// ============================================
// ADMIN: GET USER TRANSACTIONS WITH FILTERS
// ============================================
router.get('/user-transactions/:userId', verifyAdminToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 1, limit = 25, type, status, fromDate, toDate } = req.query;

        if (!userId) return res.status(400).json({ success: false, message: 'User ID is required' });

        const user = await User.findById(userId).select('fullName mobile walletId balance isBlocked isAdmin isDeleted isActive');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        let query = {
            $or: [{ sender_id: userId }, { receiver_id: userId }, { user_id: userId }]
        };

        if (type && type !== 'all') query.type = type;
        if (status && status !== 'all') query.status = status;

        if (fromDate) {
            const from = new Date(fromDate);
            from.setHours(0, 0, 0, 0);
            query.tx_time = { $gte: from };
        }
        if (toDate) {
            const to = new Date(toDate);
            to.setHours(23, 59, 59, 999);
            if (query.tx_time) query.tx_time.$lte = to;
            else query.tx_time = { $lte: to };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const transactions = await Transaction.find(query)
            .populate('sender_id', 'fullName mobile walletId')
            .populate('receiver_id', 'fullName mobile walletId')
            .populate('user_id', 'fullName mobile walletId')
            .sort({ tx_time: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Transaction.countDocuments(query);

        let totalCredit = 0, totalDebit = 0;
        transactions.forEach(tx => {
            const amount = tx.amount || 0;
            const receiverId = tx.receiver_id?._id?.toString() || tx.receiver_id?.toString() || '';
            const userIdStr = userId.toString();
            const isCredit = receiverId === userIdStr ||
                ['deposit', 'admin_add', 'game_win', 'lifafa_claim', 'lifafa_referral'].includes(tx.type);
            if (isCredit) totalCredit += amount;
            else totalDebit += amount;
        });

        res.json({
            success: true,
            user,
            transactions,
            stats: {
                total,
                totalCredit,
                totalDebit,
                currentBalance: user.balance || 0
            },
            pagination: {
                total, page: parseInt(page), limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch transactions: ' + error.message });
    }
});

module.exports = router;
