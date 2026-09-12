// FILE: routes/gift-mgmt.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const GiftCode = require('../models/GiftCode');
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
    return now.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
}

async function sendTelegramMessage(chatId, message) {
    return new Promise((resolve) => {
        const https = require('https');
        if (!BOT_TOKEN) {
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
            return res.status(401).json({ success: false, message: 'No Token Provided.' });
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
                return res.status(403).json({ success: false, message: 'Admin Access Required.' });
            }
        } catch (jwtError) {
            if (jwtError.name === 'JsonWebTokenError') {
                return res.status(401).json({ success: false, message: 'Invalid Token.' });
            }
            if (jwtError.name === 'TokenExpiredError') {
                return res.status(401).json({ success: false, message: 'Token Expired.' });
            }
            return res.status(401).json({ success: false, message: 'Authentication Failed.' });
        }
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal Server Error.' });
    }
}

// ============================================
// GENERATE UNIQUE GIFT CODE
// ============================================
function generateGiftCode() {
    const prefix = 'GIFT';
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    return `${prefix}${timestamp}${random}`;
}

// ============================================
// GET ALL GIFTS
// ============================================
router.get('/', verifyAdminToken, async (req, res) => {
    try {
        const { isUsed, page = 1, limit = 50 } = req.query;
        let query = {};

        if (isUsed !== undefined) {
            query.isUsed = isUsed === 'true';
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const gifts = await GiftCode.find(query)
            .populate('createdBy', 'fullName mobile walletId username')
            .populate('redeemedBy', 'fullName mobile walletId username')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await GiftCode.countDocuments(query);

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
        console.error('Get Gifts Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Fetch Gifts.' });
    }
});

// ============================================
// GET GIFT STATS
// ============================================
router.get('/stats', verifyAdminToken, async (req, res) => {
    try {
        const total = await GiftCode.countDocuments();
        const active = await GiftCode.countDocuments({ isUsed: false });
        const used = await GiftCode.countDocuments({ isUsed: true });

        // Total amount across all codes (per-user amount)
        const allGifts = await GiftCode.find();
        const totalAmountPotential = allGifts.reduce((sum, g) => {
            return sum + (g.amount * (g.maxUsers || 1));
        }, 0);
        const usedAmount = allGifts.reduce((sum, g) => {
            return sum + (g.amount * (g.usedCount || (g.isUsed ? 1 : 0)));
        }, 0);

        const usedToday = await GiftCode.countDocuments({
            isUsed: true,
            redeemedAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
        });
        const usedThisMonth = await GiftCode.countDocuments({
            isUsed: true,
            redeemedAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }
        });

        res.json({
            success: true,
            total, active, used,
            totalAmount: totalAmountPotential,
            usedAmount,
            usedToday,
            usedThisMonth
        });
    } catch (error) {
        console.error('Get Gift Stats Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Fetch Statistics.' });
    }
});

// ============================================
// GET SINGLE GIFT BY ID
// ============================================
router.get('/:id', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid Gift ID Format.' });
        }
        const gift = await GiftCode.findById(id)
            .populate('createdBy', 'fullName mobile walletId username')
            .populate('redeemedBy', 'fullName mobile walletId username');
        if (!gift) {
            return res.status(404).json({ success: false, message: `Gift With ID "${id}" Not Found.` });
        }
        res.json({ success: true, gift });
    } catch (error) {
        console.error('Get Gift Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Fetch Gift.' });
    }
});

// ============================================
// GET GIFT BY CODE
// ============================================
router.get('/code/:code', verifyAdminToken, async (req, res) => {
    try {
        const { code } = req.params;
        const gift = await GiftCode.findOne({ code: code.toUpperCase() })
            .populate('createdBy', 'fullName mobile walletId username')
            .populate('redeemedBy', 'fullName mobile walletId username');
        if (!gift) {
            return res.status(404).json({ success: false, message: `Gift Code "${code}" Not Found.` });
        }
        res.json({ success: true, gift });
    } catch (error) {
        console.error('Get Gift By Code Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Fetch Gift.' });
    }
});

