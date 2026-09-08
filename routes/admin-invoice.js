// FILE: routes/admin-invoice.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const Transaction = require('../models/Transaction');
const { auth } = require('../middleware/auth');
require('dotenv').config();

// ============================================
// Tᴇʟᴇɢʀᴀᴍ Cᴏɴꜰɪɢ
// ============================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TG_ID;

// ============================================
// Hᴇʟᴘᴇʀꜱ
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
            console.warn('⚠️ BOT_TOKEN Nᴏᴛ Cᴏɴꜰɪɢᴜʀᴇᴅ');
            resolve({ success: false, error: 'BOT_TOKEN Nᴏᴛ Cᴏɴꜰɪɢᴜʀᴇᴅ' });
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
    if (!ADMIN_TELEGRAM_ID) return;
    try {
        await sendTelegramMessage(ADMIN_TELEGRAM_ID, message);
        console.log('✅ Aᴅᴍɪɴ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Sᴇɴᴛ');
    } catch (error) {
        console.error('❌ Aᴅᴍɪɴ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Fᴀɪʟᴇᴅ:', error.message);
    }
}

// ============================================
// Vᴇʀɪꜰʏ Aᴅᴍɪɴ Tᴏᴋᴇɴ Mɪᴅᴅʟᴇᴡᴀʀᴇ
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
            req.user = { 
                isAdmin: true, 
                fullName: 'Admin',
                tokenType: 'admin_token'
            };
            return next();
        }
        
        try {
            const jwt = require('jsonwebtoken');
            const JWT_SECRET = process.env.JWT_SECRET;
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
                    message: 'Tᴏᴋᴇɴ Hᴀꜱ Exᴘɪʀᴇᴅ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ Aɢᴀɪɴ Tᴏ Rᴇꜰʀᴇꜱʜ Yᴏᴜʀ Sᴇꜱꜱɪᴏɴ.' 
                });
            }
            return res.status(401).json({ 
                success: false, 
                message: 'Aᴜᴛʜᴇɴᴛɪᴄᴀᴛɪᴏɴ Fᴀɪʟᴇᴅ. Pʟᴇᴀꜱᴇ Pʀᴏᴠɪᴅᴇ A Vᴀʟɪᴅ Tᴏᴋᴇɴ.' 
            });
        }
        
    } catch (error) {
        console.error('❌ Tᴏᴋᴇɴ Vᴇʀɪꜰɪᴄᴀᴛɪᴏɴ Eʀʀᴏʀ:', error.message);
        return res.status(500).json({ 
            success: false, 
            message: 'Iɴᴛᴇʀɴᴀʟ Sᴇʀᴠᴇʀ Eʀʀᴏʀ Dᴜʀɪɴɢ Aᴜᴛʜᴇɴᴛɪᴄᴀᴛɪᴏɴ.' 
        });
    }
}

