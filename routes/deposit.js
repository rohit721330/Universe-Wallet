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

function generateDepositTxnId() {
    return 'TXN_DEPOSIT_' + Date.now() + Math.floor(Math.random() * 99999);
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
    } catch (error) {
        console.error('Admin Notification Failed:', error.message);
    }
}

async function notifyUser(chatId, message) {
    if (!chatId) return;
    try {
        await sendTelegramMessage(chatId, message);
    } catch (error) {
        console.error('User Notification Failed:', error.message);
    }
}

// ============================================
// 0. GET PUBLIC CONFIG (UPI ID) - NO AUTH
// ============================================
router.get('/config', (req, res) => {
    try {
        res.json({
            success: true,
            upiId: ADMIN_UPI,
            minAmount: 1,
            maxAmount: 5000,
            expiryMinutes: 1440
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Config error' });
    }
});

// ============================================
// 1. GET USER PROFILE (BALANCE)
// ============================================
router.get('/profile/me', auth, async (req, res) => {
    try {
        const user = await User.findById(req.userId).select('-password -pin -__v');
        
        if (!user) {
            return res.status(404).json({ success: false, message: 'User Not Found' });
        }

        res.json({ success: true, user: user });
    } catch (error) {
        console.error('Profile Fetch Error:', error.message);
        res.status(500).json({ success: false, message: 'Internal Server Error: ' + error.message });
    }
});

// ============================================
// 2. CREATE DEPOSIT (Manual)
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

        const existing = await Deposit.findOne({
            userId,
            status: 'pending',
            expiresAt: { $gt: new Date() }
        });

        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'You Have A Pending Invoice',
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

        const qrCode = generateQRCode(amount);
        deposit.qrData = qrCode;
        await deposit.save();

        res.json({
            success: true,
            message: 'Deposit Invoice Created Successfully',
            deposit: {
                depositId: deposit.depositId,
                amount: deposit.amount,
                qrCode: qrCode,
                expiresAt: deposit.expiresAt,
                upiId: ADMIN_UPI
            }
        });

    } catch (error) {
        console.error('Create Deposit Error:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Server Error' });
    }
});

// ============================================
// 3. SUBMIT UTR FOR MANUAL APPROVAL
// ============================================
router.post('/submit-utr', auth, async (req, res) => {
    try {
        const { depositId, transactionRef } = req.body;
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

        const deposit = await Deposit.findOne({ depositId, userId, status: 'pending' });
        
        if (!deposit) {
            return res.status(404).json({ success: false, message: 'Pending Deposit Not Found' });
        }

        if (deposit.isExpired()) {
            deposit.status = 'cancelled';
            await deposit.save();
            return res.status(400).json({ success: false, message: 'This Deposit Has Expired' });
        }

        const existingUtr = await Deposit.findOne({ 
            transactionRef: transactionRef,
            status: { $in: ['pending_approval', 'approved'] }
        });
        
        if (existingUtr) {
            return res.status(400).json({ success: false, message: 'This UTR Has Already Been Used' });
        }

        deposit.transactionRef = transactionRef;
        deposit.status = 'pending_approval';
        deposit.verifiedAt = new Date();
        await deposit.save();

        const user = await User.findById(userId);

        await notifyAdmin(
`UTR Submitted - Pending Approval

Name: ${user.fullName || 'N/A'}
Wallet ID: ${user.walletId || 'N/A'}
Amount: ₹${deposit.amount.toFixed(2)}
Deposit ID: ${deposit.depositId}
UTR: ${transactionRef}
Time: ${dateTime}`
        );

        if (user.telegramId) {
            await notifyUser(user.telegramId, 
`UTR Submitted For Approval

Dear ${user.fullName},

Your UTR has been submitted for approval.

Amount: ₹${deposit.amount.toFixed(2)}
Deposit ID: ${deposit.depositId}
UTR: ${transactionRef}
Time: ${dateTime}

Please wait for admin approval.`
            );
        }

        res.json({
            success: true,
            message: 'UTR Submitted Successfully. Waiting For Admin Approval.',
            status: 'pending_approval',
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
// 3b. ALIAS: manual-confirm → submit-utr (for backward compatibility)
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
            status: { $in: ['pending', 'pending_approval'] },
            expiresAt: { $gt: new Date() }
        }).sort({ createdAt: -1 });

        const depositsWithQR = pendingDeposits.map(deposit => ({
            depositId: deposit.depositId,
            amount: deposit.amount,
            status: deposit.status,
            qrCode: deposit.qrData,
            upiId: deposit.upiId || ADMIN_UPI,
            expiresAt: deposit.expiresAt,
            createdAt: deposit.createdAt
        }));

        res.json({ success: true, deposits: depositsWithQR });

    } catch (error) {
        console.error('Get Pending Deposits Error:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Server Error' });
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

        const deposit = await Deposit.findOne({ 
            depositId: depositId, 
            userId: userId,
            status: 'pending'
        });

        if (!deposit) {
            return res.status(404).json({ success: false, message: 'Pending Deposit Not Found' });
        }

        if (deposit.isExpired()) {
            deposit.status = 'cancelled';
            await deposit.save();
            return res.status(400).json({ success: false, message: 'This Deposit Has Expired' });
        }

        deposit.status = 'cancelled';
        await deposit.save();

        const user = await User.findById(userId);

        await notifyAdmin(
`Deposit Cancelled

Name: ${user?.fullName || 'N/A'}
Amount: ₹${deposit.amount.toFixed(2)}
Deposit ID: ${deposit.depositId}
Time: ${dateTime}`
        );

        if (user?.telegramId) {
            await notifyUser(user.telegramId, 
`Deposit Cancelled

Dear ${user.fullName},

Your deposit has been cancelled.

Amount: ₹${deposit.amount.toFixed(2)}
Deposit ID: ${deposit.depositId}
Time: ${dateTime}`
            );
        }

        res.json({ success: true, message: 'Deposit Cancelled Successfully' });

    } catch (error) {
        console.error('Cancel Deposit Error:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Server Error' });
    }
});

