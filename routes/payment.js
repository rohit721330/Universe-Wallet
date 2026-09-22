// FILE: routes/payment.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const crypto = require('crypto');
const https = require('https');

const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;

// ============================================
// Generate Transaction ID (TXN + 10 chars)
// ============================================
function generateTxnId(existingTxnId) {
    if (existingTxnId && String(existingTxnId).trim()) {
        return String(existingTxnId).trim();
    }
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let randomPart = '';
    while (randomPart.length < 10) {
        const byte = crypto.randomBytes(1)[0];
        if (byte < 252) randomPart += chars[byte % chars.length];
    }
    return 'TXN' + randomPart;
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================
// Telegram
// ============================================
function sendTelegramMessage(chatId, message) {
    return new Promise((resolve) => {
        if (!BOT_TOKEN || !chatId) return resolve({ success: false });
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const data = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' });
        const request = https.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                try { resolve({ success: JSON.parse(responseData).ok }); }
                catch (e) { resolve({ success: false }); }
            });
        });
        request.on('error', () => resolve({ success: false }));
        request.write(data);
        request.end();
    });
}

// ============================================
// ✅ API Usage Tracker
// সব API attempt track করে — success + failed উভয়ই
// ============================================
async function trackApiUsage(userId, success) {
    if (!userId) return;
    try {
        const update = {
            $inc: {
                totalApiCalls: 1,
                ...(success ? { successfulApiCalls: 1 } : { failedApiCalls: 1 })
            },
            $set: {
                lastApiUsedAt: new Date()
            }
        };
        if (success) {
            update.$set.lastApiSuccessAt = new Date();
        }
        await User.updateOne({ _id: userId }, update);
    } catch (error) {
        console.error('API usage tracking failed:', error.message);
    }
}

// ============================================
// API Key Validation
// ============================================
async function validateApiKey(apiKey) {
    if (!apiKey || apiKey.length !== 10 || !/^[A-Z0-9]+$/.test(apiKey)) {
        return { status: 'failed', message: 'Invalid API Key format' };
    }
    const user = await User.findOne({ apiKey: apiKey.toUpperCase() })
        .select('_id fullName mobile walletId balance isBlocked telegramId apiKeyActive');
    if (!user) return { status: 'failed', message: 'Invalid API Key' };
    if (user.apiKeyActive === false) return { status: 'failed', message: 'API Key is disabled' };
    if (user.isBlocked) return { status: 'failed', message: 'User account is blocked' };
    return { status: 'success', user };
}

async function findUserByMobile(mobile) {
    if (!mobile || !/^[0-9]{10}$/.test(String(mobile))) {
        return { status: 'failed', message: 'Invalid mobile number format' };
    }
    const user = await User.findOne({ mobile })
        .select('_id fullName mobile walletId balance isBlocked telegramId');
    if (!user) return { status: 'failed', message: 'User not found with this mobile number' };
    if (user.isBlocked) return { status: 'failed', message: 'Receiver account is blocked' };
    return { status: 'success', user };
}

async function validateReceiverApiKey(apiKey) {
    if (!apiKey || apiKey.length !== 10 || !/^[A-Z0-9]+$/.test(apiKey)) {
        return { status: 'failed', message: 'Invalid receiver API Key format' };
    }
    const user = await User.findOne({ apiKey: apiKey.toUpperCase() })
        .select('_id fullName mobile walletId balance isBlocked telegramId');
    if (!user) return { status: 'failed', message: 'Receiver not found' };
    if (user.isBlocked) return { status: 'failed', message: 'Receiver account is blocked' };
    return { status: 'success', user };
}

// ============================================
// Auth
// ============================================
async function auth(req, res, next) {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.json({ status: 'failed', message: 'No token provided' });
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) return res.json({ status: 'failed', message: 'User not found' });
        if (user.isBlocked) return res.json({ status: 'failed', message: 'Account blocked' });
        req.user = user;
        next();
    } catch (error) {
        let message = 'Authentication error';
        if (error.name === 'JsonWebTokenError') message = 'Invalid token';
        if (error.name === 'TokenExpiredError') message = 'Token expired';
        return res.json({ status: 'failed', message });
    }
}

function sendResponse(res, status, message, data = null, extra = {}) {
    const body = { status, message };
    if (data !== null) body.data = data;
    Object.assign(body, extra);
    return res.json(body);
}

function formatTimestamp() {
    return new Date().toLocaleString('en-IN', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false
    }).replace(/\//g, '-');
}

