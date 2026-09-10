// FILE: routes/lifafa-mgmt.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Lifafa = require('../models/Lifafa');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID;
const ADMIN_WALLET_ID = process.env.ADMIN_WALLET_ID;

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
// GET ADMIN USER BY WALLET ID
// ============================================
async function getAdminUser() {
    if (!ADMIN_WALLET_ID) {
        throw new Error('ADMIN_WALLET_ID not configured in environment variables');
    }
    
    const adminUser = await User.findOne({ walletId: ADMIN_WALLET_ID });
    if (!adminUser) {
        throw new Error(`Admin user with wallet ID "${ADMIN_WALLET_ID}" not found`);
    }
    
    return adminUser;
}

// ============================================
// MIDDLEWARE: Verify Admin Token
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
            req.user = { isAdmin: true, fullName: 'Admin', tokenType: 'admin_token' };
            return next();
        }
        
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.isAdmin) {
                req.user = { isAdmin: true, fullName: decoded.fullName || 'Admin', tokenType: 'jwt', ...decoded };
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
                    message: 'Token Has Expired. Please Login Again.' 
                });
            }
            return res.status(401).json({ 
                success: false, 
                message: 'Authentication Failed.' 
            });
        }
    } catch (error) {
        console.error('Token Verification Error:', error.message);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal Server Error.' 
        });
    }
}

// ============================================
// GENERATE UNIQUE LIFAFA ID
// ============================================
function generateLifafaId() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `LF${timestamp}${random}`;
}

// ============================================
// GET ALL LIFAFAS
// ============================================
router.get('/', verifyAdminToken, async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        let query = {};
        
        if (status && ['active', 'completed', 'expired', 'cancelled'].includes(status)) {
            query.status = status;
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const lifafas = await Lifafa.find(query)
            .populate('userId', 'fullName mobile walletId username')
            .populate('claimedUsers.userId', 'fullName mobile walletId username')
            .populate('claimedUsers.referrerId', 'fullName mobile walletId username')
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
        console.error('Get Lifafas Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch Lifafas.'
        });
    }
});

// ============================================
// GET LIFAFA STATS
// ============================================
router.get('/stats', verifyAdminToken, async (req, res) => {
    try {
        const total = await Lifafa.countDocuments();
        const active = await Lifafa.countDocuments({ status: 'active' });
        const completed = await Lifafa.countDocuments({ status: 'completed' });
        const expired = await Lifafa.countDocuments({ status: 'expired' });
        const cancelled = await Lifafa.countDocuments({ status: 'cancelled' });
        
        const allLifafas = await Lifafa.find({ status: 'completed' });
        const totalDistributed = allLifafas.reduce((sum, l) => sum + l.totalAmount, 0);
        
        const allActiveLifafas = await Lifafa.find();
        const totalClaims = allActiveLifafas.reduce((sum, l) => sum + l.claimedUsers.length, 0);
        
        res.json({
            success: true,
            total,
            active,
            completed,
            expired,
            cancelled,
            totalDistributed,
            totalClaims
        });
    } catch (error) {
        console.error('Get Lifafa Stats Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch Statistics.'
        });
    }
});

// ============================================
// GET SINGLE LIFAFA BY ID
// ============================================
router.get('/:id', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Lifafa ID Format.'
            });
        }
        
        const lifafa = await Lifafa.findById(id)
            .populate('userId', 'fullName mobile walletId username telegramId')
            .populate('claimedUsers.userId', 'fullName mobile walletId username telegramId')
            .populate('claimedUsers.referrerId', 'fullName mobile walletId username telegramId');
        
        if (!lifafa) {
            return res.status(404).json({
                success: false,
                message: `Lifafa With ID "${id}" Not Found.`
            });
        }
        
        res.json({
            success: true,
            lifafa
        });
    } catch (error) {
        console.error('Get Lifafa Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch Lifafa.'
        });
    }
});

