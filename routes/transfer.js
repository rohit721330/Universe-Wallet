// FILE: routes/transfer.js
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const axios = require('axios');
require('dotenv').config();

// CONSTANTS
const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG = process.env.ADMIN_TG_ID;

// ============================================
// HELPER: Generate Unique Transaction ID
// ============================================
async function generateUniqueTransactionId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
        const length = Math.floor(Math.random() * 9) + 12;
        let result = 'TXN';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        const existing = await Transaction.findOne({ tx_id: result });
        if (!existing) {
            return result;
        }
        
        attempts++;
        console.log(`Duplicate Transaction ID Found: ${result}, Retrying...`);
    }
    
    const timestamp = Date.now().toString(36).toUpperCase();
    return `TXN${timestamp}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

// ============================================
// VERIFY TOKEN MIDDLEWARE
// ============================================
const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ success: false, message: 'No Token Provided' });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (!user) {
            return res.status(401).json({ success: false, message: 'User Not Found' });
        }
        
        req.user = user;
        next();
    } catch (error) {
        console.error('Token Verification Error:', error.message);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ success: false, message: 'Invalid Token. Please Login Again.' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Token Expired. Please Login Again.' });
        }
        return res.status(500).json({ success: false, message: 'Authentication Error' });
    }
};

// ============================================
// HELPER: Send Message Via Telegram
// ============================================
async function sendTelegramMessage(chatId, message) {
    if (!BOT_TOKEN) return { success: false, error: 'BOT_TOKEN not configured' };
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const response = await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        }, { timeout: 15000, headers: { 'Content-Type': 'application/json' } });
        if (response.data && response.data.ok) return { success: true };
        return { success: false, error: response.data?.description || 'Unknown Error' };
    } catch (error) {
        if (error.code === 'ECONNABORTED') return { success: false, error: 'Telegram API Time Out' };
        return { success: false, error: error.message };
    }
}

async function notifyAdmin(message) {
    if (!ADMIN_TG) return;
    try { await sendTelegramMessage(ADMIN_TG, message); }
    catch (error) { console.error('Admin Notification Error:', error.message); }
}

async function notifyUser(chatId, message) {
    if (!chatId) return;
    try { await sendTelegramMessage(chatId, message); }
    catch (error) { console.error('User Notification Error:', error.message); }
}

function getCurrentDateTime() {
    const now = new Date();
    return now.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
}

function getClientIp(req) {
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress || 
           req.socket.remoteAddress || req.ip || 'Unknown';
}

// ============================================
// VIEW USER DETAILS - GET /api/transfer/view
// ============================================
router.get('/view', verifyToken, async (req, res) => {
    try {
        const { number } = req.query;
        const currentUser = req.user;
        
        if (!number) {
            return res.status(400).json({ status: 'error', error: 'Mobile Number Is Required' });
        }
        
        if (!/^\d{10}$/.test(number)) {
            return res.status(400).json({ status: 'error', error: 'Invalid Mobile Number. Must Be 10 Digits.' });
        }
        
        if (currentUser.mobile === number) {
            return res.status(400).json({ status: 'error', error: 'You Cannot View Your Own Details Here' });
        }
        
        const user = await User.findOne({ mobile: number });
        if (!user) {
            return res.status(404).json({ status: 'error', error: 'User Not Found' });
        }
        
        if (user.isBlocked) {
            return res.status(403).json({ status: 'error', error: 'This User Account Is Blocked' });
        }
        
        res.json({
            status: 'success',
            name: user.fullName,
            mobile: user.mobile,
            walletId: user.walletId,
            isVerified: true
        });
    } catch (error) {
        console.error('View User Error:', error.message);
        res.status(500).json({ status: 'error', error: 'Failed To Fetch User Details' });
    }
});

// ============================================
// GET BALANCE - GET /api/transfer/balance
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
// SEND MONEY (TRANSFER) - POST /api/transfer/
// ============================================
router.post('/', verifyToken, async (req, res) => {
    try {
        const { mobile, amount, note } = req.body;
        const sender = req.user;
        const dateTime = getCurrentDateTime();
        const clientIp = getClientIp(req);
        
        if (!mobile || !mobile.toString().trim()) {
            return res.status(400).json({ success: false, error: 'Receiver Mobile Number Is Required' });
        }
        
        const mobileNumber = mobile.toString().trim();
        
        if (mobileNumber.length !== 10 || !/^\d{10}$/.test(mobileNumber)) {
            return res.status(400).json({ success: false, error: 'Please Enter A Valid 10-Digit Mobile Number' });
        }
        
        const transferAmount = parseFloat(amount);
        if (isNaN(transferAmount) || transferAmount < 1) {
            return res.status(400).json({ success: false, error: 'Minimum Transfer Amount Is ₹1' });
        }
        
        if (transferAmount > 5000) {
            return res.status(400).json({ success: false, error: 'Maximum Transfer Amount Is ₹5,000' });
        }
        
        if (sender.mobile === mobileNumber) {
            return res.status(400).json({ success: false, error: 'You Cannot Send Money To Yourself' });
        }
        
        const receiver = await User.findOne({ mobile: mobileNumber });
        
        if (!receiver) {
            return res.status(404).json({ success: false, error: 'Receiver Not Found. Please Verify The Mobile Number' });
        }
        
        if (receiver.isBlocked) {
            return res.status(403).json({ success: false, error: 'Receiver Account Is Blocked' });
        }
        
        if (sender.balance < transferAmount) {
            return res.status(400).json({ 
                success: false, 
                error: `Insufficient Balance. Your Current Balance Is ₹${sender.balance.toFixed(2)}` 
            });
        }
        
        // Start Transaction
        const session = await User.startSession();
        session.startTransaction();
        
        try {
            // Update balances
            sender.balance -= transferAmount;
            receiver.balance += transferAmount;
            
            await sender.save({ session });
            await receiver.save({ session });
            
            // ✅ Capture balanceAfter for both users
            const senderBalanceAfter = sender.balance;
            const receiverBalanceAfter = receiver.balance;
            
            const transactionId = await generateUniqueTransactionId();
            
            // ✅ Sender Transaction - transfer_send (debit)
            await Transaction.create([{
                tx_id: transactionId,
                user_id: sender._id,
                sender_id: sender._id,
                receiver_id: receiver._id,
                amount: transferAmount,
                type: 'transfer_send',
                status: 'success',
                remark: note || 'Money Transfer',
                description: note || 'Money Transfer',
                tx_time: new Date(),
                metadata: {
                    senderMobile: sender.mobile,
                    receiverMobile: receiver.mobile,
                    senderName: sender.fullName,
                    receiverName: receiver.fullName,
                    ipAddress: clientIp,
                    timestamp: new Date(),
                    transactionType: 'payment_sent',
                    // ✅ NEW FIELDS
                    method: 'Transfer',
                    category: 'P2P sent',
                    balanceAfter: senderBalanceAfter,
                    note: note || ''
                }
            }], { session });
            
            // ✅ Receiver Transaction - transfer_receive (credit)
            await Transaction.create([{
                tx_id: transactionId,
                user_id: receiver._id,
                sender_id: sender._id,
                receiver_id: receiver._id,
                amount: transferAmount,
                type: 'transfer_receive',
                status: 'success',
                remark: note || 'Money Received',
                description: note || 'Money Received',
                tx_time: new Date(),
                metadata: {
                    senderMobile: sender.mobile,
                    receiverMobile: receiver.mobile,
                    senderName: sender.fullName,
                    receiverName: receiver.fullName,
                    ipAddress: clientIp,
                    timestamp: new Date(),
                    transactionType: 'payment_received',
                    // ✅ NEW FIELDS
                    method: 'Transfer',
                    category: 'P2P received',
                    balanceAfter: receiverBalanceAfter,
                    note: note || ''
                }
            }], { session });
            
            await session.commitTransaction();
            session.endSession();
            
            // ==================== TELEGRAM NOTIFICATIONS ====================
            
            if (receiver.telegramId) {
                const receiverMessage = 
`Money Received