// ============================================
// 1. Gᴇᴛ Aʟʟ Iɴᴠᴏɪᴄᴇꜱ
// ============================================
router.get('/invoices', verifyAdminToken, async (req, res) => {
    try {
        const { status, search, page = 1, limit = 20 } = req.query;
        let query = {};
        
        if (status && status !== 'all') {
            query.status = status;
        }
        
        if (search) {
            query.$or = [
                { invoiceId: { $regex: search, $options: 'i' } },
                { 'metadata.senderMobile': { $regex: search, $options: 'i' } },
                { 'metadata.receiverMobile': { $regex: search, $options: 'i' } }
            ];
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const invoices = await Invoice.find(query)
            .populate('senderId', 'fullName mobile walletId balance')
            .populate('userId', 'fullName mobile walletId balance')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
            
        const total = await Invoice.countDocuments(query);
        const stats = await Invoice.getStats();
        
        res.json({
            success: true,
            stats,
            invoices: invoices.map(inv => ({
                _id: inv._id,
                invoiceId: inv.invoiceId,
                senderId: inv.senderId,
                userId: inv.userId,
                amount: inv.amount,
                status: inv.status,
                statusLabel: inv.statusLabel,
                expiresAt: inv.expiresAt,
                createdAt: inv.createdAt,
                paidAt: inv.paidAt,
                verifiedAt: inv.verifiedAt,
                notes: inv.notes,
                metadata: inv.metadata,
                formattedAmount: inv.formattedAmount,
                isExpired: inv.isExpired(),
                canBePaid: inv.canBePaid(),
                remainingTime: inv.getRemainingTime(),
                formattedRemainingTime: inv.getFormattedRemainingTime()
            })),
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
        
    } catch (error) {
        console.error('❌ Gᴇᴛ Iɴᴠᴏɪᴄᴇꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Iɴᴠᴏɪᴄᴇꜱ: ' + error.message
        });
    }
});

// ============================================
// 2. Gᴇᴛ Sɪɴɢʟᴇ Iɴᴠᴏɪᴄᴇ
// ============================================
router.get('/invoice/:invoiceId', verifyAdminToken, async (req, res) => {
    try {
        const { invoiceId } = req.params;
        
        const invoice = await Invoice.findOne({ invoiceId })
            .populate('senderId', 'fullName mobile walletId balance')
            .populate('userId', 'fullName mobile walletId balance');
        
        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Iɴᴠᴏɪᴄᴇ Nᴏᴛ Fᴏᴜɴᴅ'
            });
        }
        
        res.json({
            success: true,
            invoice: {
                _id: invoice._id,
                invoiceId: invoice.invoiceId,
                senderId: invoice.senderId,
                userId: invoice.userId,
                amount: invoice.amount,
                formattedAmount: invoice.formattedAmount,
                status: invoice.status,
                statusLabel: invoice.statusLabel,
                expiresAt: invoice.expiresAt,
                createdAt: invoice.createdAt,
                paidAt: invoice.paidAt,
                verifiedAt: invoice.verifiedAt,
                notes: invoice.notes,
                metadata: invoice.metadata,
                isExpired: invoice.isExpired(),
                canBePaid: invoice.canBePaid(),
                remainingTime: invoice.getRemainingTime(),
                formattedRemainingTime: invoice.getFormattedRemainingTime()
            }
        });
        
    } catch (error) {
        console.error('❌ Gᴇᴛ Iɴᴠᴏɪᴄᴇ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Iɴᴠᴏɪᴄᴇ: ' + error.message
        });
    }
});

// ============================================
// 3. Gᴇᴛ Uꜱᴇʀ Iɴᴠᴏɪᴄᴇꜱ
// ============================================
router.get('/user-invoices/:userId', verifyAdminToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const { status, page = 1, limit = 20 } = req.query;
        
        const user = await User.findById(userId).select('fullName mobile walletId balance');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ'
            });
        }
        
        let query = {
            $or: [
                { senderId: userId },
                { userId: userId }
            ]
        };
        
        if (status && status !== 'all') {
            query.status = status;
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const invoices = await Invoice.find(query)
            .populate('senderId', 'fullName mobile walletId')
            .populate('userId', 'fullName mobile walletId')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
            
        const total = await Invoice.countDocuments(query);
        
        res.json({
            success: true,
            user,
            invoices: invoices.map(inv => ({
                invoiceId: inv.invoiceId,
                amount: inv.amount,
                status: inv.status,
                statusLabel: inv.statusLabel,
                expiresAt: inv.expiresAt,
                createdAt: inv.createdAt,
                paidAt: inv.paidAt,
                formattedAmount: inv.formattedAmount,
                isExpired: inv.isExpired(),
                remainingTime: inv.getRemainingTime(),
                sender: inv.senderId,
                receiver: inv.userId,
                notes: inv.notes
            })),
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
        
    } catch (error) {
        console.error('❌ Gᴇᴛ Uꜱᴇʀ Iɴᴠᴏɪᴄᴇꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Uꜱᴇʀ Iɴᴠᴏɪᴄᴇꜱ: ' + error.message
        });
    }
});

