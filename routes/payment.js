// FILE: routes/payment.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;

// ============================================
// Helper: Generate Transaction ID (TXN + 10 mixed chars)
// ============================================
function generateTxnId(existingTxnId) {
    if (existingTxnId) return existingTxnId;
    return 'TXN' + generateRandomString(10);
}

function generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    const bytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
        result += chars.charAt(bytes[i] % chars.length);
    }
    return result;
}

// ============================================
// Helper: Send Telegram notification (fire-and-forget)
// ============================================
function sendTelegramMessage(chatId, message) {
    return new Promise((resolve) => {
        const https = require('https');
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
                    resolve({ success: result.ok });
                } catch (e) {
                    resolve({ success: false });
                }
            });
        });
        
        request.on('error', () => resolve({ success: false }));
        request.write(data);
        request.end();
    });
}

// ============================================
// Helper: Validate Sender API Key
// Checks: format, existence, apiKeyActive, isBlocked
// ============================================
async function validateApiKey(apiKey) {
    if (!apiKey || apiKey.length !== 10 || !/^[A-Z0-9]+$/.test(apiKey)) {
        return { status: 'failed', message: 'Invalid API Key format' };
    }
    
    const user = await User.findOne({ apiKey })
        .select('_id fullName mobile walletId balance isBlocked telegramId apiKeyActive');
    
    if (!user) {
        return { status: 'failed', message: 'Invalid API Key' };
    }
    
    if (user.apiKeyActive === false) {
        return { status: 'failed', message: 'Your API Key is disabled' };
    }
    
    if (user.isBlocked) {
        return { status: 'failed', message: 'Your account is blocked' };
    }
    
    return { status: 'success', user };
}

// ============================================
// Helper: Validate Receiver API Key
// Checks: format, existence, apiKeyActive, isBlocked
// ============================================
async function validateReceiverApiKey(apiKey) {
    if (!apiKey || apiKey.length !== 10 || !/^[A-Z0-9]+$/.test(apiKey)) {
        return { status: 'failed', message: 'Invalid receiver API Key format' };
    }
    
    const user = await User.findOne({ apiKey })
        .select('_id fullName mobile walletId balance isBlocked telegramId apiKeyActive');
    
    if (!user) {
        return { status: 'failed', message: 'Receiver not found' };
    }
    
    if (user.apiKeyActive === false) {
        return { status: 'failed', message: 'Receiver API Key is disabled' };
    }
    
    if (user.isBlocked) {
        return { status: 'failed', message: 'Receiver account is blocked' };
    }
    
    return { status: 'success', user };
}

// ============================================
// Helper: Find User By Mobile
// Checks: format, existence, apiKeyActive, isBlocked
// ============================================
async function findUserByMobile(mobile) {
    if (!mobile || !/^[0-9]{10}$/.test(mobile)) {
        return { status: 'failed', message: 'Invalid mobile number format' };
    }
    
    const user = await User.findOne({ mobile })
        .select('_id fullName mobile walletId balance isBlocked telegramId apiKeyActive');
    
    if (!user) {
        return { status: 'failed', message: 'User not found with this mobile number' };
    }
    
    if (user.apiKeyActive === false) {
        return { status: 'failed', message: 'Receiver API Key is disabled' };
    }
    
    if (user.isBlocked) {
        return { status: 'failed', message: 'Receiver account is blocked' };
    }
    
    return { status: 'success', user };
}

// ============================================
// Auth middleware (JWT for /make, /history etc.)
// ============================================
async function auth(req, res, next) {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.json({ status: 'failed', message: 'No token provided' });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (!user) {
            return res.json({ status: 'failed', message: 'User not found' });
        }
        
        if (user.isBlocked) {
            return res.json({ status: 'failed', message: 'Account blocked' });
        }
        
        if (user.apiKeyActive === false) {
            return res.json({ status: 'failed', message: 'Your API Key is disabled' });
        }
        
        req.user = user;
        next();
    } catch (error) {
        console.error('Auth Error:', error.message);
        let message = 'Authentication error';
        if (error.name === 'JsonWebTokenError') message = 'Invalid token';
        if (error.name === 'TokenExpiredError') message = 'Token expired';
        return res.json({ status: 'failed', message });
    }
}