Dear ${receiver.fullName || receiver.username},

You have just received a payment in your wallet.

Amount: ₹${transferAmount.toFixed(2)}
From: ${sender.fullName || sender.username}
Transaction ID: ${transactionId}
Note: ${note || 'N/A'}
Date: ${dateTime}

Amount credited to your wallet.`;
                await notifyUser(receiver.telegramId, receiverMessage);
            }
            
            if (sender.telegramId) {
                const senderMessage = 
`Payment Completed

Dear ${sender.fullName || sender.username},

Your payment has been processed successfully.

Amount: ₹${transferAmount.toFixed(2)}
To: ${receiver.fullName || receiver.username} (${receiver.mobile})
Transaction ID: ${transactionId}
New Balance: ₹${sender.balance.toFixed(2)}
Note: ${note || 'N/A'}

Transfer completed successfully.`;
                await notifyUser(sender.telegramId, senderMessage);
            }
            
            await notifyAdmin(
`Transfer Completed

Sender Name: ${sender.fullName || sender.username}
Sender Mobile: ${sender.mobile}
Receiver Name: ${receiver.fullName || receiver.username}
Receiver Mobile: ${receiver.mobile}
Amount: ₹${transferAmount.toFixed(2)}
Transaction ID: ${transactionId}
Note: ${note || 'No Comment'}

