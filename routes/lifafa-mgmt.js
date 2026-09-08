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
        console.error('❌ Gᴇᴛ Lɪꜰᴀꜰᴀꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Lɪꜰᴀꜰᴀꜱ.'
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
        console.error('❌ Gᴇᴛ Lɪꜰᴀꜰᴀ Sᴛᴀᴛꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Sᴛᴀᴛɪꜱᴛɪᴄꜱ.'
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
                message: 'Iɴᴠᴀʟɪᴅ Lɪꜰᴀꜰᴀ ID Fᴏʀᴍᴀᴛ.'
            });
        }
        
        const lifafa = await Lifafa.findById(id)
            .populate('userId', 'fullName mobile walletId username telegramId')
            .populate('claimedUsers.userId', 'fullName mobile walletId username telegramId')
            .populate('claimedUsers.referrerId', 'fullName mobile walletId username telegramId');
        
        if (!lifafa) {
            return res.status(404).json({
                success: false,
                message: `Lɪꜰᴀꜰᴀ Wɪᴛʜ ID "${id}" Nᴏᴛ Fᴏᴜɴᴅ.`
            });
        }
        
        res.json({
            success: true,
            lifafa
        });
    } catch (error) {
        console.error('❌ Gᴇᴛ Lɪꜰᴀꜰᴀ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Lɪꜰᴀꜰᴀ.'
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
                message: `Lɪꜰᴀꜰᴀ Wɪᴛʜ Cᴏᴅᴇ "${code}" Nᴏᴛ Fᴏᴜɴᴅ.`
            });
        }
        
        res.json({
            success: true,
            lifafa
        });
    } catch (error) {
        console.error('❌ Gᴇᴛ Lɪꜰᴀꜰᴀ Bʏ Cᴏᴅᴇ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Lɪꜰᴀꜰᴀ.'
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
        
        // ─── Vᴀʟɪᴅᴀᴛɪᴏɴ ───
        if (!title || title.trim().length < 2) {
            return res.status(400).json({
                success: false,
                message: 'Tɪᴛʟᴇ Mᴜꜱᴛ Bᴇ Aᴛ Lᴇᴀꜱᴛ 2 Cʜᴀʀᴀᴄᴛᴇʀꜱ Lᴏɴɢ.'
            });
        }
        
        if (!totalUsers || totalUsers < 1) {
            return res.status(400).json({
                success: false,
                message: 'Tᴏᴛᴀʟ Uꜱᴇʀꜱ Mᴜꜱᴛ Bᴇ Aᴛ Lᴇᴀꜱᴛ 1.'
            });
        }
        
        if (!perUser || perUser <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Pᴇʀ Uꜱᴇʀ Aᴍᴏᴜɴᴛ Mᴜꜱᴛ Bᴇ Gʀᴇᴀᴛᴇʀ Tʜᴀɴ 0.'
            });
        }
        
        // ─── Cʜᴇᴄᴋ Iꜰ Aᴅᴍɪɴ Hᴀꜱ Eɴᴏᴜɢʜ Bᴀʟᴀɴᴄᴇ ───
        const totalAmount = totalUsers * perUser;
        if (adminUser.balance < totalAmount) {
            return res.status(400).json({
                success: false,
                message: `Iɴꜱᴜꜰꜰɪᴄɪᴇɴᴛ Bᴀʟᴀɴᴄᴇ. Nᴇᴇᴅᴇᴅ: ₹${totalAmount.toFixed(2)}, Aᴠᴀɪʟᴀʙʟᴇ: ₹${adminUser.balance.toFixed(2)}`
            });
        }
        
        // ─── Dᴇᴅᴜᴄᴛ Bᴀʟᴀɴᴄᴇ Fʀᴏᴍ Aᴅᴍɪɴ ───
        adminUser.balance -= totalAmount;
        await adminUser.save();
        
        // ─── Gᴇɴᴇʀᴀᴛᴇ Lɪꜰᴀꜰᴀ ID ───
        const lifafaId = generateLifafaId();
        
        // ─── Cʀᴇᴀᴛᴇ Lɪꜰᴀꜰᴀ ───
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
        
        // ─── Cʀᴇᴀᴛᴇ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ ───
        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.random().toString(36).substring(2, 8).toUpperCase();
        
        const transaction = new Transaction({
            tx_id: `LIF_${timestamp}_${random}`,
            user_id: adminUser._id,
            amount: totalAmount,
            fee: 0,
            type: 'lifafa',
            status: 'success',
            description: `Lɪꜰᴀꜰᴀ Cʀᴇᴀᴛᴇᴅ: ${title.trim()} - ${lifafaId}`,
            remark: `Lifafa created by admin: ${adminUser.walletId}`
        });
        await transaction.save();
        
        // ─── Tᴇʟᴇɢʀᴀᴍ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ ───
        if (adminUser.telegramId && BOT_TOKEN) {
            await sendTelegramMessage(adminUser.telegramId,
                `<b>────────────────────</b>
<b>📨 Lɪꜰᴀꜰᴀ Cʀᴇᴀᴛᴇᴅ</b>
<b>────────────────────</b>

<b>👤 Dᴇᴀʀ ${adminUser.fullName},</b>

<b>🆔 Lɪꜰᴀꜰᴀ Iᴅ:</b> ${lifafaId}
<b>📝 Tɪᴛʟᴇ:</b> ${title.trim()}
<b>💰 Tᴏᴛᴀʟ Aᴍᴏᴜɴᴛ:</b> ₹${totalAmount.toFixed(2)}
<b>👥 Tᴏᴛᴀʟ Uꜱᴇʀꜱ:</b> ${totalUsers}
<b>💵 Pᴇʀ Uꜱᴇʀ:</b> ₹${perUser.toFixed(2)}
<b>📅 Cʀᴇᴀᴛᴇᴅ:</b> ${dateTime}

───────────────────────
🛡️ Tᴇᴀᴍ Pʀɪᴍᴇ Wᴀʟʟᴇᴛ
───────────────────────`
            );
        }
        
        // ─── Tᴇʟᴇɢʀᴀᴍ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Tᴏ Aᴅᴍɪɴ ───
        await notifyAdmin(
            `<b>────────────────────</b>
<b>📨 Lɪꜰᴀꜰᴀ Cʀᴇᴀᴛᴇᴅ</b>
<b>────────────────────</b>

<b>🆔 Lɪꜰᴀꜰᴀ Iᴅ:</b> ${lifafaId}
<b>📝 Tɪᴛʟᴇ:</b> ${title.trim()}
<b>👤 Cʀᴇᴀᴛᴇᴅ Bʏ:</b> ${adminUser.fullName} (${adminUser.walletId})
<b>💰 Tᴏᴛᴀʟ Aᴍᴏᴜɴᴛ:</b> ₹${totalAmount.toFixed(2)}
<b>👥 Tᴏᴛᴀʟ Uꜱᴇʀꜱ:</b> ${totalUsers}
<b>💵 Pᴇʀ Uꜱᴇʀ:</b> ₹${perUser.toFixed(2)}
<b>📅 Cʀᴇᴀᴛᴇᴅ:</b> ${dateTime}

───────────────────────
🛡️ Tᴇᴀᴍ Pʀɪᴍᴇ Wᴀʟʟᴇᴛ
───────────────────────`
        );
        
        console.log('✅ Lɪꜰᴀꜰᴀ Cʀᴇᴀᴛᴇᴅ:', { lifafaId, title, totalAmount, totalUsers, adminWalletId: adminUser.walletId });
        
        res.json({
            success: true,
            message: 'Lɪꜰᴀꜰᴀ Cʀᴇᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ!',
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
        console.error('❌ Cʀᴇᴀᴛᴇ Lɪꜰᴀꜰᴀ Eʀʀᴏʀ:', error.message);
        
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'Dᴜᴘʟɪᴄᴀᴛᴇ Lɪꜰᴀꜰᴀ ID Dᴇᴛᴇᴄᴛᴇᴅ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.'
            });
        }
        
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Cʀᴇᴀᴛᴇ Lɪꜰᴀꜰᴀ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ Lᴀᴛᴇʀ.'
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
                message: 'Iɴᴠᴀʟɪᴅ Lɪꜰᴀꜰᴀ ID Fᴏʀᴍᴀᴛ.'
            });
        }
        
        const lifafa = await Lifafa.findById(id).populate('userId', 'fullName mobile telegramId walletId');
        if (!lifafa) {
            return res.status(404).json({
                success: false,
                message: `Lɪꜰᴀꜰᴀ Wɪᴛʜ ID "${id}" Nᴏᴛ Fᴏᴜɴᴅ.`
            });
        }
        
        if (lifafa.claimedUsers.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Cᴀɴɴᴏᴛ Dᴇʟᴇᴛᴇ Lɪꜰᴀꜰᴀ - Iᴛ Hᴀꜱ Bᴇᴇɴ Cʟᴀɪᴍᴇᴅ Bʏ ${lifafa.claimedUsers.length} Uꜱᴇʀꜱ.`
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
                description: `Lɪꜰᴀꜰᴀ Rᴇꜰᴜɴᴅ: ${lifafa.title} (${lifafa.lifafaId})`,
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
        
        // ─── Tᴇʟᴇɢʀᴀᴍ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ ───
        if (user && user.telegramId && BOT_TOKEN) {
            await sendTelegramMessage(user.telegramId,
                `<b>────────────────────</b>
<b>🗑️ Lɪꜰᴀꜰᴀ Dᴇʟᴇᴛᴇᴅ</b>
<b>────────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜʀ Lɪꜰᴀꜰᴀ Hᴀꜱ Bᴇᴇɴ Dᴇʟᴇᴛᴇᴅ.

<b>🆔 Lɪꜰᴀꜰᴀ Iᴅ:</b> ${lifafaInfo.lifafaId}
<b>📝 Tɪᴛʟᴇ:</b> ${lifafaInfo.title}
<b>💰 Rᴇꜰᴜɴᴅ:</b> ₹${lifafaInfo.totalAmount.toFixed(2)}
<b>📅 Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🛡️ Tᴇᴀᴍ Pʀɪᴍᴇ Wᴀʟʟᴇᴛ
───────────────────────`
            );
        }
        
        await notifyAdmin(
            `<b>────────────────────</b>
<b>🗑️ Lɪꜰᴀꜰᴀ Dᴇʟᴇᴛᴇᴅ</b>
<b>────────────────────</b>

<b>🆔 Lɪꜰᴀꜰᴀ Iᴅ:</b> ${lifafaInfo.lifafaId}
<b>📝 Tɪᴛʟᴇ:</b> ${lifafaInfo.title}
<b>👤 Uꜱᴇʀ:</b> ${user ? user.fullName : 'Unknown'} (${user ? user.walletId : 'N/A'})
<b>💰 Rᴇꜰᴜɴᴅ:</b> ₹${lifafaInfo.totalAmount.toFixed(2)}
<b>📅 Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🛡️ Tᴇᴀᴍ Pʀɪᴍᴇ Wᴀʟʟᴇᴛ
───────────────────────`
        );
        
        console.log('🗑️ Lɪꜰᴀꜰᴀ Dᴇʟᴇᴛᴇᴅ:', lifafaInfo);
        
        res.json({
            success: true,
            message: `Lɪꜰᴀꜰᴀ "${lifafaInfo.title}" Dᴇʟᴇᴛᴇᴅ. Rᴇꜰᴜɴᴅ: ₹${lifafaInfo.totalAmount.toFixed(2)}`
        });
        
    } catch (error) {
        console.error('❌ Dᴇʟᴇᴛᴇ Lɪꜰᴀꜰᴀ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Dᴇʟᴇᴛᴇ Lɪꜰᴀꜰᴀ.'
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
                message: 'Iɴᴠᴀʟɪᴅ Lɪꜰᴀꜰᴀ ID Fᴏʀᴍᴀᴛ.'
            });
        }
        
        if (!['active', 'completed', 'expired', 'cancelled'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Iɴᴠᴀʟɪᴅ Sᴛᴀᴛᴜꜱ.'
            });
        }
        
        const lifafa = await Lifafa.findById(id).populate('userId', 'fullName mobile telegramId walletId');
        if (!lifafa) {
            return res.status(404).json({
                success: false,
                message: `Lɪꜰᴀꜰᴀ Wɪᴛʜ ID "${id}" Nᴏᴛ Fᴏᴜɴᴅ.`
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
                        description: `Lɪꜰᴀꜰᴀ Cᴀɴᴄᴇʟʟᴀᴛɪᴏɴ Rᴇꜰᴜɴᴅ: ${lifafa.title}`,
                        remark: `Refund for cancelled lifafa: ${lifafa.lifafaId}`
                    });
                    await transaction.save();
                }
            }
        }
        
        lifafa.status = status;
        await lifafa.save();
        
        // ─── Tᴇʟᴇɢʀᴀᴍ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ ───
        if (lifafa.userId && lifafa.userId.telegramId && BOT_TOKEN) {
            const statusEmoji = status === 'cancelled' ? '❌' : '🔄';
            const statusText = status.charAt(0).toUpperCase() + status.slice(1);
            
            await sendTelegramMessage(lifafa.userId.telegramId,
                `<b>────────────────────</b>
<b>${statusEmoji} Lɪꜰᴀꜰᴀ ${statusText}</b>
<b>────────────────────</b>

<b>👤 Dᴇᴀʀ ${lifafa.userId.fullName},</b>

<b>🆔 Lɪꜰᴀꜰᴀ Iᴅ:</b> ${lifafa.lifafaId}
<b>📝 Tɪᴛʟᴇ:</b> ${lifafa.title}
<b>📊 Nᴇᴡ Sᴛᴀᴛᴜꜱ:</b> ${statusText}
${refundAmount > 0 ? `<b>💰 Rᴇꜰᴜɴᴅ:</b> ₹${refundAmount.toFixed(2)}` : ''}
<b>📅 Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🛡️ Tᴇᴀᴍ Pʀɪᴍᴇ Wᴀʟʟᴇᴛ
───────────────────────`
            );
        }
        
        await notifyAdmin(
            `<b>────────────────────</b>
<b>🔄 Lɪꜰᴀꜰᴀ Sᴛᴀᴛᴜꜱ Uᴘᴅᴀᴛᴇᴅ</b>
<b>────────────────────</b>

<b>🆔 Lɪꜰᴀꜰᴀ Iᴅ:</b> ${lifafa.lifafaId}
<b>📝 Tɪᴛʟᴇ:</b> ${lifafa.title}
<b>👤 Uꜱᴇʀ:</b> ${lifafa.userId ? lifafa.userId.fullName : 'Unknown'}
<b>📊 Nᴇᴡ Sᴛᴀᴛᴜꜱ:</b> ${statusText}
${refundAmount > 0 ? `<b>💰 Rᴇꜰᴜɴᴅ:</b> ₹${refundAmount.toFixed(2)}` : ''}
<b>📅 Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🛡️ Tᴇᴀᴍ Pʀɪᴍᴇ Wᴀʟʟᴇᴛ
───────────────────────`
        );
        
        console.log('🔄 Lɪꜰᴀꜰᴀ Sᴛᴀᴛᴜꜱ Uᴘᴅᴀᴛᴇᴅ:', { lifafaId: lifafa.lifafaId, status, refundAmount });
        
        res.json({
            success: true,
            message: `Lɪꜰᴀꜰᴀ Sᴛᴀᴛᴜꜱ Uᴘᴅᴀᴛᴇᴅ Tᴏ "${status}".`,
            lifafa: {
                _id: lifafa._id,
                lifafaId: lifafa.lifafaId,
                title: lifafa.title,
                status: lifafa.status,
                refundAmount: refundAmount
            }
        });
        
    } catch (error) {
        console.error('❌ Uᴘᴅᴀᴛᴇ Lɪꜰᴀꜰᴀ Sᴛᴀᴛᴜꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Uᴘᴅᴀᴛᴇ Lɪꜰᴀꜰᴀ Sᴛᴀᴛᴜꜱ.'
        });
    }
});

module.exports = router;