// ============================================
// Standard JSON Response Helper
// ============================================
function sendResponse(res, status, message, data = null, extra = {}) {
    const body = { status, message };
    if (data !== null) body.data = data;
    Object.assign(body, extra);
    return res.json(body);
}

// ============================================
// GET PAYMENT (API - GET Method)
// ============================================
router.get('/', async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const fullUrl = req.originalUrl || req.url;
        if (fullUrl.length > 8000) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Request URI too long. Use POST method.', null, {
                suggestion: 'Use POST method instead of GET',
                current_length: fullUrl.length,
                max_length: 8000
            });
        }

        const { key, number, amount, comment = '' } = req.query;

        console.log('Payment Request Via GET:');
        console.log('  Key:', key ? '***' + key.slice(-4) : 'MISSING');
        console.log('  Number:', number);
        console.log('  Amount:', amount);

        if (!key) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'API Key is required');
        }
        if (!number) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Receiver number is required');
        }
        if (!amount) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Amount is required');
        }

        const paymentAmount = parseFloat(amount);
        if (isNaN(paymentAmount) || paymentAmount <= 0) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Invalid amount');
        }

        if (paymentAmount > 5000) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Maximum payment amount is ₹5,000');
        }

        // ✅ Single combined check: sender (format + apiKeyActive + isBlocked)
        const senderResult = await validateApiKey(key);
        if (senderResult.status === 'failed') {
            await session.abortTransaction();
            return sendResponse(res, 'failed', senderResult.message);
        }
        const sender = senderResult.user;

        // ✅ Receiver check: (mobile format + apiKeyActive + isBlocked)
        const receiverResult = await findUserByMobile(number);
        if (receiverResult.status === 'failed') {
            await session.abortTransaction();
            return sendResponse(res, 'failed', receiverResult.message);
        }
        const receiver = receiverResult.user;

        if (sender._id.toString() === receiver._id.toString()) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'You cannot pay yourself');
        }

        if (sender.balance < paymentAmount) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Insufficient balance', { balance: sender.balance });
        }

        const txn_Id = generateTxnId(null);
        const senderOldBalance = sender.balance;
        const receiverOldBalance = receiver.balance;

        sender.balance = senderOldBalance - paymentAmount;
        receiver.balance = receiverOldBalance + paymentAmount;

        await sender.save({ session });
        await receiver.save({ session });

        // Sender txn: type 'api_send'
        const senderTransaction = new Transaction({
            user_id: sender._id,
            sender_id: sender._id,
            receiver_id: receiver._id,
            amount: paymentAmount,
            type: 'api_send',
            status: 'success',
            remark: comment || 'API Transfer',
            description: comment || 'API Transfer',
            tx_id: txn_Id,
            metadata: {
                transactionType: 'payment_sent',
                senderOldBalance,
                receiverOldBalance,
                senderName: sender.fullName,
                receiverName: receiver.fullName,
                receiverMobile: receiver.mobile,
                note: comment || '',
                apiEndpoint: 'GET'
            }
        });
        await senderTransaction.save({ session });

        // Receiver txn: type 'api_receive'
        const receiverTransaction = new Transaction({
            user_id: receiver._id,
            sender_id: sender._id,
            receiver_id: receiver._id,
            amount: paymentAmount,
            type: 'api_receive',
            status: 'success',
            remark: comment || 'API Transfer',
            description: comment || 'API Transfer',
            tx_id: txn_Id,
            metadata: {
                transactionType: 'payment_received',
                senderOldBalance,
                receiverOldBalance,
                senderName: sender.fullName,
                receiverName: receiver.fullName,
                receiverMobile: receiver.mobile,
                note: comment || '',
                apiEndpoint: 'GET'
            }
        });
        await receiverTransaction.save({ session });

        await session.commitTransaction();
        console.log('Payment Successful:', txn_Id);

        // Telegram notifications
        if (sender.telegramId) {
            const senderMessage = 
`✅ <b>API Payment Successful</b>

👤 Dear <b>${sender.fullName}</b>, Your Payment Has Been Processed Successfully.

💰 <b>Amount:</b> ₹${paymentAmount}
📤 <b>To:</b> ${receiver.fullName}
💼 <b>New Balance:</b> ₹${sender.balance}
🧾 <b>Txn Id:</b> <code>${txn_Id}</code>
📝 <b>Comment:</b> ${comment || 'N/A'}
🕒 <b>Date:</b> ${new Date().toLocaleString()}

⚠️ If This Wasn't You, Please Contact Support Immediately.`;
            sendTelegramMessage(sender.telegramId, senderMessage).catch(() => {});
        }

        if (receiver.telegramId) {
            const receiverMessage = 
`💵 <b>API Payment Received</b>

👤 Dear <b>${receiver.fullName}</b>, You Have Received A Payment In Your Wallet.

💰 <b>Amount:</b> ₹${paymentAmount}
📥 <b>From:</b> ${sender.fullName}
💼 <b>New Balance:</b> ₹${receiver.balance}
🧾 <b>Transaction Id:</b> <code>${txn_Id}</code>
📝 <b>Comment:</b> ${comment || 'N/A'}
🕒 <b>Date:</b> ${new Date().toLocaleString()}

✅ Amount Credited To Your Wallet Successfully.`;
            sendTelegramMessage(receiver.telegramId, receiverMessage).catch(() => {});
        }

        return sendResponse(res, 'success', 'Payment successful', {
            transaction_id: txn_Id,
            amount: paymentAmount,
            sender: {
                name: sender.fullName,
                number: sender.mobile
            },
            receiver: {
                name: receiver.fullName,
                number: receiver.mobile
            },
            comment: comment || 'Paid',
            timestamp: new Date().toLocaleString('en-IN', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }).replace(/\//g, '-')
        });

    } catch (error) {
        await session.abortTransaction();
        console.error('Payment Error:', error);
        if (error.code === 11000) {
            return sendResponse(res, 'failed', 'Transaction ID conflict. Please retry');
        }
        return sendResponse(res, 'failed', 'Failed to process payment');
    } finally {
        session.endSession();
    }
});

