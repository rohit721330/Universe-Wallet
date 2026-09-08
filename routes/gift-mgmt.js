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
            console.warn('⚠️ BOT_TOKEN not configured');
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
            console.warn('⚠️ ADMIN_TG_ID not configured');
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
                message: 'Nᴏ Tᴏᴋᴇɴ Pʀᴏᴠɪᴅᴇᴅ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ Tᴏ Aᴄᴄᴇꜱꜱ Tʜɪꜱ Rᴇꜱᴏᴜʀᴄᴇ.' 
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
                    message: 'Aᴄᴄᴇꜱꜱ Dᴇɴɪᴇᴅ. Tʜɪꜱ Rᴇꜱᴏᴜʀᴄᴇ Iꜱ Rᴇꜱᴛʀɪᴄᴛᴇᴅ Tᴏ Aᴅᴍɪɴꜱ Oɴʟʏ.' 
                });
            }
        } catch (jwtError) {
            if (jwtError.name === 'JsonWebTokenError') {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Iɴᴠᴀʟɪᴅ Tᴏᴋᴇɴ Fᴏʀᴍᴀᴛ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ Aɢᴀɪɴ.' 
                });
            }
            if (jwtError.name === 'TokenExpiredError') {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Tᴏᴋᴇɴ Hᴀꜱ Exᴘɪʀᴇᴅ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ Aɢᴀɪɴ.' 
                });
            }
            return res.status(401).json({ 
                success: false, 
                message: 'Aᴜᴛʜᴇɴᴛɪᴄᴀᴛɪᴏɴ Fᴀɪʟᴇᴅ.' 
            });
        }
    } catch (error) {
        console.error('❌ Tᴏᴋᴇɴ Vᴇʀɪꜰɪᴄᴀᴛɪᴏɴ Eʀʀᴏʀ:', error.message);
        return res.status(500).json({ 
            success: false, 
            message: 'Iɴᴛᴇʀɴᴀʟ Sᴇʀᴠᴇʀ Eʀʀᴏʀ.' 
        });
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
        console.error('❌ Gᴇᴛ Gɪꜰᴛꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Gɪꜰᴛꜱ.'
        });
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
        
        const allGifts = await GiftCode.find();
        const totalAmount = allGifts.reduce((sum, g) => sum + g.amount, 0);
        const usedAmount = allGifts.filter(g => g.isUsed).reduce((sum, g) => sum + g.amount, 0);
        
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
            total,
            active,
            used,
            totalAmount,
            usedAmount,
            usedToday,
            usedThisMonth
        });
    } catch (error) {
        console.error('❌ Gᴇᴛ Gɪꜰᴛ Sᴛᴀᴛꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Sᴛᴀᴛɪꜱᴛɪᴄꜱ.'
        });
    }
});

// ============================================
// GET SINGLE GIFT BY ID
// ============================================
router.get('/:id', verifyAdminToken, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Iɴᴠᴀʟɪᴅ Gɪꜰᴛ ID Fᴏʀᴍᴀᴛ.'
            });
        }
        
        const gift = await GiftCode.findById(id)
            .populate('createdBy', 'fullName mobile walletId username')
            .populate('redeemedBy', 'fullName mobile walletId username');
        
        if (!gift) {
            return res.status(404).json({
                success: false,
                message: `Gɪꜰᴛ Wɪᴛʜ ID "${id}" Nᴏᴛ Fᴏᴜɴᴅ.`
            });
        }
        
        res.json({
            success: true,
            gift
        });
    } catch (error) {
        console.error('❌ Gᴇᴛ Gɪꜰᴛ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Gɪꜰᴛ.'
        });
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
            return res.status(404).json({
                success: false,
                message: `Gɪꜰᴛ Cᴏᴅᴇ "${code}" Nᴏᴛ Fᴏᴜɴᴅ.`
            });
        }
        
        res.json({
            success: true,
            gift
        });
    } catch (error) {
        console.error('❌ Gᴇᴛ Gɪꜰᴛ Bʏ Cᴏᴅᴇ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Gɪꜰᴛ.'
        });
    }
});