function handleDuplicateError(error) {
    if (error.code === 11000) {
        return 'Transaction ID conflict. Please retry';
    }
    return null;
}

// ============================================
// ✅ CORE: API Payment — সব attempt track করবে
// ============================================
async function processApiPayment({ key, number, amount, comment = '', endpoint }) {
    // ✅ key থেকে sender খুঁজে বের করুন — failed হলেও track করার জন্য
    let senderForTracking = null;
    if (key && typeof key === 'string' && key.length === 10) {
        try {
            senderForTracking = await User.findOne({ apiKey: key.toUpperCase() })
                .select('_id').lean();
        } catch (e) {}
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        // ----- Validation -----
        if (!key) {
            await session.abortTransaction();
            if (senderForTracking) await trackApiUsage(senderForTracking._id, false);
            return { status: 'failed', message: 'API Key is required' };
        }
        if (!number) {
            await session.abortTransaction();
            if (senderForTracking) await trackApiUsage(senderForTracking._id, false);
            return { status: 'failed', message: 'Receiver number is required' };
        }
        if (amount === undefined || amount === null || amount === '') {
            await session.abortTransaction();
            if (senderForTracking) await trackApiUsage(senderForTracking._id, false);
            return { status: 'failed', message: 'Amount is required' };
        }

        const paymentAmount = parseFloat(amount);
        if (isNaN(paymentAmount) || paymentAmount < 1) {
            await session.abortTransaction();
            if (senderForTracking) await trackApiUsage(senderForTracking._id, false);
            return { status: 'failed', message: 'Minimum payment amount is ₹1' };
        }
        if (paymentAmount > 5000) {
            await session.abortTransaction();
            if (senderForTracking) await trackApiUsage(senderForTracking._id, false);
            return { status: 'failed', message: 'Maximum payment amount is ₹5,000' };
        }

        if (key.length !== 10 || !/^[A-Z0-9]+$/.test(key)) {
            await session.abortTransaction();
            return { status: 'failed', message: 'Invalid API Key format' };
        }

        // ----- Sender -----
        const senderResult = await validateApiKey(key);
        if (senderResult.status === 'failed') {
            await session.abortTransaction();
            if (senderForTracking) await trackApiUsage(senderForTracking._id, false);
            return { status: 'failed', message: senderResult.message };
        }
        const sender = senderResult.user;

        // ----- Receiver -----
        const receiverResult = await findUserByMobile(number);
        if (receiverResult.status === 'failed') {
            await session.abortTransaction();
            await trackApiUsage(sender._id, false);
            return { status: 'failed', message: receiverResult.message };
        }
        const receiver = receiverResult.user;

        // ----- Business Rules -----
        if (sender._id.toString() === receiver._id.toString()) {
            await session.abortTransaction();
            await trackApiUsage(sender._id, false);
            return { status: 'failed', message: 'You cannot pay yourself' };
        }

        if (sender.balance < paymentAmount) {
            await session.abortTransaction();
            await trackApiUsage(sender._id, false);
            return {
                status: 'failed',
                message: 'Insufficient balance',
                balance: sender.balance
            };
        }

        if (receiver.isBlocked || sender.isBlocked) {
            await session.abortTransaction();
            await trackApiUsage(sender._id, false);
            return { status: 'failed', message: 'Account is blocked' };
        }

        // ----- Balances -----
        const txn_Id = generateTxnId();
        const senderOldBalance = sender.balance;
        const receiverOldBalance = receiver.balance;

        sender.balance = senderOldBalance - paymentAmount;
        receiver.balance = receiverOldBalance + paymentAmount;

        await sender.save({ session });
        await receiver.save({ session });

        // ----- Sender Transaction -----
        const senderTransaction = new Transaction({
            user_id: sender._id,
            sender_id: sender._id,
            receiver_id: receiver._id,
            amount: paymentAmount,
            type: 'api',
            status: 'success',
            remark: comment || 'API Transfer',
            description: comment || 'API Transfer',
            tx_id: txn_Id,
            tx_time: new Date(),
            metadata: {
                transactionType: 'payment_sent',
                senderOldBalance, receiverOldBalance,
                senderName: sender.fullName, receiverName: receiver.fullName,
                receiverMobile: receiver.mobile, note: comment || '',
                apiEndpoint: endpoint
            }
        });
        await senderTransaction.save({ session });

        // ----- Receiver Transaction -----
        const receiverTransaction = new Transaction({
            user_id: receiver._id,
            sender_id: sender._id,
            receiver_id: receiver._id,
            amount: paymentAmount,
            type: 'api',
            status: 'success',
            remark: comment || 'API Transfer',
            description: comment || 'API Transfer',
            tx_id: txn_Id,
            tx_time: new Date(),
            metadata: {
                transactionType: 'payment_received',
                senderOldBalance, receiverOldBalance,
                senderName: sender.fullName, receiverName: receiver.fullName,
                receiverMobile: receiver.mobile, note: comment || '',
                apiEndpoint: endpoint
            }
        });
        await receiverTransaction.save({ session });

        await session.commitTransaction();
        console.log(`✅ API Payment Successful [${endpoint}]:`, txn_Id);

        // ✅ Sender-এর API usage track করুন (success)
        await trackApiUsage(sender._id, true);

        // ----- Telegram -----
        if (sender.telegramId) {
            const msg =
`✅ API Payment Successful

Dear ${escapeHtml(sender.fullName)}, Your Payment Has Been Processed Successfully.

💰 Amount: ₹${paymentAmount}
📤 To: ${escapeHtml(receiver.fullName)}
💼 New Balance: ₹${sender.balance}
🧾 Txn ID: ${txn_Id}
💬 Comment: ${escapeHtml(comment) || 'N/A'}
🕒 Date: ${new Date().toLocaleString()}

⚠️ If This Wasn't You, Please Contact Support Immediately.`;
            sendTelegramMessage(sender.telegramId, msg).catch(() => {});
        }

        if (receiver.telegramId) {
            const msg =
`🎉 API Payment Received

Dear ${escapeHtml(receiver.fullName)}, You Have Received A Payment In Your Wallet.

💰 Amount: ₹${paymentAmount}
📥 From: ${escapeHtml(sender.fullName)}
💼 New Balance: ₹${receiver.balance}
🧾 Transaction ID: ${txn_Id}
💬 Comment: ${escapeHtml(comment) || 'N/A'}
🕒 Date: ${new Date().toLocaleString()}

✅ Amount Credited To Your Wallet Successfully.`;
            sendTelegramMessage(receiver.telegramId, msg).catch(() => {});
        }

        return {
            status: 'success',
            message: 'Payment successful',
            data: {
                transaction_id: txn_Id,
                amount: paymentAmount,
                sender: { name: sender.fullName, number: sender.mobile },
                receiver: { name: receiver.fullName, number: receiver.mobile },
                comment: comment || 'Paid',
                timestamp: formatTimestamp()
            }
        };

    } catch (error) {
        await session.abortTransaction();

        // ✅ Failed attempt track করুন
        if (senderForTracking) {
            await trackApiUsage(senderForTracking._id, false);
        }

        const dupMsg = handleDuplicateError(error);
        if (dupMsg) return { status: 'failed', message: dupMsg };
        console.error(`Payment Error [${endpoint}]:`, error);
        return { status: 'failed', message: 'Failed to process payment' };
    } finally {
        session.endSession();
    }
}

