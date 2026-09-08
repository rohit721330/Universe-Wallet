// FILE: routes/deposit.js
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const Deposit = require('../models/Deposit');
const Transaction = require('../models/Transaction');
require('dotenv').config();

// ===== TELEGRAM BOT CONFIGURATION =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TG_ID;
const ADMIN_UPI = process.env.ADMIN_UPI_ID;

// ===== HELPERS =====

// Generate Deposit ID (Manual)
function generateDepositId() {
    return 'DEP_' + Date.now().toString(36).toUpperCase() + Math.floor(1000 + Math.random() * 9000);
}

// Generate Transaction ID
function generateDepositTxnId() {
    return 'TXN_DEPOSIT_' + Date.now() + Math.floor(Math.random() * 99999);
}

// Get current date time in IST
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

// Generate QR Code
function generateQRCode(amount) {
    const upiData = `upi://pay?pa=${ADMIN_UPI}&am=${amount}&cu=INR&tn=Prime%20Wallet%20Deposit`;
    return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiData)}`;
}

// Send Telegram Message
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

// Notify Admin
async function notifyAdmin(message) {
    if (!ADMIN_TELEGRAM_ID) return;
    try {
        await sendTelegramMessage(ADMIN_TELEGRAM_ID, message);
        console.log('✅ Aᴅᴍɪɴ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Sᴇɴᴛ');
    } catch (error) {
        console.error('❌ Aᴅᴍɪɴ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Fᴀɪʟᴇᴅ:', error.message);
    }
}

// Notify User
async function notifyUser(chatId, message) {
    if (!chatId) return;
    try {
        await sendTelegramMessage(chatId, message);
        console.log('✅ Uꜱᴇʀ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Sᴇɴᴛ');
    } catch (error) {
        console.error('❌ Uꜱᴇʀ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Fᴀɪʟᴇᴅ:', error.message);
    }
}

// ============================================
// 1. GET USER PROFILE (BALANCE)
// ============================================
router.get('/profile/me', auth, async (req, res) => {
    try {
        console.log('📥 Fᴇᴛᴄʜɪɴɢ Pʀᴏꜰɪʟᴇ Fᴏʀ Uꜱᴇʀ:', req.userId);

        const user = await User.findById(req.userId).select('-password -pin -__v');
        
        if (!user) {
            console.log('❌ Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ');
            return res.status(404).json({
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ'
            });
        }

        console.log('✅ Pʀᴏꜰɪʟᴇ Fᴇᴛᴄʜᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ');
        res.json({
            success: true,
            user: user
        });
    } catch (error) {
        console.error('⚠️ Pʀᴏꜰɪʟᴇ Fᴇᴛᴄʜ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Iɴᴛᴇʀɴᴀʟ Sᴇʀᴠᴇʀ Eʀʀᴏʀ: ' + error.message
        });
    }
});

// ============================================
// 2. CREATE DEPOSIT (Manual) - NO NOTIFICATION
// ============================================
router.post('/create', auth, async (req, res) => {
    try {
        const { amount } = req.body;
        const userId = req.user.id;

        console.log('📝 Cʀᴇᴀᴛɪɴɢ Mᴀɴᴜᴀʟ Dᴇᴘᴏꜱɪᴛ:', { userId, amount });

        if (!amount || amount < 1 || amount > 5000) {
            return res.status(400).json({
                success: false,
                message: 'Iɴᴠᴀʟɪᴅ Aᴍᴏᴜɴᴛ. Mɪɴ ₹𝟷, Mᴀx ₹𝟻,𝟶𝟶𝟶'
            });
        }

        const existing = await Deposit.findOne({
            userId,
            status: 'pending',
            expiresAt: { $gt: new Date() }
        });

        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Yᴏᴜ Hᴀᴠᴇ A Pᴇɴᴅɪɴɢ Iɴᴠᴏɪᴄᴇ',
                pendingDeposit: {
                    depositId: existing.depositId,
                    amount: existing.amount,
                    expiresAt: existing.expiresAt
                }
            });
        }

        const depositId = generateDepositId();

        const deposit = new Deposit({
            userId: userId,
            amount: amount,
            upiId: ADMIN_UPI,
            status: 'pending',
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            depositId: depositId
        });
        
        await deposit.save();
        console.log('✅ Mᴀɴᴜᴀʟ Dᴇᴘᴏꜱɪᴛ Cʀᴇᴀᴛᴇᴅ Wɪᴛʜ Dᴇᴘᴏꜱɪᴛ Iᴅ:', deposit.depositId);

        const qrCode = generateQRCode(amount);
        deposit.qrData = qrCode;
        await deposit.save();

        res.json({
            success: true,
            message: 'Dᴇᴘᴏꜱɪᴛ Iɴᴠᴏɪᴄᴇ Cʀᴇᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ',
            deposit: {
                depositId: deposit.depositId,
                amount: deposit.amount,
                qrCode: qrCode,
                expiresAt: deposit.expiresAt,
                upiId: ADMIN_UPI
            }
        });

    } catch (error) {
        console.error('❌ Cʀᴇᴀᴛᴇ Dᴇᴘᴏꜱɪᴛ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ'
        });
    }
});

// ============================================
// 3. SUBMIT UTR FOR MANUAL APPROVAL (NOTIFICATION HERE)
// ============================================
router.post('/submit-utr', auth, async (req, res) => {
    try {
        const { depositId, transactionRef } = req.body;
        const userId = req.user.id;
        const dateTime = getCurrentDateTime();

        console.log('📝 UTR Sᴜʙᴍɪꜱꜱɪᴏɴ:', { userId, depositId, transactionRef });

        if (!depositId) {
            return res.status(400).json({
                success: false,
                message: 'Dᴇᴘᴏꜱɪᴛ Iᴅ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        if (!transactionRef || transactionRef.length < 12) {
            return res.status(400).json({
                success: false,
                message: 'Vᴀʟɪᴅ UTR (Mɪɴ 12 Cʜᴀʀᴀᴄᴛᴇʀꜱ) Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        const deposit = await Deposit.findOne({ depositId, userId, status: 'pending' });
        
        if (!deposit) {
            console.log('❌ Pᴇɴᴅɪɴɢ Dᴇᴘᴏꜱɪᴛ Nᴏᴛ Fᴏᴜɴᴅ');
            return res.status(404).json({
                success: false,
                message: 'Pᴇɴᴅɪɴɢ Dᴇᴘᴏꜱɪᴛ Nᴏᴛ Fᴏᴜɴᴅ'
            });
        }

        if (deposit.isExpired()) {
            deposit.status = 'cancelled';
            await deposit.save();
            console.log('⏰ Dᴇᴘᴏꜱɪᴛ Exᴘɪʀᴇᴅ:', depositId);
            return res.status(400).json({
                success: false,
                message: 'Tʜɪꜱ Dᴇᴘᴏꜱɪᴛ Hᴀꜱ Exᴘɪʀᴇᴅ'
            });
        }

        const existingUtr = await Deposit.findOne({ 
            transactionRef: transactionRef,
            status: { $in: ['pending_approval', 'approved'] }
        });
        
        if (existingUtr) {
            return res.status(400).json({
                success: false,
                message: 'Tʜɪꜱ UTR Hᴀꜱ Aʟʀᴇᴀᴅʏ Bᴇᴇɴ Uꜱᴇᴅ'
            });
        }

        deposit.transactionRef = transactionRef;
        deposit.status = 'pending_approval';
        deposit.verifiedAt = new Date();
        await deposit.save();

        console.log('✅ UTR Sᴜʙᴍɪᴛᴛᴇᴅ Fᴏʀ Aᴘᴘʀᴏᴠᴀʟ:', depositId);

        const user = await User.findById(userId);

        // ===== SEND NOTIFICATION TO ADMIN =====
        const adminMessage = 
`<b>─────────────────</b>
<b>📝 UTR Sᴜʙᴍɪᴛᴛᴇᴅ - Pᴇɴᴅɪɴɢ Aᴘᴘʀᴏᴠᴀʟ</b>
<b>─────────────────</b>
👤 ${user.fullName || 'N/A'}
🆔 ${user.walletId || 'N/A'}
💰 ₹${deposit.amount.toFixed(2)}
🆔 ${deposit.depositId}
🔑 ${transactionRef}
⏰ ${dateTime}`;

        await notifyAdmin(adminMessage);

        // ===== SEND NOTIFICATION TO USER =====
        if (user.telegramId) {
            const userMessage = 
`<b>─────────────────</b>
<b>⏳ UTR Sᴜʙᴍɪᴛᴛᴇᴅ Fᴏʀ Aᴘᴘʀᴏᴠᴀʟ</b>
<b>─────────────────</b>
👤 ${user.fullName}
💰 ₹${deposit.amount.toFixed(2)}
🆔 ${deposit.depositId}
🔑 ${transactionRef}
⏰ ${dateTime}`;

            await notifyUser(user.telegramId, userMessage);
        }

        res.json({
            success: true,
            message: 'UTR Sᴜʙᴍɪᴛᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ. Wᴀɪᴛɪɴɢ Fᴏʀ Aᴅᴍɪɴ Aᴘᴘʀᴏᴠᴀʟ.',
            status: 'pending_approval',
            depositId: deposit.depositId,
            amount: deposit.amount,
            transactionRef: transactionRef,
            submittedAt: dateTime
        });

    } catch (error) {
        console.error('❌ UTR Sᴜʙᴍɪꜱꜱɪᴏɴ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ'
        });
    }
});

// ============================================
// 4. GET PENDING DEPOSITS (User)
// ============================================
router.get('/pending', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        console.log('📋 Fᴇᴛᴄʜɪɴɢ Pᴇɴᴅɪɴɢ Dᴇᴘᴏꜱɪᴛꜱ Fᴏʀ Uꜱᴇʀ:', userId);

        const pendingDeposits = await Deposit.find({
            userId: userId,
            status: 'pending',
            expiresAt: { $gt: new Date() }
        }).sort({ createdAt: -1 });

        console.log('✅ Fᴏᴜɴᴅ', pendingDeposits.length, 'Pᴇɴᴅɪɴɢ Dᴇᴘᴏꜱɪᴛꜱ');

        const depositsWithQR = pendingDeposits.map(deposit => ({
            depositId: deposit.depositId,
            amount: deposit.amount,
            qrCode: deposit.qrData,
            upiId: deposit.upiId,
            expiresAt: deposit.expiresAt,
            createdAt: deposit.createdAt
        }));

        res.json({
            success: true,
            deposits: depositsWithQR
        });

    } catch (error) {
        console.error('❌ Gᴇᴛ Pᴇɴᴅɪɴɢ Dᴇᴘᴏꜱɪᴛꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ'
        });
    }
});

// ============================================
// 5. CANCEL PENDING DEPOSIT
// ============================================
router.post('/cancel/:depositId', auth, async (req, res) => {
    try {
        const { depositId } = req.params;
        const userId = req.user.id;
        const dateTime = getCurrentDateTime();

        console.log('🗑️ Cᴀɴᴄᴇʟʟɪɴɢ Dᴇᴘᴏꜱɪᴛ:', { userId, depositId });

        const deposit = await Deposit.findOne({ 
            depositId: depositId, 
            userId: userId,
            status: 'pending'
        });

        if (!deposit) {
            return res.status(404).json({
                success: false,
                message: 'Pᴇɴᴅɪɴɢ Dᴇᴘᴏꜱɪᴛ Nᴏᴛ Fᴏᴜɴᴅ'
            });
        }

        if (deposit.isExpired()) {
            deposit.status = 'cancelled';
            await deposit.save();
            return res.status(400).json({
                success: false,
                message: 'Tʜɪꜱ Dᴇᴘᴏꜱɪᴛ Hᴀꜱ Exᴘɪʀᴇᴅ'
            });
        }

        deposit.status = 'cancelled';
        await deposit.save();

        console.log('✅ Dᴇᴘᴏꜱɪᴛ Cᴀɴᴄᴇʟʟᴇᴅ:', depositId);

        const user = await User.findById(userId);

        // ===== SEND NOTIFICATION TO ADMIN =====
        const adminMessage = 
`<b>─────────────────</b>
<b>🗑️ Dᴇᴘᴏꜱɪᴛ Cᴀɴᴄᴇʟʟᴇᴅ</b>
<b>─────────────────</b>
👤 ${user?.fullName || 'N/A'}
💰 ₹${deposit.amount.toFixed(2)}
🆔 ${deposit.depositId}
⏰ ${dateTime}`;

        await notifyAdmin(adminMessage);

        // ===== SEND NOTIFICATION TO USER =====
        if (user?.telegramId) {
            const userMessage = 
`<b>─────────────────</b>
<b>🗑️ Dᴇᴘᴏꜱɪᴛ Cᴀɴᴄᴇʟʟᴇᴅ</b>
<b>─────────────────</b>
👤 ${user.fullName}
💰 ₹${deposit.amount.toFixed(2)}
🆔 ${deposit.depositId}
⏰ ${dateTime}`;

            await notifyUser(user.telegramId, userMessage);
        }

        res.json({
            success: true,
            message: 'Dᴇᴘᴏꜱɪᴛ Cᴀɴᴄᴇʟʟᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ'
        });

    } catch (error) {
        console.error('❌ Cᴀɴᴄᴇʟ Dᴇᴘᴏꜱɪᴛ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ'
        });
    }
});

// ============================================
// 6. ADMIN APPROVE DEPOSIT (NOTIFICATION HERE)
// ============================================
router.post('/admin/approve/:depositId', auth, async (req, res) => {
    try {
        const { depositId } = req.params;
        const adminId = req.user.id;
        const dateTime = getCurrentDateTime();

        console.log('✅ Aᴅᴍɪɴ Aᴘᴘʀᴏᴠɪɴɢ Dᴇᴘᴏꜱɪᴛ:', { adminId, depositId });

        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Aᴅᴍɪɴ Aᴄᴄᴇꜱꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        const deposit = await Deposit.findOne({ 
            depositId: depositId, 
            status: 'pending_approval'
        });

        if (!deposit) {
            return res.status(404).json({
                success: false,
                message: 'Dᴇᴘᴏꜱɪᴛ Nᴏᴛ Fᴏᴜɴᴅ Oʀ Nᴏᴛ Pᴇɴᴅɪɴɢ Aᴘᴘʀᴏᴠᴀʟ'
            });
        }

        deposit.status = 'approved';
        deposit.approvedBy = adminId;
        deposit.approvedAt = new Date();
        await deposit.save();

        const user = await User.findById(deposit.userId);
        user.balance += deposit.amount;
        await user.save();

        const txnId = generateDepositTxnId();

        const transaction = new Transaction({
            tx_id: txnId,
            user_id: deposit.userId,
            sender_id: deposit.userId,
            receiver_id: deposit.userId,
            amount: deposit.amount,
            type: 'deposit',
            status: 'success',
            remark: 'Manual deposit approved by admin',
            description: 'Manual deposit approved by admin',
            tx_time: new Date(),
            metadata: {
                depositId: deposit.depositId,
                transactionRef: deposit.transactionRef,
                type: 'admin_approved'
            }
        });
        await transaction.save();

        console.log('✅ Dᴇᴘᴏꜱɪᴛ Aᴘᴘʀᴏᴠᴇᴅ:', depositId);

        // ===== SEND NOTIFICATION TO ADMIN =====
        const adminConfirmMessage = 
`<b>─────────────────</b>
<b>✅ Dᴇᴘᴏꜱɪᴛ Aᴘᴘʀᴏᴠᴇᴅ</b>
<b>─────────────────</b>
👤 ${user.fullName || 'N/A'}
💰 ₹${deposit.amount.toFixed(2)}
🆔 ${deposit.depositId}
🔑 ${txnId}
🔑 UTR: ${deposit.transactionRef}
💳 ₹${user.balance.toFixed(2)}
⏰ ${dateTime}`;

        await notifyAdmin(adminConfirmMessage);

        // ===== SEND NOTIFICATION TO USER =====
        if (user.telegramId) {
            const userMessage = 
`<b>─────────────────</b>
<b>✅ Dᴇᴘᴏꜱɪᴛ Aᴘᴘʀᴏᴠᴇᴅ!</b>
<b>─────────────────</b>
👤 ${user.fullName}
💰 ₹${deposit.amount.toFixed(2)}
🆔 ${deposit.depositId}
🔑 ${txnId}
💳 ₹${user.balance.toFixed(2)}
⏰ ${dateTime}`;

            await notifyUser(user.telegramId, userMessage);
        }

        res.json({
            success: true,
            message: 'Dᴇᴘᴏꜱɪᴛ Aᴘᴘʀᴏᴠᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ',
            amount: deposit.amount,
            transactionId: txnId,
            newBalance: user.balance
        });

    } catch (error) {
        console.error('❌ Aᴘᴘʀᴏᴠᴇ Dᴇᴘᴏꜱɪᴛ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ'
        });
    }
});

// ============================================
// 7. ADMIN REJECT DEPOSIT (NOTIFICATION HERE)
// ============================================
router.post('/admin/reject/:depositId', auth, async (req, res) => {
    try {
        const { depositId } = req.params;
        const adminId = req.user.id;
        const { reason } = req.body;
        const dateTime = getCurrentDateTime();

        console.log('❌ Aᴅᴍɪɴ Rᴇᴊᴇᴄᴛɪɴɢ Dᴇᴘᴏꜱɪᴛ:', { adminId, depositId });

        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Aᴅᴍɪɴ Aᴄᴄᴇꜱꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        const deposit = await Deposit.findOne({ 
            depositId: depositId, 
            status: 'pending_approval'
        });

        if (!deposit) {
            return res.status(404).json({
                success: false,
                message: 'Dᴇᴘᴏꜱɪᴛ Nᴏᴛ Fᴏᴜɴᴅ Oʀ Nᴏᴛ Pᴇɴᴅɪɴɢ Aᴘᴘʀᴏᴠᴀʟ'
            });
        }

        deposit.status = 'rejected';
        deposit.rejectedBy = adminId;
        deposit.rejectedAt = new Date();
        deposit.adminNote = reason || 'Nᴏ ʀᴇᴀꜱᴏɴ ᴘʀᴏᴠɪᴅᴇᴅ';
        await deposit.save();

        console.log('❌ Dᴇᴘᴏꜱɪᴛ Rᴇᴊᴇᴄᴛᴇᴅ:', depositId);

        const user = await User.findById(deposit.userId);

        // ===== SEND NOTIFICATION TO ADMIN =====
        const adminConfirmMessage = 
`<b>─────────────────</b>
<b>❌ Dᴇᴘᴏꜱɪᴛ Rᴇᴊᴇᴄᴛᴇᴅ</b>
<b>─────────────────</b>
👤 ${user?.fullName || 'N/A'}
💰 ₹${deposit.amount.toFixed(2)}
🆔 ${deposit.depositId}
🔑 UTR: ${deposit.transactionRef}
📝 Rᴇᴀꜱᴏɴ: ${deposit.adminNote}
⏰ ${dateTime}`;

        await notifyAdmin(adminConfirmMessage);

        // ===== SEND NOTIFICATION TO USER =====
        if (user?.telegramId) {
            const userMessage = 
`<b>─────────────────</b>
<b>❌ Dᴇᴘᴏꜱɪᴛ Rᴇᴊᴇᴄᴛᴇᴅ</b>
<b>─────────────────</b>
👤 ${user.fullName}
💰 ₹${deposit.amount.toFixed(2)}
🆔 ${deposit.depositId}
📝 Rᴇᴀꜱᴏɴ: ${deposit.adminNote}
⏰ ${dateTime}`;

            await notifyUser(user.telegramId, userMessage);
        }

        res.json({
            success: true,
            message: 'Dᴇᴘᴏꜱɪᴛ Rᴇᴊᴇᴄᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ',
            reason: deposit.adminNote
        });

    } catch (error) {
        console.error('❌ Rᴇᴊᴇᴄᴛ Dᴇᴘᴏꜱɪᴛ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ'
        });
    }
});

// ============================================
// 8. GET MY DEPOSITS HISTORY
// ============================================
router.get('/my-deposits', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { status, limit = 20, page = 1 } = req.query;

        console.log('📜 Fᴇᴛᴄʜɪɴɢ Dᴇᴘᴏꜱɪᴛꜱ:', { userId, status, page, limit });

        const filter = { userId };
        if (status) filter.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const deposits = await Deposit.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Deposit.countDocuments(filter);

        const depositsWithDetails = deposits.map(deposit => ({
            depositId: deposit.depositId,
            amount: deposit.amount,
            status: deposit.status,
            qrCode: deposit.qrData,
            upiId: deposit.upiId,
            expiresAt: deposit.expiresAt,
            createdAt: deposit.createdAt,
            transactionRef: deposit.transactionRef || null,
            approvedAt: deposit.approvedAt || null,
            rejectedAt: deposit.rejectedAt || null,
            adminNote: deposit.adminNote || null
        }));

        console.log('✅ Dᴇᴘᴏꜱɪᴛꜱ Fᴇᴛᴄʜᴇᴅ:', deposits.length);

        res.json({
            success: true,
            deposits: depositsWithDetails,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });

    } catch (error) {
        console.error('❌ Gᴇᴛ Dᴇᴘᴏꜱɪᴛꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ'
        });
    }
});

// ============================================
// 9. GET SINGLE DEPOSIT BY ID
// ============================================
router.get('/:depositId', auth, async (req, res) => {
    try {
        const { depositId } = req.params;
        const userId = req.user.id;

        console.log('🔍 Fᴇᴛᴄʜɪɴɢ Dᴇᴘᴏꜱɪᴛ:', { userId, depositId });

        const deposit = await Deposit.findOne({ depositId, userId });

        if (!deposit) {
            return res.status(404).json({
                success: false,
                message: 'Dᴇᴘᴏꜱɪᴛ Nᴏᴛ Fᴏᴜɴᴅ'
            });
        }

        res.json({
            success: true,
            deposit: {
                depositId: deposit.depositId,
                amount: deposit.amount,
                status: deposit.status,
                qrCode: deposit.qrData,
                upiId: deposit.upiId,
                expiresAt: deposit.expiresAt,
                createdAt: deposit.createdAt,
                transactionRef: deposit.transactionRef || null,
                approvedAt: deposit.approvedAt || null,
                rejectedAt: deposit.rejectedAt || null,
                adminNote: deposit.adminNote || null
            }
        });

    } catch (error) {
        console.error('❌ Gᴇᴛ Dᴇᴘᴏꜱɪᴛ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ'
        });
    }
});

// ============================================
// 10. CLEANUP EXPIRED DEPOSITS (Admin only)
// ============================================
router.post('/cleanup-expired', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Aᴅᴍɪɴ Aᴄᴄᴇꜱꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        console.log('🧹 Cʟᴇᴀɴɪɴɢ Uᴘ Exᴘɪʀᴇᴅ Dᴇᴘᴏꜱɪᴛꜱ');

        const result = await Deposit.cleanupExpired();
        
        console.log('✅ Cʟᴇᴀɴᴇᴅ Uᴘ:', result.modifiedCount);

        res.json({
            success: true,
            message: `Cʟᴇᴀɴᴇᴅ ᴜᴘ ${result.modifiedCount} ᴇxᴘɪʀᴇᴅ ᴅᴇᴘᴏꜱɪᴛꜱ`
        });

    } catch (error) {
        console.error('❌ Cʟᴇᴀɴᴜᴘ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: error.message || 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ'
        });
    }
});

module.exports = router;
