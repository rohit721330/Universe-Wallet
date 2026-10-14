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
const ADMIN_UPI = process.env.ADMIN_UPI_ID || 'admin@upi';

// ===== HELPERS =====
function generateDepositId() {
    return 'DEP_' + Date.now().toString(36).toUpperCase() + Math.floor(1000 + Math.random() * 9000);
}

function getCurrentDateTime() {
    const now = new Date();
    return now.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
}

function generateQRCode(amount) {
    const upiData = `upi://pay?pa=${ADMIN_UPI}&am=${amount}&cu=INR&tn=Universal%20Wallet%20Deposit`;
    return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(upiData)}`;
}

async function sendTelegramMessage(chatId, message) {
    return new Promise((resolve) => {
        const https = require('https');
        if (!BOT_TOKEN) {
            resolve({ success: false, error: 'BOT_TOKEN not configured' });
            return;
        }
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const data = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' });
        const request = https.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
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
    if (!ADMIN_TELEGRAM_ID) return;
    try { await sendTelegramMessage(ADMIN_TELEGRAM_ID, message); }
    catch (error) { console.error('Admin Notification Failed:', error.message); }
}

async function notifyUser(chatId, message) {
    if (!chatId) return;
    try { await sendTelegramMessage(chatId, message); }
    catch (error) { console.error('User Notification Failed:', error.message); }
}

// ============================================
// 0. GET PUBLIC CONFIG
// ============================================
router.get('/config', (req, res) => {
    try {
        res.json({ success: true, upiId: ADMIN_UPI, minAmount: 1, maxAmount: 5000 });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Config error' });
    }
});

// ============================================
// 1. GET USER PROFILE
// ============================================
router.get('/profile/me', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId).select('-password -pin -__v');
        if (!user) return res.status(404).json({ success: false, message: 'User Not Found' });
        res.json({ success: true, user });
    } catch (error) {
        console.error('Profile Fetch Error:', error.message);
        res.status(500).json({ success: false, message: 'Internal Server Error: ' + error.message });
    }
});

// ============================================
// 2. CREATE DEPOSIT INVOICE
// ✅ NO DB entry — only returns invoice to user
// User pays via UPI, then submits UTR
// ============================================
router.post('/create', auth, async (req, res) => {
    try {
        const { amount } = req.body;
        const userId = req.user.id;

        if (!amount || amount < 1 || amount > 5000) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Amount. Min ₹1, Max ₹5,000'
            });
        }

        // Check if user has any pending deposit (UTR submitted but not yet acted on)
        const pendingDeposit = await Deposit.findOne({
            userId,
            status: 'pending'
        });

        if (pendingDeposit) {
            return res.status(400).json({
                success: false,
                message: 'You have a deposit awaiting approval. Please wait or cancel it first.',
                pendingDeposit: {
                    depositId: pendingDeposit.depositId,
                    amount: pendingDeposit.amount,
                    transactionRef: pendingDeposit.transactionRef
                }
            });
        }

        // ✅ Generate invoice WITHOUT creating DB entry
        const depositId = generateDepositId();
        const qrCode = generateQRCode(amount);

        console.log(`[DEPOSIT] Invoice generated (not saved to DB): ${depositId} | Amount: Rs ${amount} | User: ${userId}`);

        res.json({
            success: true,
            message: 'Deposit Invoice Created. Please pay and submit UTR.',
            deposit: {
                depositId: depositId,
                amount: amount,
                qrCode: qrCode,
                upiId: ADMIN_UPI,
                expiresIn: '365 days',
                note: 'Pay via UPI then submit UTR to complete'
            }
        });
    } catch (error) {
        console.error('Create Deposit Error:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Server Error' });
    }
});

// ============================================
// 3. SUBMIT UTR
// ✅ THIS is where deposit enters DB with status='pending'
// ============================================
router.post('/submit-utr', auth, async (req, res) => {
    try {
        const { depositId, transactionRef, amount } = req.body;
        const userId = req.user.id;
        const dateTime = getCurrentDateTime();

        if (!depositId) {
            return res.status(400).json({ success: false, message: 'Deposit Id Is Required' });
        }
        if (!transactionRef || transactionRef.length < 12) {
            return res.status(400).json({
                success: false,
                message: 'Valid UTR (Min 12 Characters) Is Required'
            });
        }
        if (!amount || amount < 1 || amount > 5000) {
            return res.status(400).json({
                success: false,
                message: 'Valid amount (₹1 - ₹5,000) required'
            });
        }

        // ✅ Block if user already has a pending deposit
        const alreadyPending = await Deposit.findOne({
            userId,
            status: 'pending'
        });

        if (alreadyPending) {
            return res.status(400).json({
                success: false,
                message: 'You already have a deposit awaiting approval'
            });
        }

        // ✅ Check UTR not used before
        const existingUtr = await Deposit.findOne({
            transactionRef: transactionRef,
            status: { $in: ['pending', 'approved'] }
        });

        if (existingUtr) {
            return res.status(400).json({ success: false, message: 'This UTR Has Already Been Used' });
        }

        // ✅ CREATE deposit in DB — NOW it becomes pending
        const deposit = new Deposit({
            userId: userId,
            amount: amount,
            upiId: ADMIN_UPI,
            depositId: depositId,
            transactionRef: transactionRef,
            status: 'pending',
            verifiedAt: new Date(),
            expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
        });

        await deposit.save();

        console.log(`[DEPOSIT] Pending deposit created: ${deposit.depositId} | UTR: ${transactionRef} | Rs ${amount}`);

        const user = await User.findById(userId);

        // Notify admin
        await notifyAdmin(
`📥 <b>New Deposit — Pending Approval</b>\n\n` +
`⏰ <b>Time:</b> ${dateTime}\n` +
`👤 <b>Name:</b> ${user.fullName || 'N/A'}\n` +
`🆔 <b>Wallet ID:</b> ${user.walletId || 'N/A'}\n` +
`💰 <b>Amount:</b> ₹${deposit.amount.toFixed(2)}\n` +
`📄 <b>Deposit ID:</b> ${deposit.depositId}\n` +
`🔖 <b>UTR:</b> ${transactionRef}\n\n` +
`⏳ Action required: Approve or Reject`
        );

        // Notify user
        if (user.telegramId) {
            await notifyUser(user.telegramId,
`📥 <b>Deposit Submitted For Approval</b>\n\n` +
`⏰ <b>Time:</b> ${dateTime}\n` +
`👤 <b>Dear:</b> ${user.fullName}\n` +
`💰 <b>Amount:</b> ₹${deposit.amount.toFixed(2)}\n` +
`📄 <b>Deposit ID:</b> ${deposit.depositId}\n` +
`🔖 <b>UTR:</b> ${transactionRef}\n\n` +
`⏳ Please wait for admin approval.`
            );
        }

        res.json({
            success: true,
            message: 'UTR Submitted Successfully. Waiting For Admin Approval.',
            status: 'pending',
            depositId: deposit.depositId,
            amount: deposit.amount,
            transactionRef: transactionRef,
            submittedAt: dateTime
        });
    } catch (error) {
        console.error('UTR Submission Error:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Server Error' });
    }
});

// ============================================
// 3b. ALIAS: manual-confirm
// ============================================
router.post('/manual-confirm', (req, res, next) => {
    req.url = '/submit-utr';
    router.handle(req, res, next);
});

// ============================================
// 4. GET PENDING DEPOSITS (User)
// ============================================
router.get('/pending', auth, async (req, res) => {
    try {
        const userId = req.user.id;

        const pendingDeposits = await Deposit.find({
            userId: userId,
            status: 'pending'
        }).sort({ createdAt: -1 });

        const depositsWithQR = pendingDeposits.map(deposit => ({
            depositId: deposit.depositId,
            amount: deposit.amount,
            status: deposit.status,
            qrCode: deposit.qrData,
            upiId: deposit.upiId || ADMIN_UPI,
            transactionRef: deposit.transactionRef,
            createdAt: deposit.createdAt,
            submittedAt: deposit.verifiedAt
        }));

        res.json({ success: true, deposits: depositsWithQR });
    } catch (error) {
        console.error('Get Pending Deposits Error:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Server Error' });
    }
});

// ============================================
// 5. CANCEL PENDING DEPOSIT (User)
// ============================================
router.post('/cancel/:depositId', auth, async (req, res) => {
    try {
        const { depositId } = req.params;
        const userId = req.user.id;

        const deposit = await Deposit.findOne({
            depositId: depositId,
            userId: userId,
            status: 'pending'
        });

        if (!deposit) {
            return res.status(404).json({ success: false, message: 'Deposit Not Found' });
        }

        deposit.status = 'cancelled';
        deposit.cancelledBy = 'user';
        deposit.cancelledAt = new Date();
        deposit.adminNote = 'Cancelled by user';
        await deposit.save();

        res.json({ success: true, message: 'Deposit Cancelled Successfully' });
    } catch (error) {
        console.error('Cancel Deposit Error:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Server Error' });
    }
});

// ============================================
// 6. GET MY DEPOSITS HISTORY
// ============================================
router.get('/my-deposits', auth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { status, limit = 20, page = 1 } = req.query;

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
            upiId: deposit.upiId || ADMIN_UPI,
            createdAt: deposit.createdAt,
            submittedAt: deposit.verifiedAt || null,
            transactionRef: deposit.transactionRef || null,
            approvedAt: deposit.approvedAt || null,
            rejectedAt: deposit.rejectedAt || null,
            adminNote: deposit.adminNote || null
        }));

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
        console.error('Get Deposits Error:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Server Error' });
    }
});

// ============================================
// 7. GET SINGLE DEPOSIT
// ============================================
router.get('/:depositId', auth, async (req, res) => {
    try {
        const { depositId } = req.params;
        const userId = req.user.id;

        const deposit = await Deposit.findOne({ depositId, userId });

        if (!deposit) {
            return res.status(404).json({ success: false, message: 'Deposit Not Found' });
        }

        res.json({
            success: true,
            deposit: {
                depositId: deposit.depositId,
                amount: deposit.amount,
                status: deposit.status,
                qrCode: deposit.qrData,
                upiId: deposit.upiId || ADMIN_UPI,
                createdAt: deposit.createdAt,
                submittedAt: deposit.verifiedAt || null,
                transactionRef: deposit.transactionRef || null,
                approvedAt: deposit.approvedAt || null,
                rejectedAt: deposit.rejectedAt || null,
                adminNote: deposit.adminNote || null
            }
        });
    } catch (error) {
        console.error('Get Deposit Error:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Server Error' });
    }
});

module.exports = router;