// ============================================
// GET / — API Payment
// ============================================
router.get('/', async (req, res) => {
    try {
        const fullUrl = req.originalUrl || req.url;
        if (fullUrl.length > 8000) {
            return sendResponse(res, 'failed', 'Request URI too long. Use POST method.', null, {
                suggestion: 'Use POST method instead of GET',
                current_length: fullUrl.length,
                max_length: 8000
            });
        }

        const { key, number, amount, comment = '' } = req.query;

        console.log('Payment Request Via GET:');
        console.log('  Key:', key ? '***' + String(key).slice(-4) : 'MISSING');
        console.log('  Number:', number);
        console.log('  Amount:', amount);

        const result = await processApiPayment({ key, number, amount, comment, endpoint: 'GET' });

        return sendResponse(res, result.status, result.message, result.data || null,
            result.balance !== undefined ? { balance: result.balance } : {});
    } catch (error) {
        console.error('Payment GET Error:', error);
        return sendResponse(res, 'failed', 'Failed to process payment');
    }
});

// ============================================
// POST / — API Payment
// ============================================
router.post('/', async (req, res) => {
    try {
        const { key, number, amount, comment = '' } = req.body;

        console.log('Payment Request Via POST:');
        console.log('  Key:', key ? '***' + String(key).slice(-4) : 'MISSING');
        console.log('  Number:', number);
        console.log('  Amount:', amount);

        const result = await processApiPayment({ key, number, amount, comment, endpoint: 'POST' });

        return sendResponse(res, result.status, result.message, result.data || null,
            result.balance !== undefined ? { balance: result.balance } : {});
    } catch (error) {
        console.error('Payment POST Error:', error);
        return sendResponse(res, 'failed', 'Failed to process payment');
    }
});