// ============================================
// POST PAYMENT (API - POST Method)
// ============================================
router.post('/', async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const { key, number, amount, comment = '' } = req.body;

        console.log('Payment Request Via POST:');
        console.log('  Key:', key ? '***' + key.slice(-4) : 'MISSING');
        console.log('  Number:', number);
        console.log('  Amount:', amount);

        if (!key) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'API Key is required');
        }
        if (!number) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Receiver number is required');
        }
        if (!amount) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Amount is required');
        }

        const paymentAmount = parseFloat(amount);
        if (isNaN(paymentAmount) || paymentAmount <= 0) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Invalid amount');
        }

        if (paymentAmount > 5000) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Maximum payment amount is ₹5,000');
        }

        const senderResult = await validateApiKey(key);
        if (senderResult.status === 'failed') {
            await session.abortTransaction();
            return sendResponse(res, 'failed', senderResult.message);
        }
        const sender = senderResult.user;

        const receiverResult = await findUserByMobile(number);
        if (receiverResult.status === 'failed') {
            await session.abortTransaction();
            return sendResponse(res, 'failed', receiverResult.message);
        }
        const receiver = receiverResult.user;

        if (sender._id.toString() === receiver._id.toString()) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'You cannot pay yourself');
        }

        if (sender.balance < paymentAmount) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Insufficient balance', { balance: sender.balance });
        }

        const txn_Id = generateTxnId(null);
        const senderOldBalance = sender.balance;
        const receiverOldBalance = receiver.balance;

        sender.balance = senderOldBalance - paymentAmount;
        receiver.balance = receiverOldBalance + paymentAmount;

        await sender.save({ session });
        await receiver.save({ session });

        const senderTransaction = new Transaction({
            user_id: sender._id,
            sender_id: sender._id,
            receiver_id: receiver._id,
            amount: paymentAmount,
            type: 'api_send',
            status: 'success',
            remark: comment || 'API Transfer',
            description: comment || 'API Transfer',
            tx_id: txn_Id,
            metadata: {
                transactionType: 'payment_sent',
                senderOldBalance,
                receiverOldBalance,
                senderName: sender.fullName,
                receiverName: receiver.fullName,
                receiverMobile: receiver.mobile,
                note: comment || '',
                apiEndpoint: 'POST'
            }
        });
        await senderTransaction.save({ session });

        const receiverTransaction = new Transaction({
            user_id: receiver._id,
            sender_id: sender._id,
            receiver_id: receiver._id,
            amount: paymentAmount,
            type: 'api_receive',
            status: 'success',
            remark: comment || 'API Transfer',
            description: comment || 'API Transfer',
            tx_id: txn_Id,
            metadata: {
                transactionType: 'payment_received',
                senderOldBalance,
                receiverOldBalance,
                senderName: sender.fullName,
                receiverName: receiver.fullName,
                receiverMobile: receiver.mobile,
                note: comment || '',
                apiEndpoint: 'POST'
            }
        });
        await receiverTransaction.save({ session });

        await session.commitTransaction();
        console.log('Payment Successful (POST):', txn_Id);

        if (sender.telegramId) {
            const senderMessage = 
`✅ <b>API Payment Successful</b>

👤 Dear <b>${sender.fullName}</b>, Your Payment Has Been Processed.

💰 <b>Amount:</b> ₹${paymentAmount}
📤 <b>To:</b> ${receiver.fullName}
💼 <b>New Balance:</b> ₹${sender.balance}
🧾 <b>Txn Id:</b> <code>${txn_Id}</code>
📝 <b>Comment:</b> ${comment || 'N/A'}
🕒 <b>Date:</b> ${new Date().toLocaleString()}

⚠️ If This Wasn't You, Contact Support.`;
            sendTelegramMessage(sender.telegramId, senderMessage).catch(() => {});
        }

        if (receiver.telegramId) {
            const receiverMessage = 
`💵 <b>API Payment Received</b>

👤 Dear <b>${receiver.fullName}</b>, You Have Received A Payment.

💰 <b>Amount:</b> ₹${paymentAmount}
📥 <b>From:</b> ${sender.fullName}
💼 <b>New Balance:</b> ₹${receiver.balance}
🧾 <b>Transaction Id:</b> <code>${txn_Id}</code>
📝 <b>Comment:</b> ${comment || 'N/A'}
🕒 <b>Date:</b> ${new Date().toLocaleString()}

✅ Amount Credited To Your Wallet.`;
            sendTelegramMessage(receiver.telegramId, receiverMessage).catch(() => {});
        }

        return sendResponse(res, 'success', 'Payment successful', {
            transaction_id: txn_Id,
            amount: paymentAmount,
            sender: {
                name: sender.fullName,
                number: sender.mobile
            },
            receiver: {
                name: receiver.fullName,
                number: receiver.mobile
            },
            comment: comment || 'Paid',
            timestamp: new Date().toLocaleString('en-IN', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }).replace(/\//g, '-')
        });

    } catch (error) {
        await session.abortTransaction();
        console.error('Payment Error (POST):', error);
        if (error.code === 11000) {
            return sendResponse(res, 'failed', 'Transaction ID conflict. Please retry');
        }
        return sendResponse(res, 'failed', 'Failed to process payment');
    } finally {
        session.endSession();
    }
});

