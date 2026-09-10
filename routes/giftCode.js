// FILE: routes/giftCode.js
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const GiftCode = require('../models/GiftCode');
const axios = require('axios');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG = process.env.ADMIN_TG_ID;

// ==================== Verify Token Middleware ====================
const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'No Token Provided' });
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) return res.status(401).json({ success: false, message: 'User Not Found' });
        req.user = user;
        next();
    } catch (error) {
        console.error('Token Verification Error:', error.message);
        if (error.name === 'JsonWebTokenError') return res.status(401).json({ success: false, message: 'Invalid Token. Please Login Again.' });
        if (error.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: 'Token Expired. Please Login Again.' });
        return res.status(500).json({ success: false, message: 'Authentication Error' });
    }
};

// ==================== Helper Functions ====================
function generateGiftTxnId() { 
    return 'TXN_GIFT_' + Date.now() + Math.floor(Math.random() * 99999); 
}

async function sendTelegramMessage(chatId, message) {
    if (!BOT_TOKEN) return { success: false, error: 'BOT_TOKEN not configured' };
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const response = await axios.post(url, { 
            chat_id: chatId, 
            text: message, 
            parse_mode: 'HTML' 
        }, { 
            timeout: 15000, 
            headers: { 'Content-Type': 'application/json' } 
        });
        if (response.data && response.data.ok) return { success: true };
        return { success: false, error: response.data?.description || 'Unknown Error' };
    } catch (error) {
        console.error('Failed To Send Telegram Message:', error.message);
        return { success: false, error: error.message };
    }
}

async function notifyAdmin(message) {
    if (!ADMIN_TG) return;
    try { 
        await sendTelegramMessage(ADMIN_TG, message); 
        console.log('Admin Notification Sent'); 
    } catch (error) { 
        console.error('Failed To Send Admin Notification:', error.message); 
    }
}

function getCurrentDateTime() {
    return new Date().toLocaleString('en-IN', { 
        timeZone: 'Asia/Kolkata', 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit', 
        hour12: true 
    });
}

// Gift Code Validation: 1-50 characters (spaces, emoji, symbols allowed)
function isValidGiftCode(code) {
    if (!code || typeof code !== 'string') return false;
    const len = code.trim().length;
    return len >= 1 && len <= 50;
}

// ============================================
// GET BALANCE - GET /api/gift/balance
// ============================================
router.get('/balance', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        res.json({ 
            status: 'success', 
            balance: user.balance, 
            walletId: user.walletId, 
            fullName: user.fullName 
        });
    } catch (error) {
        console.error('Balance Error:', error.message);
        res.status(500).json({ status: 'error', error: 'Failed To Fetch Balance' });
    }
});

// ============================================
// CREATE GIFT CODE - POST /api/gift/create
// ============================================
router.post('/create', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        const { amount, note, giftCode } = req.body;
        const dateTime = getCurrentDateTime();

        // Validation
        if (!amount || amount <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Amount Must Be Greater Than 0' 
            });
        }

        if (!giftCode || giftCode.trim() === '') {
            return res.status(400).json({ 
                success: false, 
                message: 'Please Enter A Gift Code' 
            });
        }

        const customCode = giftCode.trim().toUpperCase();
        
        // Validation: 1-50 characters
        if (!isValidGiftCode(customCode)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Code Must Be 1-50 Characters Long (Space, Emoji, Symbol Allowed)' 
            });
        }

        // Check if code already exists
        const existingCode = await GiftCode.findOne({ code: customCode });
        if (existingCode) {
            return res.status(400).json({ 
                success: false, 
                message: 'This Gift Code Already Exists. Please Choose A Different One.' 
            });
        }

        // Balance check
        const giftAmount = parseFloat(amount);
        if (user.balance < giftAmount) {
            return res.status(400).json({ 
                success: false, 
                message: `Insufficient Balance. Your Current Balance Is ₹${user.balance.toFixed(2)}. Need ₹${giftAmount.toFixed(2)}.` 
            });
        }

        // Create gift code (MongoDB)
        const giftData = new GiftCode({
            code: customCode,
            amount: giftAmount,
            createdBy: user._id,
            isUsed: false,
            redeemedBy: null,
            redeemedAt: null,
            note: note || 'Gift Code'
        });

        await giftData.save();

        // Deduct user balance
        user.balance -= giftAmount;
        await user.save();

        // Create transaction
        const transactionId = generateGiftTxnId();
        await Transaction.create({
            tx_id: transactionId,
            user_id: user._id,
            sender_id: user._id,
            receiver_id: user._id,
            amount: giftAmount,
            type: 'gift',
            status: 'success',
            remark: `Gift Code Created: ${customCode}`,
            description: `Gift Code Created: ${customCode}`,
            tx_time: new Date(),
            metadata: { 
                giftCode: customCode, 
                note: note || 'Gift Code',
                amount: giftAmount 
            }
        });

        // Telegram Notification (Creator)
        if (user.telegramId) {
            const creatorMessage = 
`Gift Code Created Successfully

Dear ${user.fullName}, Your Gift Code Has Been Created.

Gift Code: ${customCode}
Amount: ₹${giftAmount.toFixed(2)}
Note: ${note || 'No Note'}
New Balance: ₹${user.balance.toFixed(2)}

If You Didn't Create This, Contact Support Immediately.`;
            await sendTelegramMessage(user.telegramId, creatorMessage);
        }

        // Admin Notification
        const adminMessage = 