// ============================================
// GET /make — Authenticated payment
// ============================================
router.get('/make', auth, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { receiverApiKey, amount, note = '' } = req.query;
        const sender = req.user;

        if (!receiverApiKey || !amount) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Receiver API Key and amount are required');
        }

        const paymentAmount = parseFloat(amount);
        if (isNaN(paymentAmount) || paymentAmount < 1) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Minimum payment amount is ₹1');
        }
        if (paymentAmount > 5000) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Maximum payment amount is ₹5,000');
        }
        if (sender.apiKey === receiverApiKey) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'You cannot pay yourself');
        }
        if (receiverApiKey.length !== 10 || !/^[A-Z0-9]+$/.test(receiverApiKey)) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Invalid receiver API Key format');
        }

        const receiverResult = await validateReceiverApiKey(receiverApiKey);
        if (receiverResult.status === 'failed') {
            await session.abortTransaction();
            return sendResponse(res, 'failed', receiverResult.message);
        }
        const receiver = receiverResult.user;

        if (sender.balance < paymentAmount) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Insufficient balance', { balance: sender.balance });
        }
        if (receiver.isBlocked || sender.isBlocked) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Account is blocked');
        }

        const txn_Id = generateTxnId();
        const senderOldBalance = sender.balance;
        const receiverOldBalance = receiver.balance;

        sender.balance = senderOldBalance - paymentAmount;
        receiver.balance = receiverOldBalance + paymentAmount;

        await sender.save({ session });
        await receiver.save({ session });

        const senderTransaction = new Transaction({
            user_id: sender._id, sender_id: sender._id, receiver_id: receiver._id,
            amount: paymentAmount, type: 'transfer', status: 'success',
            remark: note || `Payment to ${receiver.fullName}`,
            description: note || `Payment to ${receiver.fullName}`,
            tx_id: txn_Id, tx_time: new Date(),
            metadata: {
                transactionType: 'payment_sent',
                senderOldBalance, receiverOldBalance,
                senderName: sender.fullName, receiverName: receiver.fullName,
                note: note || '', apiEndpoint: 'GET'
            }
        });
        await senderTransaction.save({ session });

        const receiverTransaction = new Transaction({
            user_id: receiver._id, sender_id: sender._id, receiver_id: receiver._id,
            amount: paymentAmount, type: 'transfer', status: 'success',
            remark: note || `Payment from ${sender.fullName}`,
            description: note || `Payment from ${sender.fullName}`,
            tx_id: txn_Id, tx_time: new Date(),
            metadata: {
                transactionType: 'payment_received',
                senderOldBalance, receiverOldBalance,
                senderName: sender.fullName, receiverName: receiver.fullName,
                note: note || '', apiEndpoint: 'GET'
            }
        });
        await receiverTransaction.save({ session });

        await session.commitTransaction();
        console.log('✅ Payment Successful:', txn_Id);

        if (sender.telegramId) {
            const senderMessage =
`✅ API Payment Sent

Dear ${escapeHtml(sender.fullName)}, Your Payment Has Been Processed Successfully.

💰 Amount: ₹${paymentAmount}
📤 To: ${escapeHtml(receiver.fullName)}
💼 New Balance: ₹${sender.balance}
🧾 Transaction ID: ${txn_Id}
📝 Note: ${escapeHtml(note) || 'N/A'}
🕒 Date: ${new Date().toLocaleString()}

⚠️ If This Wasn't You, Please Contact Support Immediately.`;
            sendTelegramMessage(sender.telegramId, senderMessage).catch(() => {});
        }

        if (receiver.telegramId) {
            const receiverMessage =
`🎉 API Payment Received

Dear ${escapeHtml(receiver.fullName)}, You Have Received A Payment In Your Wallet.

💰 Amount: ₹${paymentAmount}
📥 From: ${escapeHtml(sender.fullName)}
💼 New Balance: ₹${receiver.balance}
🧾 Transaction ID: ${txn_Id}
📝 Note: ${escapeHtml(note) || 'N/A'}
🕒 Date: ${new Date().toLocaleString()}

✅ Amount Credited To Your Wallet Successfully.`;
            sendTelegramMessage(receiver.telegramId, receiverMessage).catch(() => {});
        }

        return sendResponse(res, 'success', 'Payment sent successfully', {
            transaction_id: txn_Id,
            amount: paymentAmount,
            sender: { name: sender.fullName, number: sender.mobile },
            receiver: { name: receiver.fullName, number: receiver.mobile },
            comment: note || 'Paid',
            timestamp: formatTimestamp()
        }, { newBalance: sender.balance });
    } catch (error) {
        await session.abortTransaction();
        const dupMsg = handleDuplicateError(error);
        if (dupMsg) return sendResponse(res, 'failed', dupMsg);
        console.error('Payment Error:', error);
        return sendResponse(res, 'failed', 'Failed to process payment');
    } finally {
        session.endSession();
    }
});