// ============================================
// 4. Cʟᴇᴀɴᴜᴘ Exᴘɪʀᴇᴅ Iɴᴠᴏɪᴄᴇꜱ
// ============================================
router.post('/cleanup', verifyAdminToken, async (req, res) => {
    try {
        console.log('🧹 Cʟᴇᴀɴɪɴɢ Uᴘ Exᴘɪʀᴇᴅ Iɴᴠᴏɪᴄᴇꜱ');
        
        const result = await Invoice.cleanupExpired();
        
        res.json({
            success: true,
            message: `Cʟᴇᴀɴᴇᴅ Uᴘ ${result.modifiedCount} Exᴘɪʀᴇᴅ Iɴᴠᴏɪᴄᴇꜱ`
        });
        
    } catch (error) {
        console.error('❌ Cʟᴇᴀɴᴜᴘ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Cʟᴇᴀɴᴜᴘ: ' + error.message
        });
    }
});

// ============================================
// 5. Gᴇᴛ Iɴᴠᴏɪᴄᴇ Sᴛᴀᴛꜱ
// ============================================
router.get('/stats', verifyAdminToken, async (req, res) => {
    try {
        const stats = await Invoice.getStats();
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const todayInvoices = await Invoice.find({
            createdAt: { $gte: today, $lt: tomorrow }
        });
        
        const todayStats = {
            total: todayInvoices.length,
            paid: todayInvoices.filter(i => i.status === 'paid').length,
            pending: todayInvoices.filter(i => i.status === 'pending' && !i.isExpired()).length,
            amount: todayInvoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + i.amount, 0)
        };
        
        res.json({
            success: true,
            stats: {
                ...stats,
                today: todayStats
            }
        });
        
    } catch (error) {
        console.error('❌ Gᴇᴛ Sᴛᴀᴛꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Gᴇᴛ Sᴛᴀᴛꜱ: ' + error.message
        });
    }
});

// ============================================
// 6. Dᴇʟᴇᴛᴇ Iɴᴠᴏɪᴄᴇ
// ============================================
router.delete('/delete/:invoiceId', verifyAdminToken, async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const dateTime = getCurrentDateTime();
        
        console.log('🗑️ Aᴅᴍɪɴ Dᴇʟᴇᴛɪɴɢ Iɴᴠᴏɪᴄᴇ:', invoiceId);
        
        const invoice = await Invoice.findOne({ invoiceId });
        
        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Iɴᴠᴏɪᴄᴇ Nᴏᴛ Fᴏᴜɴᴅ'
            });
        }
        
        if (invoice.status === 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Cᴀɴɴᴏᴛ Dᴇʟᴇᴛᴇ A Pᴀɪᴅ Iɴᴠᴏɪᴄᴇ'
            });
        }
        
        const invoiceData = {
            invoiceId: invoice.invoiceId,
            amount: invoice.amount,
            status: invoice.status
        };
        
        await Invoice.findByIdAndDelete(invoice._id);
        
        const adminMessage = 
`<b>─────────────────</b>
<b>🗑️ Iɴᴠᴏɪᴄᴇ Dᴇʟᴇᴛᴇᴅ</b>
<b>─────────────────</b>
🆔 ${invoiceData.invoiceId}
💰 ₹${invoiceData.amount.toFixed(2)}
📊 Sᴛᴀᴛᴜꜱ: ${invoiceData.status}
👤 Aᴅᴍɪɴ: ${req.user.fullName || 'Admin'}
⏰ ${dateTime}`;

        await notifyAdmin(adminMessage);
        
        res.json({
            success: true,
            message: 'Iɴᴠᴏɪᴄᴇ Dᴇʟᴇᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ'
        });
        
    } catch (error) {
        console.error('❌ Dᴇʟᴇᴛᴇ Iɴᴠᴏɪᴄᴇ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Dᴇʟᴇᴛᴇ Iɴᴠᴏɪᴄᴇ: ' + error.message
        });
    }
});

module.exports = router;
