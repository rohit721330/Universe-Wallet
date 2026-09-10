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
const { auth } = require('../middleware/auth');
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
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
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
        const data = JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        });
        
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
        
        request.on('error', (error) => {
            resolve({ success: false, error: error.message });
        });
        
        request.write(data);
        request.end();
    });
}

async function notifyAdmin(message) {
    try {
        if (!ADMIN_TG_ID) {
            console.warn('ADMIN_TG_ID not configured');
            return;
        }
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
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'No Token Provided. Please Login To Access This Resource.' 
            });
        }
        
        if (token.startsWith('Admin_')) {
            req.user = { 
                isAdmin: true, 
                fullName: 'Admin',
                tokenType: 'admin_token'
            };
            return next();
        }
        
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.isAdmin) {
                req.user = { 
                    isAdmin: true, 
                    fullName: decoded.fullName || 'Admin',
                    tokenType: 'jwt',
                    ...decoded
                };
                return next();
            } else {
                return res.status(403).json({ 
                    success: false, 
                    message: 'Access Denied. This Resource Is Restricted To Admins Only.' 
                });
            }
        } catch (jwtError) {
            if (jwtError.name === 'JsonWebTokenError') {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Invalid Token Format. Please Login Again.' 
                });
            }
            if (jwtError.name === 'TokenExpiredError') {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Token Has Expired. Please Login Again To Refresh Your Session.' 
                });
            }
            return res.status(401).json({ 
                success: false, 
                message: 'Authentication Failed. Please Provide A Valid Token.' 
            });
        }
        
    } catch (error) {
        console.error('Token Verification Error:', error.message);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal Server Error During Authentication. Please Try Again Later.' 
        });
    }
}

// ============================================
// ADMIN LOGIN
// ============================================
router.post('/login', async (req, res) => {
    try {
        const { pattern } = req.body;
        
        if (!pattern) {
            return res.status(400).json({
                success: false,
                message: 'Please Provide The Pattern Lock To Login.'
            });
        }
        
        if (!/^[0-9]{6}$/.test(pattern)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Pattern Format. Please Enter Exactly 6 Digits.'
            });
        }
        
        if (pattern !== ADMIN_PATTERN) {
            const dateTime = getCurrentDateTime();
            await notifyAdmin(
`Admin Login Failed

Time: ${dateTime}
Pattern: ${pattern}`
            );
            
            return res.status(401).json({
                success: false,
                message: 'Incorrect Pattern Lock. Please Try Again.'
            });
        }
        
        const token = 'Admin_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
        
        const dateTime = getCurrentDateTime();
        await notifyAdmin(
`Admin Login Success

Time: ${dateTime}`
        );
        
        return res.json({
            success: true,
            message: 'Admin Login Successful.',
            token: token,
            isAdmin: true
        });
        
    } catch (error) {
        console.error('Admin login error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Server Error During Login. Please Try Again Later.'
        });
    }
});

// ============================================
// CHANGE ADMIN PATTERN
// ============================================
router.put('/change-pattern', verifyAdminToken, async (req, res) => {
    try {
        const { currentPattern, newPattern } = req.body;
        
        if (!currentPattern || !newPattern) {
            return res.status(400).json({
                success: false,
                message: 'Please Provide Both Current And New Pattern.'
            });
        }
        
        if (!/^[0-9]{6}$/.test(currentPattern) || !/^[0-9]{6}$/.test(newPattern)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Pattern Format. Must Be Exactly 6 Digits.'
            });
        }
        
        if (currentPattern !== ADMIN_PATTERN) {
            return res.status(401).json({
                success: false,
                message: 'Current Pattern Is Incorrect.'
            });
        }
        
        return res.status(501).json({
            success: false,
            message: 'Pattern Change Requires Database Storage. Please Contact Developer.'
        });
        
    } catch (error) {
        console.error('Change pattern error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Change Pattern Lock.'
        });
    }
});