// ============================================
// /lookup
// ============================================
router.get('/lookup', auth, async (req, res) => {
    try {
        const { apiKey } = req.query;
        const user = req.user;
        if (!apiKey) return sendResponse(res, 'failed', 'API Key required');
        if (user.apiKey === apiKey) return sendResponse(res, 'failed', 'You cannot lookup yourself');

        const receiver = await User.findOne({ apiKey: apiKey.toUpperCase() })
            .select('fullName mobile walletId');
        if (!receiver) return sendResponse(res, 'failed', 'User not found');

        return sendResponse(res, 'success', 'User found', {
            name: receiver.fullName,
            number: receiver.mobile,
            walletId: receiver.walletId
        });
    } catch (error) {
        return sendResponse(res, 'failed', 'Failed to lookup user');
    }
});

// ============================================
// /history
// ============================================
router.get('/history', auth, async (req, res) => {
    try {
        const user = req.user;
        const { page = 1, limit = 20 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const transactions = await Transaction.find({ user_id: user._id })
            .sort({ tx_time: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .populate('sender_id', 'fullName mobile')
            .populate('receiver_id', 'fullName mobile');

        const total = await Transaction.countDocuments({ user_id: user._id });

        const transformedTransactions = transactions.map(txn => {
            const txnObj = txn.toObject();
            if (!txnObj.metadata || !txnObj.metadata.transactionType) {
                if (txn.sender_id && txn.sender_id._id.toString() === user._id.toString()) {
                    txnObj.userRole = 'sender';
                    txnObj.transactionType = 'payment_sent';
                } else if (txn.receiver_id && txn.receiver_id._id.toString() === user._id.toString()) {
                    txnObj.userRole = 'receiver';
                    txnObj.transactionType = 'payment_received';
                }
            }
            if (txnObj.metadata) {
                delete txnObj.metadata.senderApiKey;
                delete txnObj.metadata.receiverApiKey;
            }
            return txnObj;
        });

        return sendResponse(res, 'success', 'Transactions fetched successfully', {
            transactions: transformedTransactions,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(total / parseInt(limit)),
                totalTransactions: total
            }
        });
    } catch (error) {
        return sendResponse(res, 'failed', 'Failed to fetch payment history');
    }
});

// ============================================
// /my-apikey
// ============================================
router.get('/my-apikey', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('apiKey walletId fullName mobile apiKeyActive');
        if (!user) return sendResponse(res, 'failed', 'User not found');
        if (!user.apiKey) return sendResponse(res, 'failed', 'API Key not found. Please generate one');

        return sendResponse(res, 'success', 'API Key found', {
            apiKey: user.apiKey,
            walletId: user.walletId,
            fullName: user.fullName,
            mobile: user.mobile,
            apiKeyActive: user.apiKeyActive !== false
        });
    } catch (error) {
        return sendResponse(res, 'failed', 'Failed to fetch API Key');
    }
});

// ============================================
// /validate-key/:apiKey
// ============================================
router.get('/validate-key/:apiKey', async (req, res) => {
    try {
        const { apiKey } = req.params;
        if (!apiKey || apiKey.length !== 10 || !/^[A-Z0-9]+$/.test(apiKey)) {
            return sendResponse(res, 'failed', 'Invalid API Key format');
        }
        const user = await User.findOne({ apiKey: apiKey.toUpperCase() })
            .select('fullName walletId mobile balance apiKeyActive');
        if (!user) return sendResponse(res, 'failed', 'Invalid API Key');
        if (user.apiKeyActive === false) return sendResponse(res, 'failed', 'API Key is disabled');

        return sendResponse(res, 'success', 'API Key validated', {
            name: user.fullName,
            walletId: user.walletId,
            number: user.mobile,
            balance: user.balance
        });
    } catch (error) {
        return sendResponse(res, 'failed', 'Server error');
    }
});