`New Gift Code Created

Creator: ${user.fullName}
Mobile: ${user.mobile}
Telegram Id: ${user.telegramId || 'N/A'}
Wallet Id: ${user.walletId}
Gift Code: ${customCode}
Amount: ₹${giftAmount.toFixed(2)}
Note: ${note || 'No Note'}

Status: Active`;
        await notifyAdmin(adminMessage);

        res.json({
            success: true,
            message: 'Gift Code Created Successfully',
            giftCode: customCode,
            amount: giftAmount,
            newBalance: user.balance
        });

    } catch (error) {
        console.error('Create Gift Code Error:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Failed To Create Gift Code. Please Try Again.' 
        });
    }
});

// ============================================
// REDEEM GIFT CODE - POST /api/gift/redeem
// ============================================
router.post('/redeem', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        const { giftCode } = req.body;

        if (!giftCode || giftCode.trim() === '') {
            return res.status(400).json({ 
                success: false, 
                message: 'Gift Code Is Required' 
            });
        }

        const code = giftCode.trim().toUpperCase();

        // Validation: 1-50 characters
        if (!isValidGiftCode(code)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Code Must Be 1-50 Characters Long' 
            });
        }

        // Find gift code from database
        const giftData = await GiftCode.findOne({ code: code });
        if (!giftData) {
            return res.status(404).json({ 
                success: false, 
                message: 'Invalid Gift Code' 
            });
        }

        // Check if code already used
        if (giftData.isUsed) {
            return res.status(400).json({ 
                success: false, 
                message: 'This Gift Code Has Already Been Used' 
            });
        }

        // Check if user is redeeming own code
        if (giftData.createdBy.toString() === user._id.toString()) {
            return res.status(400).json({ 
                success: false, 
                message: 'You Cannot Redeem Your Own Gift Code' 
            });
        }

        // Use gift code
        await giftData.use(user._id);

        // Add balance to user
        user.balance += giftData.amount;
        await user.save();

        // Create transaction
        const transactionId = generateGiftTxnId();
        await Transaction.create({
            tx_id: transactionId,
            user_id: user._id,
            sender_id: giftData.createdBy,
            receiver_id: user._id,
            amount: giftData.amount,
            type: 'gift',
            status: 'success',
            remark: `Gift Code Redeemed: ${code}`,
            description: `Gift Code Redeemed: ${code}`,
            tx_time: new Date(),
            metadata: { 
                giftCode: code,
                creatorId: giftData.createdBy
            }
        });

        // Telegram Notification (Redeemer)
        if (user.telegramId) {
            const redeemerMessage = 
`Gift Code Redeemed

Dear ${user.fullName}, You Have Successfully Redeemed The Gift Code.

Gift Code: ${code}
Amount Added: ₹${giftData.amount.toFixed(2)}
New Balance: ₹${user.balance.toFixed(2)}

Amount Credited To Your Wallet.`;
            await sendTelegramMessage(user.telegramId, redeemerMessage);
        }

        // Admin Notification
        const adminMessage = 
`Gift Code Redeemed

Redeemer: ${user.fullName}
Mobile: ${user.mobile}
Telegram Id: ${user.telegramId || 'N/A'}
Gift Code: ${code}
Amount: ₹${giftData.amount.toFixed(2)}
New Balance: ₹${user.balance.toFixed(2)}

Status: Used`;
        await notifyAdmin(adminMessage);

        res.json({
            success: true,
            message: 'Gift Code Redeemed Successfully',
            amount: giftData.amount,
            newBalance: user.balance,
            isUsed: true
        });

    } catch (error) {
        console.error('Redeem Gift Code Error:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Failed To Redeem Gift Code. Please Try Again.' 
        });
    }
});