// ============================================
// GET LIFAFA BY CODE
// ============================================
router.get('/code/:code', verifyAdminToken, async (req, res) => {
    try {
        const { code } = req.params;
        
        const lifafa = await Lifafa.findOne({ lifafaId: code.toUpperCase() })
            .populate('userId', 'fullName mobile walletId username telegramId')
            .populate('claimedUsers.userId', 'fullName mobile walletId username telegramId')
            .populate('claimedUsers.referrerId', 'fullName mobile walletId username telegramId');
        
        if (!lifafa) {
            return res.status(404).json({
                success: false,
                message: `Lifafa With Code "${code}" Not Found.`
            });
        }
        
        res.json({
            success: true,
            lifafa
        });
    } catch (error) {
        console.error('Get Lifafa By Code Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch Lifafa.'
        });
    }
});

// ============================================
// CREATE LIFAFA - USING ADMIN WALLET ID
// ============================================
router.post('/create', verifyAdminToken, async (req, res) => {
    try {
        const {
            title,
            type = 'normal',
            totalUsers,
            perUser,
            comment = '',
            redirectLink = '',
            accessCode = null,
            specialUsers = null,
            channels = [],
            referAmount = 0,
            referComment = '',
            youtubeVideo = '',
            requireRefer = false,
            requireVerify = true,
            requireYoutube = false,
            requireChannel = false,
            requireType = true
        } = req.body;
        
        const dateTime = getCurrentDateTime();
        
        // ─── Get Admin User ───
        let adminUser;
        try {
            adminUser = await getAdminUser();
        } catch (error) {
            return res.status(404).json({
                success: false,
                message: error.message
            });
        }
        
        // ─── Validation ───
        if (!title || title.trim().length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Title Must Be At Least 2 Characters Long.'
            });
        }
        
        if (!totalUsers || totalUsers < 1) {
            return res.status(400).json({
                success: false,
                message: 'Total Users Must Be At Least 1.'
            });
        }
        
        if (!perUser || perUser <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Per User Amount Must Be Greater Than 0.'
            });
        }
        
        // ─── Check If Admin Has Enough Balance ───
        const totalAmount = totalUsers * perUser;
        if (adminUser.balance < totalAmount) {
            return res.status(400).json({
                success: false,
                message: `Insufficient Balance. Needed: ₹${totalAmount.toFixed(2)}, Available: ₹${adminUser.balance.toFixed(2)}`
            });
        }
        
        // ─── Deduct Balance From Admin ───
        adminUser.balance -= totalAmount;
        await adminUser.save();
        
        // ─── Generate Lifafa ID ───
        const lifafaId = generateLifafaId();
        
        // ─── Create Lifafa ───
        const lifafa = new Lifafa({
            lifafaId,
            userId: adminUser._id,
            title: title.trim(),
            type,
            totalUsers,
            perUser,
            totalAmount,
            comment: comment.trim(),
            redirectLink: redirectLink.trim(),
            accessCode: accessCode ? accessCode.trim() : null,
            specialUsers: specialUsers ? specialUsers.trim() : null,
            channels: channels || [],
            referAmount: referAmount || 0,
            referComment: referComment.trim() || '',
            youtubeVideo: youtubeVideo.trim() || '',
            requireRefer: requireRefer || false,
            requireVerify: requireVerify !== undefined ? requireVerify : true,
            requireYoutube: requireYoutube || false,
            requireChannel: requireChannel || false,
            requireType: requireType !== undefined ? requireType : true,
            status: 'active',
            remainingUsers: totalUsers,
            claimedUsers: []
        });
        
        await lifafa.save();
        
        // ─── Create Transaction ───
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        const transaction = new Transaction({
            tx_id: `LIF_${timestamp}_${random}`,
            user_id: adminUser._id,
            amount: totalAmount,
            fee: 0,
            type: 'lifafa',
            status: 'success',
            description: `Lifafa Created: ${title.trim()} - ${lifafaId}`,
            remark: `Lifafa created by admin: ${adminUser.walletId}`
        });
        await transaction.save();
        
        // ─── Telegram Notification ───
        if (adminUser.telegramId && BOT_TOKEN) {
            await sendTelegramMessage(adminUser.telegramId,
`Lifafa Created

Dear ${adminUser.fullName},

Lifafa ID: ${lifafaId}
Title: ${title.trim()}
Total Amount: ₹${totalAmount.toFixed(2)}
Total Users: ${totalUsers}
Per User: ₹${perUser.toFixed(2)}
Created: ${dateTime}

Team Universal Wallet`
            );
        }
        
        // ─── Telegram Notification To Admin ───
        await notifyAdmin(
`Lifafa Created

Lifafa ID: ${lifafaId}
Title: ${title.trim()}
Created By: ${adminUser.fullName} (${adminUser.walletId})
Total Amount: ₹${totalAmount.toFixed(2)}
Total Users: ${totalUsers}
Per User: ₹${perUser.toFixed(2)}
Created: ${dateTime}

Team Universal Wallet`
        );
        
        console.log('Lifafa Created:', { lifafaId, title, totalAmount, totalUsers, adminWalletId: adminUser.walletId });
        
        res.json({
            success: true,
            message: 'Lifafa Created Successfully!',
            lifafa: {
                _id: lifafa._id,
                lifafaId: lifafa.lifafaId,
                title: lifafa.title,
                totalAmount: lifafa.totalAmount,
                totalUsers: lifafa.totalUsers,
                perUser: lifafa.perUser,
                remainingUsers: lifafa.remainingUsers,
                status: lifafa.status
            }
        });
        
    } catch (error) {
        console.error('Create Lifafa Error:', error.message);
        
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'Duplicate Lifafa ID Detected. Please Try Again.'
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Failed To Create Lifafa. Please Try Again Later.'
        });
    }
});