// ============================================
// /request
// ============================================
router.get('/request', auth, async (req, res) => {
    try {
        const { receiverApiKey, amount, note = '' } = req.query;
        const requester = req.user;

        if (!receiverApiKey || !amount) {
            return sendResponse(res, 'failed', 'Receiver API Key and amount are required');
        }
        const requestAmount = parseFloat(amount);
        if (isNaN(requestAmount) || requestAmount < 1) {
            return sendResponse(res, 'failed', 'Minimum request amount is ₹1');
        }
        if (receiverApiKey.length !== 10 || !/^[A-Z0-9]+$/.test(receiverApiKey)) {
            return sendResponse(res, 'failed', 'Invalid receiver API Key format');
        }

        const receiverResult = await validateReceiverApiKey(receiverApiKey);
        if (receiverResult.status === 'failed') {
            return sendResponse(res, 'failed', receiverResult.message);
        }
        const receiver = receiverResult.user;

        if (requester.apiKey === receiverApiKey) {
            return sendResponse(res, 'failed', 'You cannot request payment from yourself');
        }
        if (receiver.isBlocked || requester.isBlocked) {
            return sendResponse(res, 'failed', 'Account is blocked');
        }

        if (receiver.telegramId) {
            const requestMessage =
`🔔 API Payment Request

Dear ${escapeHtml(receiver.fullName)}, You Have Received A Payment Request.

🙋 Requester: ${escapeHtml(requester.fullName)}
💰 Amount: ₹${requestAmount}
📝 Note: ${escapeHtml(note) || 'N/A'}
🕒 Date: ${new Date().toLocaleString()}

👉 Please Approve This Request To Complete The Transaction.
⚠️ If This Wasn't You, Please Ignore This Message.`;
            sendTelegramMessage(receiver.telegramId, requestMessage).catch(() => {});
        }

        if (requester.telegramId) {
            const confirmMessage =
`📤 API Payment Request Sent

Dear ${escapeHtml(requester.fullName)}, Your Payment Request Has Been Sent Successfully.

📥 To: ${escapeHtml(receiver.fullName)}
💰 Amount: ₹${requestAmount}
📝 Note: ${escapeHtml(note) || 'N/A'}
🕒 Date: ${new Date().toLocaleString()}

📨 Your Request Has Been Sent To The Receiver.
🔔 You Will Be Notified When The Request Is Approved.`;
            sendTelegramMessage(requester.telegramId, confirmMessage).catch(() => {});
        }

        return sendResponse(res, 'success', 'Payment request sent successfully', {
            requester: requester.fullName,
            receiver: receiver.fullName,
            receiverMobile: receiver.mobile,
            amount: requestAmount,
            note: note || '',
            timestamp: formatTimestamp()
        });
    } catch (error) {
        return sendResponse(res, 'failed', 'Failed to send payment request');
    }
});

// ============================================
// /:txnId — LAST
// ============================================
router.get('/:txnId', auth, async (req, res) => {
    try {
        const { txnId } = req.params;
        const user = req.user;

        const transaction = await Transaction.findOne({
            tx_id: txnId,
            user_id: user._id
        })
        .populate('sender_id', 'fullName mobile walletId')
        .populate('receiver_id', 'fullName mobile walletId');

        if (!transaction) return sendResponse(res, 'failed', 'Transaction not found');

        const txnObj = transaction.toObject();
        if (!txnObj.metadata || !txnObj.metadata.transactionType) {
            if (txnObj.sender_id && txnObj.sender_id._id.toString() === user._id.toString()) {
                txnObj.userRole = 'sender';
                txnObj.transactionType = 'payment_sent';
            } else if (txnObj.receiver_id && txnObj.receiver_id._id.toString() === user._id.toString()) {
                txnObj.userRole = 'receiver';
                txnObj.transactionType = 'payment_received';
            }
        }
        if (txnObj.metadata) {
            delete txnObj.metadata.senderApiKey;
            delete txnObj.metadata.receiverApiKey;
        }

        return sendResponse(res, 'success', 'Transaction found', { transaction: txnObj });
    } catch (error) {
        return sendResponse(res, 'failed', 'Failed to fetch transaction');
    }
});

module.exports = router;