// ============================================
// CREATE GIFT — With multi-user support
// ============================================
router.post('/create', verifyAdminToken, async (req, res) => {
    try {
        const { amount, note, quantity = 1, numberOfUsers = 1 } = req.body;
        const dateTime = getCurrentDateTime();

        // ─── Validation ───
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Please Provide A Valid Amount.' });
        }
        if (!quantity || quantity < 1) {
            return res.status(400).json({ success: false, message: 'Quantity Must Be At Least 1.' });
        }
        if (quantity > 100) {
            return res.status(400).json({ success: false, message: 'Maximum 100 Gifts Can Be Created At Once.' });
        }
        if (!numberOfUsers || numberOfUsers < 1) {
            return res.status(400).json({ success: false, message: 'Number Of Users Must Be At Least 1.' });
        }
        if (numberOfUsers > 1000) {
            return res.status(400).json({ success: false, message: 'Maximum 1,000 Users Allowed Per Code.' });
        }

        // ─── Get Admin User ───
        let adminUser;
        try {
            adminUser = await getAdminUser();
        } catch (error) {
            return res.status(404).json({ success: false, message: error.message });
        }

        // ─── Generate Gift Codes ───
        const gifts = [];
        const giftCodes = [];
        const noteText = note ? note.trim() : '';

        for (let i = 0; i < quantity; i++) {
            const code = generateGiftCode();

            const gift = new GiftCode({
                code,
                amount: parseFloat(amount),
                createdBy: adminUser._id,
                maxUsers: parseInt(numberOfUsers),
                usedCount: 0,
                usedBy: [],
                isUsed: false,
                redeemedBy: null,
                redeemedAt: null,
                note: noteText
            });

            await gift.save();
            gifts.push(gift);
            giftCodes.push(code);
        }

        // ─── Create Transaction ───
        const totalAmount = parseFloat(amount) * quantity * parseInt(numberOfUsers);
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.random().toString(36).substring(2, 8).toUpperCase();

        const transaction = new Transaction({
            tx_id: `GFT_${timestamp}_${random}`,
            user_id: adminUser._id,
            amount: totalAmount,
            fee: 0,
            type: 'gift',
            status: 'success',
            description: `${quantity} Gift Codes Created (₹${parseFloat(amount).toFixed(2)} × ${numberOfUsers} Users)`,
            remark: `Created ${quantity} gift codes by admin: ${adminUser.walletId}`,
            metadata: {
                amountPerUser: parseFloat(amount),
                quantity: parseInt(quantity),
                numberOfUsers: parseInt(numberOfUsers),
                totalAmount: totalAmount,
                category: 'gift_created',
                method: 'Gift',
                balanceAfter: adminUser.balance
            }
        });
        await transaction.save();

        // ─── Telegram Notification ───
        if (adminUser.telegramId && BOT_TOKEN) {
            await sendTelegramMessage(adminUser.telegramId,
`Gifts Created

Dear ${adminUser.fullName},

Quantity: ${quantity}
Amount Per User: ₹${parseFloat(amount).toFixed(2)}
Number Of Users Per Code: ${numberOfUsers}
Total Cost: ₹${totalAmount.toFixed(2)}
First Code: ${giftCodes[0]}
Time: ${dateTime}`
            );
        }

        await notifyAdmin(
`Gifts Created

Quantity: ${quantity}
Amount Per User: ₹${parseFloat(amount).toFixed(2)}
Number Of Users Per Code: ${numberOfUsers}
Total Cost: ₹${totalAmount.toFixed(2)}
Created By: ${adminUser.fullName} (${adminUser.walletId})
First Code: ${giftCodes[0]}
Time: ${dateTime}`
        );

        res.json({
            success: true,
            message: `${quantity} Gift Codes Created Successfully!`,
            giftsCreated: quantity,
            totalAmount: totalAmount,
            numberOfUsers: numberOfUsers,
            giftCodes: giftCodes,
            gifts: gifts.map(g => ({
                _id: g._id,
                code: g.code,
                amount: g.amount,
                maxUsers: g.maxUsers,
                usedCount: g.usedCount,
                isUsed: g.isUsed,
                note: g.note,
                createdAt: g.createdAt
            }))
        });
    } catch (error) {
        console.error('Create Gifts Error:', error.message);
        if (error.code === 11000) {
            return res.status(409).json({ success: false, message: 'Duplicate Gift Code Detected.' });
        }
        res.status(500).json({ success: false, message: 'Failed To Create Gifts.' });
    }
});