// ============================================
// GET: MAKE PAYMENT (JWT Auth)
// ============================================
router.get('/make', auth, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const { receiverApiKey, amount, note = '' } = req.query;
        const sender = req.user;

        console.log('Payment Request From:', sender._id);

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

        // ✅ Receiver full check (format + apiKeyActive + isBlocked)
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

        const txn_Id = generateTxnId(null);
        const senderOldBalance = sender.balance;
        const receiverOldBalance = receiver.balance;

        sender.balance = senderOldBalance - paymentAmount;
        receiver.balance = receiverOldBalance + paymentAmount;

        await sender.save({ session });
        await receiver.save({ session });

        const senderTransaction = new Transaction({
            user_id: sender._id,
            sender_id: sender._id,
            receiver_id: receiver._id,
            amount: paymentAmount,
            type: 'transfer_send',
            status: 'success',
            remark: note || `Payment to ${receiver.fullName}`,
            description: note || `Payment to ${receiver.fullName}`,
            tx_id: txn_Id,
            metadata: {
                transactionType: 'payment_sent',
                senderOldBalance,
                receiverOldBalance,
                senderName: sender.fullName,
                receiverName: receiver.fullName,
                note: note || '',
                apiEndpoint: 'GET'
            }
        });
        await senderTransaction.save({ session });

        const receiverTransaction = new Transaction({
            user_id: receiver._id,
            sender_id: sender._id,
            receiver_id: receiver._id,
            amount: paymentAmount,
            type: 'transfer_receive',
            status: 'success',
            remark: note || `Payment from ${sender.fullName}`,
            description: note || `Payment from ${sender.fullName}`,
            tx_id: txn_Id,
            metadata: {
                transactionType: 'payment_received',
                senderOldBalance,
                receiverOldBalance,
                senderName: sender.fullName,
                receiverName: receiver.fullName,
                note: note || '',
                apiEndpoint: 'GET'
            }
        });
        await receiverTransaction.save({ session });

        await session.commitTransaction();
        console.log('Payment Successful:', txn_Id);

        if (sender.telegramId) {
            const senderMessage = 
`✅ <b>Payment Sent Successfully</b>

👤 Dear <b>${sender.fullName}</b>, Your Payment Has Been Processed Successfully.

💰 <b>Amount:</b> ₹${paymentAmount}
📤 <b>To:</b> ${receiver.fullName}
💼 <b>New Balance:</b> ₹${sender.balance}
🧾 <b>Transaction Id:</b> <code>${txn_Id}</code>
📝 <b>Note:</b> ${note || 'N/A'}
🕒 <b>Date:</b> ${new Date().toLocaleString()}

⚠️ If This Wasn't You, Please Contact Support Immediately.`;
            sendTelegramMessage(sender.telegramId, senderMessage).catch(() => {});
        }

        if (receiver.telegramId) {
            const receiverMessage = 
`💵 <b>Payment Received</b>

👤 Dear <b>${receiver.fullName}</b>, You Have Received A Payment In Your Wallet.

💰 <b>Amount:</b> ₹${paymentAmount}
📥 <b>From:</b> ${sender.fullName}
💼 <b>New Balance:</b> ₹${receiver.balance}
🧾 <b>Transaction Id:</b> <code>${txn_Id}</code>
📝 <b>Note:</b> ${note || 'N/A'}
🕒 <b>Date:</b> ${new Date().toLocaleString()}

✅ Amount Credited To Your Wallet Successfully.`;
            sendTelegramMessage(receiver.telegramId, receiverMessage).catch(() => {});
        }

        return sendResponse(res, 'success', 'Payment sent successfully', {
            transaction_id: txn_Id,
            amount: paymentAmount,
            sender: {
                name: sender.fullName,
                number: sender.mobile
            },
            receiver: {
                name: receiver.fullName,
                number: receiver.mobile
            },
            comment: note || 'Paid',
            timestamp: new Date().toLocaleString('en-IN', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            }).replace(/\//g, '-')
        }, { newBalance: sender.balance });

    } catch (error) {
        await session.abortTransaction();
        console.error('Payment Error:', error);
        if (error.code === 11000) {
            return sendResponse(res, 'failed', 'Transaction ID conflict. Please retry');
        }
        return sendResponse(res, 'failed', 'Failed to process payment');
    } finally {
        session.endSession();
    }
});