// ============================================
// CREATE GIFT - USING ADMIN WALLET ID
// ============================================
router.post('/create', verifyAdminToken, async (req, res) => {
    try {
        const { amount, note, quantity = 1 } = req.body;
        const dateTime = getCurrentDateTime();
        
        // ─── Vᴀʟɪᴅᴀᴛɪᴏɴ ───
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Pʟᴇᴀꜱᴇ Pʀᴏᴠɪᴅᴇ A Vᴀʟɪᴅ Aᴍᴏᴜɴᴛ.'
            });
        }
        
        if (!quantity || quantity < 1) {
            return res.status(400).json({
                success: false,
                message: 'Qᴜᴀɴᴛɪᴛʏ Mᴜꜱᴛ Bᴇ Aᴛ Lᴇᴀꜱᴛ 1.'
            });
        }
        
        if (quantity > 100) {
            return res.status(400).json({
                success: false,
                message: 'Mᴀxɪᴍᴜᴍ 100 Gɪꜰᴛꜱ Cᴀɴ Bᴇ Cʀᴇᴀᴛᴇᴅ Aᴛ Oɴᴄᴇ.'
            });
        }
        
        // ─── Gᴇᴛ Aᴅᴍɪɴ Uꜱᴇʀ ───
        let adminUser;
        try {
            adminUser = await getAdminUser();
        } catch (error) {
            return res.status(404).json({
                success: false,
                message: error.message
            });
        }
        
        // ─── Gᴇɴᴇʀᴀᴛᴇ Gɪꜰᴛ Cᴏᴅᴇꜱ ───
        const gifts = [];
        const giftCodes = [];
        const noteText = note ? note.trim() : '';
        
        for (let i = 0; i < quantity; i++) {
            const code = generateGiftCode();
            
            const gift = new GiftCode({
                code,
                amount: parseFloat(amount),
                createdBy: adminUser._id,
                isUsed: false,
                redeemedBy: null,
                redeemedAt: null,
                note: noteText
            });
            
            await gift.save();
            gifts.push(gift);
            giftCodes.push(code);
        }
        
        // ─── Cʀᴇᴀᴛᴇ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ ───
        const totalAmount = parseFloat(amount) * quantity;
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        const transaction = new Transaction({
            tx_id: `GFT_${timestamp}_${random}`,
            user_id: adminUser._id,
            amount: totalAmount,
            fee: 0,
            type: 'gift',
            status: 'success',
            description: `${quantity} Gɪꜰᴛꜱ Cʀᴇᴀᴛᴇᴅ (₹${parseFloat(amount).toFixed(2)} Eᴀᴄʜ)`,
            remark: `Created ${quantity} gift codes by admin: ${adminUser.walletId}`
        });
        await transaction.save();
        
        // ─── Tᴇʟᴇɢʀᴀᴍ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ ───
        if (adminUser.telegramId && BOT_TOKEN) {
            await sendTelegramMessage(adminUser.telegramId,
                `<b>────────────────────</b>
<b>🎁 Gɪꜰᴛꜱ Cʀᴇᴀᴛᴇᴅ</b>
<b>────────────────────</b>

<b>👤 Dᴇᴀʀ ${adminUser.fullName},</b>

<b>📦 Qᴜᴀɴᴛɪᴛʏ:</b> ${quantity}
<b>💰 Aᴍᴏᴜɴᴛ:</b> ₹${parseFloat(amount).toFixed(2)} Eᴀᴄʜ
<b>💵 Tᴏᴛᴀʟ:</b> ₹${totalAmount.toFixed(2)}
<b>🆔 Fɪʀꜱᴛ Cᴏᴅᴇ:</b> ${giftCodes[0]}
<b>📅 Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🛡️ Tᴇᴀᴍ Pʀɪᴍᴇ Wᴀʟʟᴇᴛ
───────────────────────`
            );
        }
        
        await notifyAdmin(
            `<b>────────────────────</b>
<b>🎁 Gɪꜰᴛꜱ Cʀᴇᴀᴛᴇᴅ</b>
<b>────────────────────</b>

<b>📦 Qᴜᴀɴᴛɪᴛʏ:</b> ${quantity}
<b>💰 Aᴍᴏᴜɴᴛ:</b> ₹${parseFloat(amount).toFixed(2)} Eᴀᴄʜ
<b>💵 Tᴏᴛᴀʟ:</b> ₹${totalAmount.toFixed(2)}
<b>👤 Cʀᴇᴀᴛᴇᴅ Bʏ:</b> ${adminUser.fullName} (${adminUser.walletId})
<b>🆔 Fɪʀꜱᴛ Cᴏᴅᴇ:</b> ${giftCodes[0]}
<b>📅 Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🛡️ Tᴇᴀᴍ Pʀɪᴍᴇ Wᴀʟʟᴇᴛ
───────────────────────`
        );
        
        console.log('✅ Gɪꜰᴛꜱ Cʀᴇᴀᴛᴇᴅ:', { 
            quantity, 
            amount: parseFloat(amount),
            totalAmount,
            codes: giftCodes,
            adminWalletId: adminUser.walletId
        });
        
        res.json({
            success: true,
            message: `${quantity} Gɪꜰᴛꜱ Cʀᴇᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ!`,
            giftsCreated: quantity,
            totalAmount: totalAmount,
            giftCodes: giftCodes,
            gifts: gifts.map(g => ({
                _id: g._id,
                code: g.code,
                amount: g.amount,
                isUsed: g.isUsed,
                note: g.note,
                createdAt: g.createdAt
            }))
        });
        
    } catch (error) {
        console.error('❌ Cʀᴇᴀᴛᴇ Gɪꜰᴛꜱ Eʀʀᴏʀ:', error.message);
        
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'Dᴜᴘʟɪᴄᴀᴛᴇ Gɪꜰᴛ Cᴏᴅᴇ Dᴇᴛᴇᴄᴛᴇᴅ.'
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Cʀᴇᴀᴛᴇ Gɪꜰᴛꜱ.'
        });
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
            return res.status(400).json({
                success: false,
                message: 'Iɴᴠᴀʟɪᴅ Gɪꜰᴛ ID Fᴏʀᴍᴀᴛ.'
            });
        }
        
        const gift = await GiftCode.findById(id).populate('createdBy', 'fullName mobile walletId');
        if (!gift) {
            return res.status(404).json({
                success: false,
                message: `Gɪꜰᴛ Wɪᴛʜ ID "${id}" Nᴏᴛ Fᴏᴜɴᴅ.`
            });
        }
        
        if (gift.isUsed) {
            return res.status(400).json({
                success: false,
                message: 'Cᴀɴɴᴏᴛ Dᴇʟᴇᴛᴇ Gɪꜰᴛ - Iᴛ Hᴀꜱ Aʟʀᴇᴀᴅʏ Bᴇᴇɴ Uꜱᴇᴅ.'
            });
        }
        
        const giftInfo = {
            code: gift.code,
            amount: gift.amount,
            createdBy: gift.createdBy
        };
        
        await GiftCode.findByIdAndDelete(id);
        
        await notifyAdmin(
            `<b>────────────────────</b>
<b>🗑️ Gɪꜰᴛ Dᴇʟᴇᴛᴇᴅ</b>
<b>────────────────────</b>

<b>🆔 Cᴏᴅᴇ:</b> ${giftInfo.code}
<b>💰 Aᴍᴏᴜɴᴛ:</b> ₹${giftInfo.amount.toFixed(2)}
<b>👤 Cʀᴇᴀᴛᴇᴅ Bʏ:</b> ${giftInfo.createdBy ? giftInfo.createdBy.fullName : 'Unknown'}
<b>📅 Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🛡️ Tᴇᴀᴍ Pʀɪᴍᴇ Wᴀʟʟᴇᴛ
───────────────────────`
        );
        
        console.log('🗑️ Gɪꜰᴛ Dᴇʟᴇᴛᴇᴅ:', giftInfo);
        
        res.json({
            success: true,
            message: `Gɪꜰᴛ Cᴏᴅᴇ "${giftInfo.code}" Dᴇʟᴇᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ.`
        });
        
    } catch (error) {
        console.error('❌ Dᴇʟᴇᴛᴇ Gɪꜰᴛ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Dᴇʟᴇᴛᴇ Gɪꜰᴛ.'
        });
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
            return res.status(400).json({
                success: false,
                message: 'Pʟᴇᴀꜱᴇ Pʀᴏᴠɪᴅᴇ Gɪꜰᴛ Cᴏᴅᴇ Aɴᴅ Uꜱᴇʀ ID.'
            });
        }
        
        const gift = await GiftCode.findOne({ code: code.toUpperCase() });
        if (!gift) {
            return res.status(404).json({
                success: false,
                message: 'Iɴᴠᴀʟɪᴅ Gɪꜰᴛ Cᴏᴅᴇ.'
            });
        }
        
        if (gift.isUsed) {
            return res.status(400).json({
                success: false,
                message: 'Tʜɪꜱ Gɪꜰᴛ Cᴏᴅᴇ Hᴀꜱ Aʟʀᴇᴀᴅʏ Bᴇᴇɴ Uꜱᴇᴅ.'
            });
        }
        
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ.'
            });
        }
        
        // Update gift status
        gift.isUsed = true;
        gift.redeemedBy = userId;
        gift.redeemedAt = new Date();
        await gift.save();
        
        // Add balance to user
        user.balance += gift.amount;
        await user.save();
        
        // Create transaction
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        const transaction = new Transaction({
            tx_id: `RED_${timestamp}_${random}`,
            user_id: userId,
            receiver_id: userId,
            amount: gift.amount,
            fee: 0,
            type: 'gift',
            status: 'success',
            description: `Gɪꜰᴛ Rᴇᴅᴇᴇᴍᴇᴅ: ${gift.code}`,
            remark: `Redeemed gift code: ${gift.code}`
        });
        await transaction.save();
        
        // ─── Tᴇʟᴇɢʀᴀᴍ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Tᴏ Uꜱᴇʀ ───
        if (user.telegramId && BOT_TOKEN) {
            await sendTelegramMessage(user.telegramId,
                `<b>────────────────────</b>
<b>🎁 Gɪꜰᴛ Rᴇᴅᴇᴇᴍᴇᴅ!</b>
<b>────────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b>

<b>💰 Aᴍᴏᴜɴᴛ:</b> ₹${gift.amount.toFixed(2)}
<b>💵 Nᴇᴡ Bᴀʟᴀɴᴄᴇ:</b> ₹${user.balance.toFixed(2)}
<b>🆔 Cᴏᴅᴇ:</b> ${gift.code}
<b>📅 Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🛡️ Tᴇᴀᴍ Pʀɪᴍᴇ Wᴀʟʟᴇᴛ
───────────────────────`
            );
        }
        
        await notifyAdmin(
            `<b>────────────────────</b>
<b>🎁 Gɪꜰᴛ Rᴇᴅᴇᴇᴍᴇᴅ</b>
<b>────────────────────</b>

<b>🆔 Cᴏᴅᴇ:</b> ${gift.code}
<b>💰 Aᴍᴏᴜɴᴛ:</b> ₹${gift.amount.toFixed(2)}
<b>👤 Rᴇᴅᴇᴇᴍᴇᴅ Bʏ:</b> ${user.fullName} (${user.walletId})
<b>📅 Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🛡️ Tᴇᴀᴍ Pʀɪᴍᴇ Wᴀʟʟᴇᴛ
───────────────────────`
        );
        
        console.log('🎁 Gɪꜰᴛ Rᴇᴅᴇᴇᴍᴇᴅ:', { code: gift.code, userId, amount: gift.amount });
        
        res.json({
            success: true,
            message: 'Gɪꜰᴛ Rᴇᴅᴇᴇᴍᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ!',
            amount: gift.amount,
            newBalance: user.balance,
            giftCode: gift.code
        });
        
    } catch (error) {
        console.error('❌ Rᴇᴅᴇᴇᴍ Gɪꜰᴛ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Rᴇᴅᴇᴇᴍ Gɪꜰᴛ.'
        });
    }
});

module.exports = router;