// ============================================
// DASHBOARD STATS
// ============================================
router.get('/stats', verifyAdminToken, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
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
                totalUsers,
                approvedDeposits,
                pendingDeposits,
                rejectedDeposits,
                totalVolume,
                totalWithdrawals,
                pendingWithdrawals,
                completedWithdrawals,
                totalWithdrawn,
                totalLifafas,
                totalGifts
            },
            recentTransactions
        });
    } catch (error) {
        console.error('Stats error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch Dashboard Statistics.'
        });
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
                return res.status(400).json({
                    success: false,
                    message: `Invalid Transaction Type: "${type}".`
                });
            }
            query.type = type;
        }
        
        if (status) {
            if (!['pending', 'success', 'failed', 'cancelled'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid Status: "${status}".`
                });
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
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get transactions error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch Transactions.'
        });
    }
});

router.get('/search-transaction', verifyAdminToken, async (req, res) => {
    try {
        const { query } = req.query;
        
        if (!query || query.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Please Provide A Transaction ID Or UTR Number.'
            });
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
            return res.status(404).json({
                success: false,
                message: `No Transaction Found With: "${query}".`
            });
        }
        
        res.json({ success: true, transaction });
    } catch (error) {
        console.error('Search transaction error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Search Transaction.'
        });
    }
});

// ============================================
// USER MANAGEMENT
// ============================================
router.get('/user/:identifier', verifyAdminToken, async (req, res) => {
    try {
        const { identifier } = req.params;
        
        if (!identifier || identifier.trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Please Provide A Valid User ID, Mobile Number, Or Wallet ID.'
            });
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
                user = await User.findOne({ walletId: walletId }).select('-password -pin -__v');
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
            return res.status(404).json({
                success: false,
                message: `User With "${identifier}" Not Found.`
            });
        }

        console.log(`User found by ${searchBy}: ${user.fullName} (${user.mobile})`);

        const transactions = await Transaction.find({
            $or: [
                { sender_id: user._id },
                { receiver_id: user._id },
                { user_id: user._id }
            ]
        })
        .populate('sender_id', 'fullName mobile walletId')
        .populate('receiver_id', 'fullName mobile walletId')
        .populate('user_id', 'fullName mobile walletId')
        .sort({ createdAt: -1 })
        .limit(100);
        
        const deposits = await Deposit.find({ userId: user._id })
            .sort({ createdAt: -1 })
            .limit(20);
            
        const withdrawals = await Withdrawal.find({ userId: user._id })
            .sort({ createdAt: -1 })
            .limit(20);
        
        res.json({ 
            success: true, 
            user,
            transactions,
            deposits,
            withdrawals,
            searchBy
        });
    } catch (error) {
        console.error('Get user error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch User Details: ' + error.message
        });
    }
});

router.get('/users', verifyAdminToken, async (req, res) => {
    try {
        const { search, page = 1, limit = 20 } = req.query;
        let query = {};
        
        if (search) {
            query = {
                $or: [
                    { fullName: { $regex: search, $options: 'i' } },
                    { mobile: { $regex: search, $options: 'i' } },
                    { walletId: { $regex: search, $options: 'i' } },
                    { username: { $regex: search, $options: 'i' } }
                ]
            };
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
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get users error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch Users.'
        });
    }
});

router.put('/update-user/:userId', verifyAdminToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const { fullName, username, mobile, telegramId, balance, pin } = req.body;
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: `User With ID "${userId}" Not Found.`
            });
        }
        
        if (fullName) {
            if (fullName.length < 2) {
                return res.status(400).json({
                    success: false,
                    message: 'Full Name Must Be At Least 2 Characters.'
                });
            }
            user.fullName = fullName;
        }
        
        if (username) {
            if (username.length < 3) {
                return res.status(400).json({
                    success: false,
                    message: 'Username Must Be At Least 3 Characters.'
                });
            }
            const existingUser = await User.findOne({ username, _id: { $ne: userId } });
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: `Username "${username}" Is Already Taken.`
                });
            }
            user.username = username;
        }
        
        if (mobile) {
            if (!/^[0-9]{10}$/.test(mobile)) {
                return res.status(400).json({
                    success: false,
                    message: 'Mobile Number Must Be Exactly 10 Digits.'
                });
            }
            const existingUser = await User.findOne({ mobile, _id: { $ne: userId } });
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: `Mobile Number "${mobile}" Is Already Registered.`
                });
            }
            user.mobile = mobile;
        }
        
        if (telegramId) user.telegramId = telegramId;
        
        if (balance !== undefined) {
            const parsedBalance = parseFloat(balance);
            if (isNaN(parsedBalance) || parsedBalance < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Balance Must Be A Valid Positive Number.'
                });
            }
            user.balance = parsedBalance;
        }
        
        if (pin) {
            if (!/^[0-9]{4}$/.test(pin)) {
                return res.status(400).json({
                    success: false,
                    message: 'PIN Must Be Exactly 4 Digits.'
                });
            }
            user.pin = pin;
        }
        
        await user.save();
        
        res.json({
            success: true,
            message: 'User Updated Successfully.',
            user
        });
    } catch (error) {
        console.error('Update user error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Update User.'
        });
    }
});

router.post('/toggle-block', verifyAdminToken, async (req, res) => {
    try {
        const { userId } = req.body;
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'Please Provide A Valid User ID.'
            });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: `User With ID "${userId}" Not Found.`
            });
        }
        
        user.isBlocked = !user.isBlocked;
        await user.save();
        
        if (user.telegramId && BOT_TOKEN) {
            const status = user.isBlocked ? 'Blocked' : 'Unblocked';
            await sendTelegramMessage(user.telegramId,
`Account ${status}

Name: ${user.fullName}
Mobile: ${user.mobile}
Time: ${getCurrentDateTime()}`
            );
        }
        
        res.json({
            success: true,
            message: `User "${user.fullName}" Has Been ${user.isBlocked ? 'Blocked' : 'Unblocked'}.`,
            isBlocked: user.isBlocked
        });
    } catch (error) {
        console.error('Toggle block error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Toggle Block Status.'
        });
    }
});

router.delete('/delete-user/:userId', verifyAdminToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const dateTime = getCurrentDateTime();
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'Please Provide A Valid User ID.'
            });
        }
        
        const userToDelete = await User.findById(userId);
        if (!userToDelete) {
            return res.status(404).json({
                success: false,
                message: `User With ID "${userId}" Not Found.`
            });
        }
        
        if (userToDelete.isAdmin) {
            return res.status(400).json({
                success: false,
                message: 'Cannot Delete Admin Account.'
            });
        }
        
        const userData = {
            fullName: userToDelete.fullName,
            mobile: userToDelete.mobile,
            walletId: userToDelete.walletId,
            telegramId: userToDelete.telegramId,
            balance: userToDelete.balance
        };
        
        await Transaction.deleteMany({
            $or: [{ sender_id: userId }, { receiver_id: userId }, { user_id: userId }]
        });
        await Deposit.deleteMany({ userId });
        await Withdrawal.deleteMany({ userId });
        await Lifafa.deleteMany({ userId });
        await Gift.deleteMany({ userId });
        await User.findByIdAndDelete(userId);
        
        if (userData.telegramId) {
            await sendTelegramMessage(userData.telegramId,
`Account Deleted

Name: ${userData.fullName}
Mobile: ${userData.mobile}
Balance: ₹${userData.balance}
Time: ${dateTime}`
            );
        }
        
        res.json({
            success: true,
            message: `User "${userData.fullName}" Deleted Successfully.`
        });
    } catch (error) {
        console.error('Delete user error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Delete User.'
        });
    }
});

// ============================================
// ADJUST BALANCE
// ============================================
router.post('/adjust-balance', verifyAdminToken, async (req, res) => {
    try {
        const { userId, amount, type, reason } = req.body;
        const dateTime = getCurrentDateTime();
        
        console.log('Adjust Balance:', { userId, amount, type });
        
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'Please Provide A Valid User ID.'
            });
        }
        
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Please Provide A Valid Amount Greater Than 0.'
            });
        }
        
        if (!type || !['add', 'deduct'].includes(type)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Operation. Must Be "add" Or "deduct".'
            });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: `User With ID "${userId}" Not Found.`
            });
        }
        
        const amountNum = parseFloat(amount);
        
        if (type === 'deduct' && user.balance < amountNum) {
            return res.status(400).json({
                success: false,
                message: `Insufficient Balance. Current: ₹${user.balance}`
            });
        }
        
        const finalAmount = type === 'add' ? amountNum : -amountNum;
        user.balance += finalAmount;
        await user.save();
        
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.floor(Math.random() * 99999).toString().padStart(5, '0');
        const tx_id = `TXN${timestamp}${random}`;
        
        const transactionType = type === 'add' ? 'admin_add' : 'admin_deduct';
        const transaction = new Transaction({
            tx_id: tx_id,
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
Reason: ${reason || 'N/A'}`
            );
        }
        
        res.json({
            success: true,
            message: `Balance ${type === 'add' ? 'Added' : 'Deducted'}. New: ₹${user.balance}.`,
            newBalance: user.balance,
            transaction: {
                id: transaction._id,
                tx_id: transaction.tx_id,
                amount: transaction.amount,
                type: transaction.type,
                status: transaction.status
            }
        });
        
    } catch (error) {
        console.error('Adjust Balance Error:', error.message);
        
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'Duplicate Transaction ID. Please Try Again.'
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Failed To Adjust Balance.'
        });
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
                return res.status(400).json({
                    success: false,
                    message: `Invalid Status: "${status}".`
                });
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
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get deposits error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch Deposits.'
        });
    }
});