// ============================================
// GET USER BY API KEY (Lookup)
// ============================================
router.get('/lookup', auth, async (req, res) => {
    try {
        const { apiKey } = req.query;
        const user = req.user;

        if (!apiKey) {
            return sendResponse(res, 'failed', 'API Key required');
        }

        if (user.apiKey === apiKey) {
            return sendResponse(res, 'failed', 'You cannot lookup yourself');
        }

        const receiver = await User.findOne({ apiKey }).select('fullName mobile walletId apiKeyActive isBlocked');
        
        if (!receiver) {
            return sendResponse(res, 'failed', 'User not found');
        }

        if (receiver.apiKeyActive === false) {
            return sendResponse(res, 'failed', 'This API Key is disabled');
        }

        if (receiver.isBlocked) {
            return sendResponse(res, 'failed', 'This account is blocked');
        }

        return sendResponse(res, 'success', 'User found', {
            name: receiver.fullName,
            number: receiver.mobile,
            walletId: receiver.walletId
        });

    } catch (error) {
        console.error('Lookup Error:', error);
        return sendResponse(res, 'failed', 'Failed to lookup user');
    }
});

// ============================================
// GET PAYMENT HISTORY
// ============================================
router.get('/history', auth, async (req, res) => {
    try {
        const user = req.user;
        const { page = 1, limit = 20 } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const transactions = await Transaction.find({
            user_id: user._id
        })
        .sort({ tx_time: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate('sender_id', 'fullName mobile')
        .populate('receiver_id', 'fullName mobile');

        const total = await Transaction.countDocuments({
            user_id: user._id
        });

        const transformedTransactions = transactions.map(txn => {
            const txnObj = txn.toObject();
            
            if (txn.metadata && txn.metadata.transactionType) {
                // Keep as is
            } else {
                if (txn.sender_id && txn.sender_id._id.toString() === user._id.toString()) {
                    txnObj.userRole = 'sender';
                    txnObj.transactionType = 'payment_sent';
                } else if (txn.receiver_id && txn.receiver_id._id.toString() === user._id.toString()) {
                    txnObj.userRole = 'receiver';
                    txnObj.transactionType = 'payment_received';
                }
            }
            
            delete txnObj.metadata?.senderApiKey;
            delete txnObj.metadata?.receiverApiKey;
            
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
        console.error('Get Payment History Error:', error);
        return sendResponse(res, 'failed', 'Failed to fetch payment history');
    }
});

// ============================================
// GET MY API KEY
// ============================================
router.get('/my-apikey', auth, async (req, res) => {
    try {
        const user = req.user;
        
        if (!user.apiKey) {
            return sendResponse(res, 'failed', 'API Key not found. Please generate one');
        }
        
        return sendResponse(res, 'success', 'API Key found', {
            apiKey: user.apiKey,
            walletId: user.walletId,
            fullName: user.fullName,
            mobile: user.mobile
        });
    } catch (error) {
        console.error('Get My API Key Error:', error);
        return sendResponse(res, 'failed', 'Failed to fetch API Key');
    }
});

// ============================================
// GET VALIDATE API KEY (Internal)
// ============================================
router.get('/validate-key/:apiKey', async (req, res) => {
    try {
        const { apiKey } = req.params;
        
        if (!apiKey || apiKey.length !== 10 || !/^[A-Z0-9]+$/.test(apiKey)) {
            return sendResponse(res, 'failed', 'Invalid API Key format');
        }
        
        const user = await User.findOne({ apiKey }).select('fullName walletId mobile balance apiKeyActive isBlocked');
        
        if (!user) {
            return sendResponse(res, 'failed', 'Invalid API Key');
        }
        
        if (user.apiKeyActive === false) {
            return sendResponse(res, 'failed', 'API Key is disabled');
        }
        
        if (user.isBlocked) {
            return sendResponse(res, 'failed', 'Account is blocked');
        }
        
        return sendResponse(res, 'success', 'API Key validated', {
            name: user.fullName,
            walletId: user.walletId,
            number: user.mobile,
            balance: user.balance
        });
    } catch (error) {
        console.error('Validate API Key Error:', error);
        return sendResponse(res, 'failed', 'Server error');
    }
});

// ============================================
// GET PAYMENT DETAILS BY TRANSACTION ID
// (Must be LAST to avoid route conflicts)
// ============================================
router.get('/:txnId', auth, async (req, res) => {
    try {
        const { txnId } = req.params;
        const user = req.user;

        console.log('Fetching Transaction:', txnId);

        const transaction = await Transaction.findOne({
            tx_id: txnId,
            user_id: user._id
        })
        .populate('sender_id', 'fullName mobile walletId')
        .populate('receiver_id', 'fullName mobile walletId');

        if (!transaction) {
            return sendResponse(res, 'failed', 'Transaction not found');
        }

        const txnObj = transaction.toObject();
        
        if (txnObj.metadata && txnObj.metadata.transactionType) {
            // Keep as is
        } else {
            if (txnObj.sender_id && txnObj.sender_id._id.toString() === user._id.toString()) {
                txnObj.userRole = 'sender';
                txnObj.transactionType = 'payment_sent';
            } else if (txnObj.receiver_id && txnObj.receiver_id._id.toString() === user._id.toString()) {
                txnObj.userRole = 'receiver';
                txnObj.transactionType = 'payment_received';
            }
        }
        
        delete txnObj.metadata?.senderApiKey;
        delete txnObj.metadata?.receiverApiKey;

        return sendResponse(res, 'success', 'Transaction found', {
            transaction: txnObj
        });

    } catch (error) {
        console.error('Get Transaction Error:', error);
        return sendResponse(res, 'failed', 'Failed to fetch transaction');
    }
});

module.exports = router;