// ============================================
// DELETE LIFAFA
// ============================================
router.delete('/delete/:id', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        const dateTime = getCurrentDateTime();
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Lifafa ID Format.'
            });
        }
        
        const lifafa = await Lifafa.findById(id).populate('userId', 'fullName mobile telegramId walletId');
        if (!lifafa) {
            return res.status(404).json({
                success: false,
                message: `Lifafa With ID "${id}" Not Found.`
            });
        }
        
        if (lifafa.claimedUsers.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot Delete Lifafa - It Has Been Claimed By ${lifafa.claimedUsers.length} Users.`
            });
        }
        
        // Refund balance to admin user
        const user = await User.findById(lifafa.userId);
        if (user) {
            user.balance += lifafa.totalAmount;
            await user.save();
            
            const timestamp = Date.now().toString(36).toUpperCase();
            const random = Math.random().toString(36).substring(2, 8).toUpperCase();
            
            const transaction = new Transaction({
                tx_id: `REF_${timestamp}_${random}`,
                user_id: lifafa.userId,
                amount: lifafa.totalAmount,
                fee: 0,
                type: 'admin_add',
                status: 'success',
                description: `Lifafa Refund: ${lifafa.title} (${lifafa.lifafaId})`,
                remark: `Refund for deleted lifafa: ${lifafa.lifafaId}`
            });
            await transaction.save();
        }
        
        const lifafaInfo = {
            lifafaId: lifafa.lifafaId,
            title: lifafa.title,
            totalAmount: lifafa.totalAmount
        };
        
        await Lifafa.findByIdAndDelete(id);
        
        // ─── Telegram Notification ───
        if (user && user.telegramId && BOT_TOKEN) {
            await sendTelegramMessage(user.telegramId,
`Lifafa Deleted

Dear ${user.fullName}, Your Lifafa Has Been Deleted.

Lifafa ID: ${lifafaInfo.lifafaId}
Title: ${lifafaInfo.title}
Refund: ₹${lifafaInfo.totalAmount.toFixed(2)}
Time: ${dateTime}

Team Universal Wallet`
            );
        }
        
        await notifyAdmin(
`Lifafa Deleted

Lifafa ID: ${lifafaInfo.lifafaId}
Title: ${lifafaInfo.title}
User: ${user ? user.fullName : 'Unknown'} (${user ? user.walletId : 'N/A'})
Refund: ₹${lifafaInfo.totalAmount.toFixed(2)}
Time: ${dateTime}

Team Universal Wallet`
        );
        
        console.log('Lifafa Deleted:', lifafaInfo);
        
        res.json({
            success: true,
            message: `Lifafa "${lifafaInfo.title}" Deleted. Refund: ₹${lifafaInfo.totalAmount.toFixed(2)}`
        });
        
    } catch (error) {
        console.error('Delete Lifafa Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Delete Lifafa.'
        });
    }
});

// ============================================
// UPDATE LIFAFA STATUS
// ============================================
router.put('/update-status/:id', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const dateTime = getCurrentDateTime();
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Lifafa ID Format.'
            });
        }
        
        if (!['active', 'completed', 'expired', 'cancelled'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Status.'
            });
        }
        
        const lifafa = await Lifafa.findById(id).populate('userId', 'fullName mobile telegramId walletId');
        if (!lifafa) {
            return res.status(404).json({
                success: false,
                message: `Lifafa With ID "${id}" Not Found.`
            });
        }
        
        let refundAmount = 0;
        if (status === 'cancelled' && lifafa.status === 'active') {
            refundAmount = lifafa.remainingUsers * lifafa.perUser;
            if (refundAmount > 0) {
                const user = await User.findById(lifafa.userId);
                if (user) {
                    user.balance += refundAmount;
                    await user.save();
                    
                    const timestamp = Date.now().toString(36).toUpperCase();
                    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
                    
                    const transaction = new Transaction({
                        tx_id: `REF_${timestamp}_${random}`,
                        user_id: lifafa.userId,
                        amount: refundAmount,
                        fee: 0,
                        type: 'admin_add',
                        status: 'success',
                        description: `Lifafa Cancellation Refund: ${lifafa.title}`,
                        remark: `Refund for cancelled lifafa: ${lifafa.lifafaId}`
                    });
                    await transaction.save();
                }
            }
        }
        
        lifafa.status = status;
        await lifafa.save();
        
        // ─── Telegram Notification ───
        if (lifafa.userId && lifafa.userId.telegramId && BOT_TOKEN) {
            const statusText = status.charAt(0).toUpperCase() + status.slice(1);
            
            await sendTelegramMessage(lifafa.userId.telegramId,
`Lifafa ${statusText}

Dear ${lifafa.userId.fullName},

Lifafa ID: ${lifafa.lifafaId}
Title: ${lifafa.title}
New Status: ${statusText}
${refundAmount > 0 ? `Refund: ₹${refundAmount.toFixed(2)}` : ''}
Time: ${dateTime}

Team Universal Wallet`
            );
        }
        
        await notifyAdmin(
`Lifafa Status Updated

Lifafa ID: ${lifafa.lifafaId}
Title: ${lifafa.title}
User: ${lifafa.userId ? lifafa.userId.fullName : 'Unknown'}
New Status: ${statusText}
${refundAmount > 0 ? `Refund: ₹${refundAmount.toFixed(2)}` : ''}
Time: ${dateTime}

Team Universal Wallet`
        );
        
        console.log('Lifafa Status Updated:', { lifafaId: lifafa.lifafaId, status, refundAmount });
        
        res.json({
            success: true,
            message: `Lifafa Status Updated To "${status}".`,
            lifafa: {
                _id: lifafa._id,
                lifafaId: lifafa.lifafaId,
                title: lifafa.title,
                status: lifafa.status,
                refundAmount: refundAmount
            }
        });
        
    } catch (error) {
        console.error('Update Lifafa Status Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Update Lifafa Status.'
        });
    }
});

module.exports = router;