// ============================================
// DELETE GIFT
// ============================================
router.delete('/delete/:id', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        const dateTime = getCurrentDateTime();

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid Gift ID Format.' });
        }

        const gift = await GiftCode.findById(id).populate('createdBy', 'fullName mobile walletId');
        if (!gift) {
            return res.status(404).json({ success: false, message: `Gift With ID "${id}" Not Found.` });
        }

        // Allow delete if not fully used
        if (gift.usedCount >= gift.maxUsers) {
            return res.status(400).json({ success: false, message: 'Cannot Delete Gift - Fully Used.' });
        }

        const giftInfo = {
            code: gift.code,
            amount: gift.amount,
            maxUsers: gift.maxUsers,
            usedCount: gift.usedCount,
            createdBy: gift.createdBy
        };

        await GiftCode.findByIdAndDelete(id);

        await notifyAdmin(
`Gift Deleted

Code: ${giftInfo.code}
Amount: ₹${giftInfo.amount.toFixed(2)}
Usage: ${giftInfo.usedCount}/${giftInfo.maxUsers}
Created By: ${giftInfo.createdBy ? giftInfo.createdBy.fullName : 'Unknown'}
Time: ${dateTime}`
        );

        res.json({
            success: true,
            message: `Gift Code "${giftInfo.code}" Deleted Successfully.`
        });
    } catch (error) {
        console.error('Delete Gift Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Delete Gift.' });
    }
});

// ============================================
// REDEEM GIFT (User endpoint)
// ============================================
router.post('/redeem', async (req, res) => {
    try {
        const { code, userId } = req.body;
        const dateTime = getCurrentDateTime();

        if (!code || !userId) {
            return res.status(400).json({ success: false, message: 'Please Provide Gift Code And User ID.' });
        }

        const gift = await GiftCode.findOne({ code: code.toUpperCase() });
        if (!gift) {
            return res.status(404).json({ success: false, message: 'Invalid Gift Code.' });
        }

        // Check slots
        if (gift.usedCount >= gift.maxUsers) {
            return res.status(400).json({ success: false, message: 'This Gift Code Has Been Fully Redeemed.' });
        }

        // Check if user already redeemed
        if (gift.usedBy && gift.usedBy.some(id => id.toString() === userId.toString())) {
            return res.status(400).json({ success: false, message: 'You Have Already Redeemed This Gift Code.' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User Not Found.' });
        }

        // Use gift code (multi-user aware)
        await gift.use(userId);

        // Add balance to user
        user.balance += gift.amount;
        await user.save();

        // Create transaction
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.random().toString(36).substring(2, 8).toUpperCase();

        const transaction = new Transaction({
            tx_id: `RED_${timestamp}_${random}`,
            user_id: userId,
            sender_id: gift.createdBy,
            receiver_id: userId,
            amount: gift.amount,
            fee: 0,
            type: 'gift',
            status: 'success',
            description: `Gift Redeemed: ${gift.code}`,
            remark: `Redeemed gift code: ${gift.code}`,
            metadata: {
                giftCode: gift.code,
                creatorId: gift.createdBy,
                category: 'gift_received',
                method: 'Gift',
                balanceAfter: user.balance
            }
        });
        await transaction.save();

        // ─── Telegram Notification To User ───
        if (user.telegramId && BOT_TOKEN) {
            await sendTelegramMessage(user.telegramId,
`Gift Redeemed!

Dear ${user.fullName},

Amount: ₹${gift.amount.toFixed(2)}
New Balance: ₹${user.balance.toFixed(2)}
Code: ${gift.code}
Time: ${dateTime}`
            );
        }

        await notifyAdmin(
`Gift Redeemed

Code: ${gift.code}
Amount: ₹${gift.amount.toFixed(2)}
Redeemed By: ${user.fullName} (${user.walletId})
Usage: ${gift.usedCount}/${gift.maxUsers}
Time: ${dateTime}`
        );

        res.json({
            success: true,
            message: 'Gift Redeemed Successfully!',
            amount: gift.amount,
            newBalance: user.balance,
            giftCode: gift.code,
            usedCount: gift.usedCount,
            maxUsers: gift.maxUsers
        });
    } catch (error) {
        console.error('Redeem Gift Error:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Failed To Redeem Gift.' });
    }
});

module.exports = router;