Date: ${dateTime}`
            );
            
            res.json({
                success: true,
                message: `Transfer Successful! ₹${transferAmount.toFixed(2)} Sent To ${receiver.fullName || receiver.username}`,
                txnId: transactionId,
                amount: transferAmount,
                newBalance: sender.balance
            });
            
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            console.error('Transaction Failed:', error.message);
            throw error;
        }
        
    } catch (error) {
        console.error('Transfer Error:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Transfer Failed. Please Try Again' 
        });
    }
});

// ============================================
// GET TRANSACTION HISTORY
// ============================================
router.get('/history', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        const { limit = 50, page = 1 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const transactions = await Transaction.find({
            $or: [{ sender_id: user._id }, { receiver_id: user._id }]
        })
        .populate('sender_id', 'fullName username mobile')
        .populate('receiver_id', 'fullName username mobile')
        .sort({ tx_time: -1 })
        .skip(skip)
        .limit(parseInt(limit));
        
        const total = await Transaction.countDocuments({
            $or: [{ sender_id: user._id }, { receiver_id: user._id }]
        });
        
        res.json({
            status: 'success',
            transactions,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Transaction History Error:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed To Fetch Transaction History' });
    }
});

// ============================================
// GET SINGLE TRANSACTION DETAILS
// ============================================
router.get('/transaction/:txnId', verifyToken, async (req, res) => {
    try {
        const { txnId } = req.params;
        const user = req.user;
        
        const transaction = await Transaction.findOne({ tx_id: txnId })
            .populate('sender_id', 'fullName username mobile walletId')
            .populate('receiver_id', 'fullName username mobile walletId')
            .populate('user_id', 'fullName username mobile walletId');
        
        if (!transaction) {
            return res.status(404).json({ status: 'error', message: 'Transaction Not Found' });
        }
        
        const isAuthorized = 
            transaction.sender_id?._id?.toString() === user._id.toString() || 
            transaction.receiver_id?._id?.toString() === user._id.toString() ||
            transaction.user_id?._id?.toString() === user._id.toString();
        
        if (!isAuthorized) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized To View This Transaction' });
        }
        
        res.json({ status: 'success', transaction });
    } catch (error) {
        console.error('Transaction Details Error:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed To Fetch Transaction Details' });
    }
});

// ============================================
// PUBLIC: GET SINGLE TRANSACTION
// ============================================
router.get('/public/transaction/:txnId', async (req, res) => {
    try {
        const { txnId } = req.params;
        
        const transaction = await Transaction.findOne({ tx_id: txnId })
            .populate('sender_id', 'fullName username walletId')
            .populate('receiver_id', 'fullName username walletId')
            .populate('user_id', 'fullName username walletId');
        
        if (!transaction) {
            return res.status(200).json({ success: false, message: 'Transaction Not Found' });
        }
        
        const txnObj = transaction.toObject();
        delete txnObj.metadata?.senderApiKey;
        delete txnObj.metadata?.receiverApiKey;
        
        res.status(200).json({ success: true, transaction: txnObj });
    } catch (error) {
        console.error('Public Transaction Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Fetch Transaction Details' });
    }
});

// ============================================
// GET MY API KEY
// ============================================
router.get('/my-apikey', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        
        if (!user.apiKey) {
            return res.status(404).json({ success: false, message: 'API Key Not Found' });
        }
        
        res.json({
            success: true,
            apiKey: user.apiKey,
            walletId: user.walletId,
            fullName: user.fullName,
            mobile: user.mobile
        });
    } catch (error) {
        console.error('Get API Key Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Fetch API Key' });
    }
});

module.exports = router;