router.post('/verify-deposit', verifyAdminToken, async (req, res) => {
    try {
        const { depositId, action, adminNotes } = req.body;
        const dateTime = getCurrentDateTime();
        
        if (!depositId) {
            return res.status(400).json({
                success: false,
                message: 'Please Provide A Valid Deposit ID.'
            });
        }
        
        if (!action || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Action. Must Be "approve" Or "reject".'
            });
        }
        
        const deposit = await Deposit.findById(depositId).populate('userId');
        if (!deposit) {
            return res.status(404).json({
                success: false,
                message: `Deposit With ID "${depositId}" Not Found.`
            });
        }
        
        if (deposit.status !== 'pending' && deposit.status !== 'pending_approval') {
            return res.status(400).json({
                success: false,
                message: `Deposit Status Is "${deposit.status}". Only Pending Or Pending Approval Deposits Can Be Verified.`
            });
        }
        
        if (action === 'approve') {
            deposit.status = 'approved';
            deposit.approvedBy = req.user._id || req.user.fullName;
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
                tx_id: tx_id,
                user_id: deposit.userId._id,
                sender_id: deposit.userId._id,
                receiver_id: deposit.userId._id,
                amount: deposit.amount,
                type: 'deposit',
                status: 'success',
                remark: 'Manual deposit approved by admin',
                description: `Deposit ${deposit.depositId} approved by admin - UTR: ${deposit.transactionRef || 'N/A'}`,
                metadata: {
                    depositId: deposit.depositId,
                    transactionRef: deposit.transactionRef,
                    type: 'admin_approved',
                    approvedBy: req.user.fullName || 'Admin',
                    oldBalance: oldBalance,
                    newBalance: user.balance
                }
            });
            
            await notifyAdmin(
`Deposit Approved

Name: ${deposit.userId.fullName}
Amount: ₹${deposit.amount}
Deposit ID: ${deposit.depositId}
UTR: ${deposit.transactionRef || 'N/A'}
New Balance: ₹${user.balance}
Time: ${dateTime}`
            );
            
            if (deposit.userId.telegramId && BOT_TOKEN) {
                await sendTelegramMessage(deposit.userId.telegramId,
`Deposit Approved!

Amount: ₹${deposit.amount}
Deposit ID: ${deposit.depositId}
New Balance: ₹${user.balance}
Time: ${dateTime}`
                );
            }
            
        } else {
            deposit.status = 'rejected';
            deposit.rejectedBy = req.user._id || req.user.fullName;
            deposit.rejectedAt = new Date();
            deposit.adminNote = adminNotes || 'Rejected By Admin';
            
            await notifyAdmin(
`Deposit Rejected

Name: ${deposit.userId.fullName}
Amount: ₹${deposit.amount}
Deposit ID: ${deposit.depositId}
UTR: ${deposit.transactionRef || 'N/A'}
Reason: ${adminNotes || 'Rejected By Admin'}
Time: ${dateTime}`
            );
            
            if (deposit.userId.telegramId && BOT_TOKEN) {
                await sendTelegramMessage(deposit.userId.telegramId,
`Deposit Rejected

Amount: ₹${deposit.amount}
Deposit ID: ${deposit.depositId}
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
                id: deposit._id,
                depositId: deposit.depositId,
                status: deposit.status,
                amount: deposit.amount,
                adminNote: deposit.adminNote
            }
        });
    } catch (error) {
        console.error('Verify deposit error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Verify Deposit: ' + error.message
        });
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
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get lifafas error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch Lifafas.'
        });
    }
});

router.delete('/delete-lifafa/:id', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        const lifafa = await Lifafa.findById(id);
        if (!lifafa) {
            return res.status(404).json({
                success: false,
                message: `Lifafa With ID "${id}" Not Found.`
            });
        }
        
        await Lifafa.findByIdAndDelete(id);
        
        res.json({
            success: true,
            message: `Lifafa "${lifafa.title}" Deleted.`
        });
    } catch (error) {
        console.error('Delete lifafa error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Delete Lifafa.'
        });
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
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get gifts error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch Gifts.'
        });
    }
});

router.delete('/delete-gift/:id', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        const gift = await Gift.findById(id);
        if (!gift) {
            return res.status(404).json({
                success: false,
                message: `Gift With ID "${id}" Not Found.`
            });
        }
        
        await Gift.findByIdAndDelete(id);
        
        res.json({
            success: true,
            message: `Gift Code "${gift.code}" Deleted.`
        });
    } catch (error) {
        console.error('Delete gift error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Delete Gift.'
        });
    }
});

// ============================================
// ADMIN: GET ANY USER'S TRANSACTION DETAILS
// ============================================
router.get('/transaction/:txnId', verifyAdminToken, async (req, res) => {
    try {
        const { txnId } = req.params;

        if (!txnId) {
            return res.status(400).json({
                success: false,
                message: 'Transaction ID is required'
            });
        }

        console.log('Admin fetching transaction:', txnId);

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
            return res.status(404).json({
                success: false,
                message: `Transaction "${txnId}" not found`
            });
        }

        const txObj = transaction.toObject();

        let isCredit = false;
        let counterparty = null;
        let userRole = 'unknown';

        const userId = txObj.user_id?._id?.toString() || txObj.user_id?.toString() || null;
        const senderId = txObj.sender_id?._id?.toString() || txObj.sender_id?.toString() || null;
        const receiverId = txObj.receiver_id?._id?.toString() || txObj.receiver_id?.toString() || null;

        if (userId && senderId && userId === senderId) {
            userRole = 'sender';
            isCredit = false;
            counterparty = txObj.receiver_id;
        } else if (userId && receiverId && userId === receiverId) {
            userRole = 'receiver';
            isCredit = true;
            counterparty = txObj.sender_id;
        } else if (senderId && receiverId) {
            if (txObj.type === 'deposit' || txObj.type === 'admin_add' || 
                txObj.type === 'game_win' || txObj.type === 'lifafa_claim' ||
                txObj.type === 'lifafa_referral') {
                isCredit = true;
                counterparty = txObj.sender_id;
            } else if (txObj.type === 'withdraw' || txObj.type === 'admin_deduct' || 
                       txObj.type === 'game_loss' || txObj.type === 'lifafa_creation') {
                isCredit = false;
                counterparty = txObj.receiver_id;
            }
        }

        const typeLabels = {
            'deposit': 'Deposit',
            'auto-deposit': 'Auto Deposit',
            'web-deposit': 'Webhook Deposit',
            'manual-deposit': 'Manual Deposit',
            'withdraw': 'Withdrawal',
            'transfer': 'Transfer',
            'transfer_send': 'Transfer Sent',
            'transfer_receive': 'Transfer Received',
            'api': 'API Payment',
            'lifafa_creation': 'Lifafa Creation',
            'lifafa_claim': 'Lifafa Claim',
            'lifafa_referral': 'Lifafa Referral',
            'game_win': 'Game Win',
            'game_loss': 'Game Loss',
            'gift': 'Gift',
            'admin_add': 'Admin Add',
            'admin_deduct': 'Admin Deduct'
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
            isCredit: isCredit,
            userRole: userRole,
            counterparty: counterparty,
            formattedAmount: `₹${(txObj.amount || 0).toFixed(2)}`
        };

        console.log('Transaction found:', response.tx_id);

        res.json({
            success: true,
            transaction: response
        });

    } catch (error) {
        console.error('Admin get transaction error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch transaction: ' + error.message
        });
    }
});

// ============================================
// ADMIN: GET USER TRANSACTIONS WITH FILTERS
// ============================================
router.get('/user-transactions/:userId', verifyAdminToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const { page = 1, limit = 25, type, status, fromDate, toDate } = req.query;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        const user = await User.findById(userId).select('fullName mobile walletId balance isBlocked isAdmin');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        let query = {
            $or: [
                { sender_id: userId },
                { receiver_id: userId },
                { user_id: userId }
            ]
        };

        if (type && type !== 'all') {
            query.type = type;
        }

        if (status && status !== 'all') {
            query.status = status;
        }

        if (fromDate) {
            const from = new Date(fromDate);
            from.setHours(0, 0, 0, 0);
            query.tx_time = { $gte: from };
        }

        if (toDate) {
            const to = new Date(toDate);
            to.setHours(23, 59, 59, 999);
            if (query.tx_time) {
                query.tx_time.$lte = to;
            } else {
                query.tx_time = { $lte: to };
            }
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
            const senderId = tx.sender_id?._id?.toString() || tx.sender_id?.toString() || '';
            const receiverId = tx.receiver_id?._id?.toString() || tx.receiver_id?.toString() || '';
            const userIdStr = userId.toString();

            const isCredit = receiverId === userIdStr || 
                            (tx.type === 'deposit' || tx.type === 'admin_add' || 
                             tx.type === 'game_win' || tx.type === 'lifafa_claim' ||
                             tx.type === 'lifafa_referral');
            
            if (isCredit) totalCredit += amount;
            else totalDebit += amount;
        });

        res.json({
            success: true,
            user: user,
            transactions: transactions,
            stats: {
                total: total,
                totalCredit: totalCredit,
                totalDebit: totalDebit,
                currentBalance: user.balance || 0
            },
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });

    } catch (error) {
        console.error('Get user transactions error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch transactions: ' + error.message
        });
    }
});

module.exports = router;