// ============================================
// GET GIFT CODE DETAILS - GET /api/gift/details/:code
// ============================================
router.get('/details/:code', verifyToken, async (req, res) => {
    try {
        const { code } = req.params;
        const user = req.user;
        
        if (!code) {
            return res.status(400).json({ 
                success: false, 
                message: 'Gift Code Is Required' 
            });
        }

        const giftData = await GiftCode.findOne({ code: code.toUpperCase() });
        if (!giftData) {
            return res.status(404).json({ 
                success: false, 
                message: 'Invalid Gift Code' 
            });
        }

        // Only creator or admin can view
        if (giftData.createdBy.toString() !== user._id.toString() && !user.isAdmin) {
            return res.status(403).json({ 
                success: false, 
                message: 'Unauthorized To View This Gift Code' 
            });
        }

        // Fetch creator info
        const creator = await User.findById(giftData.createdBy);
        const redeemer = giftData.redeemedBy ? await User.findById(giftData.redeemedBy) : null;

        res.json({
            success: true,
            giftCode: {
                code: giftData.code,
                amount: giftData.amount,
                isUsed: giftData.isUsed,
                note: giftData.note,
                creatorName: creator ? creator.fullName : 'Unknown',
                creatorMobile: creator ? creator.mobile : 'Unknown',
                redeemedBy: redeemer ? redeemer.fullName : null,
                redeemedAt: giftData.redeemedAt,
                createdAt: giftData.createdAt
            }
        });
    } catch (error) {
        console.error('Gift Code Details Error:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Failed To Fetch Gift Code Details' 
        });
    }
});

// ============================================
// GET MY GIFT CODES - GET /api/gift/my-codes
// ============================================
router.get('/my-codes', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        
        const giftCodes = await GiftCode.find({ createdBy: user._id })
            .sort({ createdAt: -1 })
            .populate('redeemedBy', 'fullName mobile');

        const formattedCodes = giftCodes.map(g => ({
            code: g.code,
            amount: g.amount,
            isUsed: g.isUsed,
            note: g.note,
            redeemedBy: g.redeemedBy ? g.redeemedBy.fullName : null,
            redeemedAt: g.redeemedAt,
            createdAt: g.createdAt
        }));

        res.json({ 
            success: true, 
            codes: formattedCodes, 
            total: formattedCodes.length 
        });
    } catch (error) {
        console.error('My Gift Codes Error:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Failed To Fetch Gift Codes' 
        });
    }
});

// ============================================
// GET ALL GIFT CODES (Admin Only) - GET /api/gift/all
// ============================================
router.get('/all', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        if (!user.isAdmin) {
            return res.status(403).json({ 
                success: false, 
                message: 'Admin Access Required' 
            });
        }

        const giftCodes = await GiftCode.find({})
            .sort({ createdAt: -1 })
            .populate('createdBy', 'fullName mobile telegramId walletId')
            .populate('redeemedBy', 'fullName mobile telegramId');

        const formattedCodes = giftCodes.map(g => ({
            code: g.code,
            amount: g.amount,
            isUsed: g.isUsed,
            note: g.note,
            creatorName: g.createdBy ? g.createdBy.fullName : 'Unknown',
            creatorMobile: g.createdBy ? g.createdBy.mobile : 'Unknown',
            creatorTelegramId: g.createdBy ? g.createdBy.telegramId : null,
            redeemedBy: g.redeemedBy ? g.redeemedBy.fullName : null,
            redeemedAt: g.redeemedAt,
            createdAt: g.createdAt
        }));

        res.json({ 
            success: true, 
            codes: formattedCodes, 
            total: formattedCodes.length 
        });
    } catch (error) {
        console.error('All Gift Codes Error:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Failed To Fetch Gift Codes' 
        });
    }
});

// ============================================
// DELETE GIFT CODE (Admin Only) - DELETE /api/gift/:code
// ============================================
router.delete('/:code', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        if (!user.isAdmin) {
            return res.status(403).json({ 
                success: false, 
                message: 'Admin Access Required' 
            });
        }

        const { code } = req.params;
        if (!code) {
            return res.status(400).json({ 
                success: false, 
                message: 'Gift Code Is Required' 
            });
        }

        const giftData = await GiftCode.findOneAndDelete({ code: code.toUpperCase() });
        if (!giftData) {
            return res.status(404).json({ 
                success: false, 
                message: 'Gift Code Not Found' 
            });
        }

        console.log(`Gift Code "${code}" Deleted By Admin: ${user.fullName}`);
        res.json({ 
            success: true, 
            message: 'Gift Code Deleted Successfully' 
        });
    } catch (error) {
        console.error('Delete Gift Code Error:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Failed To Delete Gift Code' 
        });
    }
});

module.exports = router;