// ============================================
// 6. ADMIN APPROVE DEPOSIT
// ============================================
router.post('/admin/approve/:depositId', auth, async (req, res) => {
    try {
        const { depositId } = req.params;
        const adminId = req.user.id;
        const dateTime = getCurrentDateTime();

        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Admin Access Required' });
        }

        const deposit = await Deposit.findOne({ 
            depositId: depositId, 
            status: 'pending_approval'
        });

        if (!deposit) {
            return res.status(404).json({ success: false, message: 'Deposit Not Found Or Not Pending Approval' });
        }

        deposit.status = 'approved';
        deposit.approvedBy = adminId;
        deposit.approvedAt = new Date();
        await deposit.save();

        const user = await User.findById(deposit.userId);
        user.balance += deposit.amount;
        await user.save();

        const balanceAfter = user.balance;
        const txnId = generateDepositTxnId();

        // ✅ Transaction with all metadata for CSV/PDF
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
                type: 'admin_approved',
                transactionType: 'payment_received',
                method: 'Deposit',
                category: 'Deposit',
                balanceAfter: balanceAfter
            }
        });
        await transaction.save();

        await notifyAdmin(
`Deposit Approved

Name: ${user.fullName || 'N/A'}
Amount: ₹${deposit.amount.toFixed(2)}
Deposit ID: ${deposit.depositId}
Transaction ID: ${txnId}
UTR: ${deposit.transactionRef}
New Balance: ₹${user.balance.toFixed(2)}
Time: ${dateTime}`
        );

        if (user.telegramId) {
            await notifyUser(user.telegramId, 
`Deposit Approved!

Dear ${user.fullName},

Your deposit has been approved successfully.

Amount: ₹${deposit.amount.toFixed(2)}
Deposit ID: ${deposit.depositId}
Transaction ID: ${txnId}
New Balance: ₹${user.balance.toFixed(2)}
Time: ${dateTime}

Amount credited to your wallet.`
            );
        }

        res.json({
            success: true,
            message: 'Deposit Approved Successfully',
            amount: deposit.amount,
            transactionId: txnId,
            newBalance: user.balance
        });

    } catch (error) {
        console.error('Approve Deposit Error:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Server Error' });
    }
});

// ============================================
// 7. ADMIN REJECT DEPOSIT
// ============================================
router.post('/admin/reject/:depositId', auth, async (req, res) => {
    try {
        const { depositId } = req.params;
        const adminId = req.user.id;
        const { reason } = req.body;
        const dateTime = getCurrentDateTime();

        const admin = await User.findById(adminId);
        if (!admin || !admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Admin Access Required' });
        }

        const deposit = await Deposit.findOne({ 
            depositId: depositId, 
            status: 'pending_approval'
        });

        if (!deposit) {
            return res.status(404).json({ success: false, message: 'Deposit Not Found Or Not Pending Approval' });
        }

        deposit.status = 'rejected';
        deposit.rejectedBy = adminId;
        deposit.rejectedAt = new Date();
        deposit.adminNote = reason || 'No reason provided';
        await deposit.save();

        const user = await User.findById(deposit.userId);

        await notifyAdmin(
`Deposit Rejected

Name: ${user?.fullName || 'N/A'}
Amount: ₹${deposit.amount.toFixed(2)}
Deposit ID: ${deposit.depositId}
UTR: ${deposit.transactionRef}
Reason: ${deposit.adminNote}
Time: ${dateTime}`
        );

        if (user?.telegramId) {
            await notifyUser(user.telegramId, 
`Deposit Rejected

Dear ${user.fullName},

Your deposit has been rejected.

Amount: ₹${deposit.amount.toFixed(2)}
Deposit ID: ${deposit.depositId}
Reason: ${deposit.adminNote}
Time: ${dateTime}

Please contact support for more information.`
            );
        }

        res.json({
            success: true,
            message: 'Deposit Rejected Successfully',
            reason: deposit.adminNote
        });

    } catch (error) {
        console.error('Reject Deposit Error:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Server Error' });
    }
});

// ============================================
// 8. GET MY DEPOSITS HISTORY
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
            expiresAt: deposit.expiresAt,
            createdAt: deposit.createdAt,
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
// 9. GET SINGLE DEPOSIT BY ID
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
                expiresAt: deposit.expiresAt,
                createdAt: deposit.createdAt,
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

// ============================================
// 10. CLEANUP EXPIRED DEPOSITS (Admin only)
// ============================================
router.post('/cleanup-expired', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user.isAdmin) {
            return res.status(403).json({ success: false, message: 'Admin Access Required' });
        }

        const result = await Deposit.cleanupExpired();

        res.json({
            success: true,
            message: `Cleaned up ${result.modifiedCount} expired deposits`
        });

    } catch (error) {
        console.error('Cleanup Error:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Server Error' });
    }
});

module.exports = router;
