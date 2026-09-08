// FILE: routes/payment.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;

// ============================================
// Helper: Generate Transaction ID (API vs Regular)
// ============================================
function generateTxnId(existingTxnId, isApi = false) {
    if (existingTxnId) {
        return existingTxnId;
    }
    if (isApi) {
        return 'TXN_API_' + generateRandomString(20);
    }
    return 'TXN' + Date.now() + Math.floor(Math.random() * 99999);
}

function generateRandomString(length) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// ============================================
// Helper: Send Telegram notification (fire-and-forget)
// ============================================
function sendTelegramMessage(chatId, message) {
    // No await – we just fire and forget
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
// Helper: Check if API Key is Active
// ============================================
async function isApiKeyActive(apiKey) {
    try {
        const user = await User.findOne({ apiKey }).select('apiKeyActive');
        if (!user) return false;
        return user.apiKeyActive !== false;
    } catch (error) {
        console.error('Error checking API key status:', error);
        return false;
    }
}

// ============================================
// Helper: Validate API Key with Status Check
// ============================================
async function validateApiKey(apiKey) {
    if (!apiKey || apiKey.length !== 10 || !/^[A-Z0-9]+$/.test(apiKey)) {
        return { status: 'failed', message: 'Invalid API Key format' };
    }
    
    const user = await User.findOne({ apiKey }).select('_id fullName mobile walletId balance isBlocked telegramId apiKeyActive');
    
    if (!user) {
        return { status: 'failed', message: 'Invalid API Key' };
    }
    
    if (user.apiKeyActive === false) {
        return { status: 'failed', message: 'API Key is disabled' };
    }
    
    if (user.isBlocked) {
        return { status: 'failed', message: 'User account is blocked' };
    }
    
    return { status: 'success', user };
}

// Helper: Find user by mobile number
async function findUserByMobile(mobile) {
    if (!mobile || !/^[0-9]{10}$/.test(mobile)) {
        return { status: 'failed', message: 'Invalid mobile number format' };
    }
    
    const user = await User.findOne({ mobile }).select('_id fullName mobile walletId balance isBlocked telegramId');
    
    if (!user) {
        return { status: 'failed', message: 'User not found with this mobile number' };
    }
    
    if (user.isBlocked) {
        return { status: 'failed', message: 'Receiver account is blocked' };
    }
    
    return { status: 'success', user };
}

// Helper: Validate API Key for receiver
async function validateReceiverApiKey(apiKey) {
    if (!apiKey || apiKey.length !== 10 || !/^[A-Z0-9]+$/.test(apiKey)) {
        return { status: 'failed', message: 'Invalid receiver API Key format' };
    }
    
    const user = await User.findOne({ apiKey }).select('_id fullName mobile walletId balance isBlocked telegramId');
    
    if (!user) {
        return { status: 'failed', message: 'Receiver not found' };
    }
    
    if (user.isBlocked) {
        return { status: 'failed', message: 'Receiver account is blocked' };
    }
    
    return { status: 'success', user };
}

// ============================================
// Auth middleware (always returns 200 with status field)
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
// Helper: Always return 200 with JSON structure
// ============================================
function sendResponse(res, status, message, data = null, extra = {}) {
    const body = { status, message };
    if (data !== null) body.data = data;
    Object.assign(body, extra);
    return res.json(body);
}

// ============================================
// ✅ GET PAYMENT (API Payment - TXN_API_)
// ============================================
router.get('/', async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const fullUrl = req.originalUrl || req.url;
        // URI too long → return 200 with status failed
        if (fullUrl.length > 8000) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Request URI too long. Use POST method.', null, {
                suggestion: 'Use POST method instead of GET',
                current_length: fullUrl.length,
                max_length: 8000
            });
        }

        const { key, number, amount, comment = '' } = req.query;

        console.log('📱 Payment Request Via GET:');
        console.log('  Key:', key ? '***' + key.slice(-4) : 'MISSING');
        console.log('  Number:', number);
        console.log('  Amount:', amount);
        console.log('  Comment:', comment);
        console.log('  URL Length:', fullUrl.length);

        // Validation
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
        if (paymentAmount > 5000) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Maximum payment amount is ₹5,000');
        }

        if (!key || key.length !== 10 || !/^[A-Z0-9]+$/.test(key)) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Invalid API Key format');
        }

        const isActive = await isApiKeyActive(key);
        if (!isActive) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'API Key is disabled');
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

        if (receiver.isBlocked || sender.isBlocked) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Account is blocked');
        }

        const txn_Id = generateTxnId(null, true);
        const senderOldBalance = sender.balance;
        const receiverOldBalance = receiver.balance;

        sender.balance = senderOldBalance - paymentAmount;
        receiver.balance = receiverOldBalance + paymentAmount;

        await sender.save({ session });
        await receiver.save({ session });

        // Sender Transaction
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

        // Receiver Transaction
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
        console.log('✅ Payment Successful:', txn_Id);

        // Fire-and-forget Telegram notifications
        if (sender.telegramId) {
            const senderMessage = 
`<b>────────────────────</b>
<b>💸 Aᴩɪ Pᴀʏᴍᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ</b>
<b>────────────────────</b>

<b>👤 Dᴇᴀʀ ${sender.fullName},</b> Yᴏᴜʀ Pᴀʏᴍᴇɴᴛ Hᴀꜱ Bᴇᴇɴ Pʀᴏᴄᴇꜱꜱᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ.

💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${paymentAmount}
👤 <b>Tᴏ:</b> ${receiver.fullName}
💳 <b>Nᴇᴡ Bᴀʟᴀɴᴄᴇ:</b> ₹${sender.balance}
🆔 <b>Txɴ Iᴅ:</b> ${txn_Id}
📝 <b>Cᴏᴍᴍᴇɴᴛ:</b> ${comment || 'N/A'}
📅 <code>${new Date().toLocaleString()}</code>

───────────────────────
⚠️ Iꜰ Tʜɪꜱ Wᴀꜱɴ'ᴛ Yᴏᴜ, Pʟᴇᴀꜱᴇ Cᴏɴᴛᴀᴄᴛ Sᴜᴘᴘᴏʀᴛ Iᴍᴍᴇᴅɪᴀᴛᴇʟʏ.
───────────────────────`;
            sendTelegramMessage(sender.telegramId, senderMessage).catch(() => {});
        }

        if (receiver.telegramId) {
            const receiverMessage = 
`<b>─────────────────</b>
<b>💰 Aᴩɪ Pᴀʏᴍᴇɴᴛ Rᴇᴄᴇɪᴠᴇᴅ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${receiver.fullName},</b> Yᴏᴜ Hᴀᴠᴇ Rᴇᴄᴇɪᴠᴇᴅ A Pᴀʏᴍᴇɴᴛ Iɴ Yᴏᴜʀ Wᴀʟʟᴇᴛ.

💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${paymentAmount}
👤 <b>Fʀᴏᴍ:</b> ${sender.fullName}
💳 <b>Nᴇᴡ Bᴀʟᴀɴᴄᴇ:</b> ₹${receiver.balance}
🆔 <b>Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ:</b> ${txn_Id}
📝 <b>Cᴏᴍᴍᴇɴᴛ:</b> ${comment || 'N/A'}
📅 <code>${new Date().toLocaleString()}</code>

───────────────────────
✅ Aᴍᴏᴜɴᴛ Cʀᴇᴅɪᴛᴇᴅ Tᴏ Yᴏᴜʀ Wᴀʟʟᴇᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ.
───────────────────────`;
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
// ✅ POST PAYMENT (API Payment - POST Method)
// ============================================
router.post('/', async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const { key, number, amount, comment = '' } = req.body;

        console.log('📱 Payment Request Via POST:');
        console.log('  Key:', key ? '***' + key.slice(-4) : 'MISSING');
        console.log('  Number:', number);
        console.log('  Amount:', amount);
        console.log('  Comment:', comment);

        // Validation (same as GET)
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
        if (paymentAmount > 5000) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Maximum payment amount is ₹5,000');
        }

        if (!key || key.length !== 10 || !/^[A-Z0-9]+$/.test(key)) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Invalid API Key format');
        }

        const isActive = await isApiKeyActive(key);
        if (!isActive) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'API Key is disabled');
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

        if (receiver.isBlocked || sender.isBlocked) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Account is blocked');
        }

        const txn_Id = generateTxnId(null, true);
        const senderOldBalance = sender.balance;
        const receiverOldBalance = receiver.balance;

        sender.balance = senderOldBalance - paymentAmount;
        receiver.balance = receiverOldBalance + paymentAmount;

        await sender.save({ session });
        await receiver.save({ session });

        // Sender Transaction
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

        // Receiver Transaction
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
        console.log('✅ Payment Successful (POST):', txn_Id);

        // Fire-and-forget Telegram notifications
        if (sender.telegramId) {
            const senderMessage = 
`<b>────────────────────</b>
<b>💸 Aᴩɪ Pᴀʏᴍᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ</b>
<b>────────────────────</b>

<b>👤 Dᴇᴀʀ ${sender.fullName},</b> Yᴏᴜʀ Pᴀʏᴍᴇɴᴛ Hᴀꜱ Bᴇᴇɴ Pʀᴏᴄᴇꜱꜱᴇᴅ.

💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${paymentAmount}
👤 <b>Tᴏ:</b> ${receiver.fullName}
💳 <b>Nᴇᴡ Bᴀʟᴀɴᴄᴇ:</b> ₹${sender.balance}
🆔 <b>Txɴ Iᴅ:</b> ${txn_Id}
📝 <b>Cᴏᴍᴍᴇɴᴛ:</b> ${comment || 'N/A'}

───────────────────────
⚠️ Iꜰ Tʜɪꜱ Wᴀꜱɴ'ᴛ Yᴏᴜ, Cᴏɴᴛᴀᴄᴛ Sᴜᴘᴘᴏʀᴛ.
───────────────────────`;
            sendTelegramMessage(sender.telegramId, senderMessage).catch(() => {});
        }

        if (receiver.telegramId) {
            const receiverMessage = 
`<b>─────────────────</b>
<b>💰 Aᴩɪ Pᴀʏᴍᴇɴᴛ Rᴇᴄᴇɪᴠᴇᴅ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${receiver.fullName},</b> Yᴏᴜ Hᴀᴠᴇ Rᴇᴄᴇɪᴠᴇᴅ A Pᴀʏᴍᴇɴᴛ.

💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${paymentAmount}
👤 <b>Fʀᴏᴍ:</b> ${sender.fullName}
💳 <b>Nᴇᴡ Bᴀʟᴀɴᴄᴇ:</b> ₹${receiver.balance}
🆔 <b>Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ:</b> ${txn_Id}

───────────────────────
✅ Aᴍᴏᴜɴᴛ Cʀᴇᴅɪᴛᴇᴅ Tᴏ Yᴏᴜʀ Wᴀʟʟᴇᴛ.
───────────────────────`;
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
// ✅ GET: MAKE PAYMENT (AUTHENTICATED - Regular TXN)
// ============================================
router.get('/make', auth, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
        const { receiverApiKey, amount, note = '' } = req.query;
        const sender = req.user;

        console.log('💳 Payment Request From:', sender._id);

        if (!receiverApiKey || !amount) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Receiver API Key and amount are required');
        }

        if (amount < 1) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Minimum payment amount is ₹1');
        }

        if (amount > 5000) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Maximum payment amount is ₹5,000');
        }

        if (sender.apiKey === receiverApiKey) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'You cannot pay yourself');
        }

        if (!receiverApiKey || receiverApiKey.length !== 10 || !/^[A-Z0-9]+$/.test(receiverApiKey)) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Invalid receiver API Key format');
        }

        const receiverResult = await validateReceiverApiKey(receiverApiKey);
        if (receiverResult.status === 'failed') {
            await session.abortTransaction();
            return sendResponse(res, 'failed', receiverResult.message);
        }
        const receiver = receiverResult.user;

        if (sender.balance < amount) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Insufficient balance', { balance: sender.balance });
        }

        if (receiver.isBlocked || sender.isBlocked) {
            await session.abortTransaction();
            return sendResponse(res, 'failed', 'Account is blocked');
        }

        const txn_Id = generateTxnId(null, false);
        const senderOldBalance = sender.balance;
        const receiverOldBalance = receiver.balance;

        sender.balance = senderOldBalance - amount;
        receiver.balance = receiverOldBalance + amount;

        await sender.save({ session });
        await receiver.save({ session });

        // Sender Transaction - transfer type (payment_sent)
        const senderTransaction = new Transaction({
            user_id: sender._id,
            sender_id: sender._id,
            receiver_id: receiver._id,
            amount: amount,
            type: 'transfer',
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

        // Receiver Transaction - transfer type (payment_received)
        const receiverTransaction = new Transaction({
            user_id: receiver._id,
            sender_id: sender._id,
            receiver_id: receiver._id,
            amount: amount,
            type: 'transfer',
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
        console.log('✅ Payment Successful:', txn_Id);

        // Fire-and-forget Telegram notifications
        if (sender.telegramId) {
            const senderMessage = 
`<b>───────────────</b>
<b>💸 Aᴩɪ Pᴀʏᴍᴇɴᴛ Sᴇɴᴛ</b>
<b>───────────────</b>

<b>👤 Dᴇᴀʀ ${sender.fullName},</b> Yᴏᴜʀ Pᴀʏᴍᴇɴᴛ Hᴀꜱ Bᴇᴇɴ Pʀᴏᴄᴇꜱꜱᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ.

💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${amount}
👤 <b>Tᴏ:</b> ${receiver.fullName}
💳 <b>Nᴇᴡ Bᴀʟᴀɴᴄᴇ:</b> ₹${sender.balance}
🆔 <b>Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ:</b> ${txn_Id}
📝 <b>Nᴏᴛᴇ:</b> ${note || 'N/A'}
📅 <code>${new Date().toLocaleString()}</code>

───────────────────────
⚠️ Iꜰ Tʜɪꜱ Wᴀꜱɴ'ᴛ Yᴏᴜ, Pʟᴇᴀꜱᴇ Cᴏɴᴛᴀᴄᴛ Sᴜᴘᴘᴏʀᴛ Iᴍᴍᴇᴅɪᴀᴛᴇʟʏ.
───────────────────────`;
            sendTelegramMessage(sender.telegramId, senderMessage).catch(() => {});
        }

        if (receiver.telegramId) {
            const receiverMessage = 
`<b>───────────────</b>
<b>💰 Aᴩɪ Pᴀʏᴍᴇɴᴛ Rᴇᴄᴇɪᴠᴇᴅ</b>
<b>───────────────</b>

<b>👤 Dᴇᴀʀ ${receiver.fullName},</b> Yᴏᴜ Hᴀᴠᴇ Rᴇᴄᴇɪᴠᴇᴅ A Pᴀʏᴍᴇɴᴛ Iɴ Yᴏᴜʀ Wᴀʟʟᴇᴛ.

💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${amount}
👤 <b>Fʀᴏᴍ:</b> ${sender.fullName}
💳 <b>Nᴇᴡ Bᴀʟᴀɴᴄᴇ:</b> ₹${receiver.balance}
🆔 <b>Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ:</b> ${txn_Id}
📝 <b>Nᴏᴛᴇ:</b> ${note || 'N/A'}
📅 <code>${new Date().toLocaleString()}</code>

───────────────────────
✅ Aᴍᴏᴜɴᴛ Cʀᴇᴅɪᴛᴇᴅ Tᴏ Yᴏᴜʀ Wᴀʟʟᴇᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ.
───────────────────────`;
            sendTelegramMessage(receiver.telegramId, receiverMessage).catch(() => {});
        }

        return sendResponse(res, 'success', 'Payment sent successfully', {
            transaction_id: txn_Id,
            amount: amount,
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
// ✅ GET USER BY API KEY (For Payment Lookup)
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

        const receiver = await User.findOne({ apiKey }).select('fullName mobile walletId');
        
        if (!receiver) {
            return sendResponse(res, 'failed', 'User not found');
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
// ✅ GET PAYMENT HISTORY
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
// ✅ GET PAYMENT DETAILS BY TRANSACTION ID
// ============================================
router.get('/:txnId', auth, async (req, res) => {
    try {
        const { txnId } = req.params;
        const user = req.user;

        console.log('🔍 Fᴇᴛᴄʜ𝙸ɴɢ Tʀᴀɴꜱᴀᴄᴛ𝙸ᴏɴ:', txnId);

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

        console.log('✅ Tʀᴀɴꜱᴀᴄᴛ𝙸ᴏɴ Fᴏᴜɴᴅ:', txnObj.tx_id);
        console.log('✅ Tʀᴀɴꜱᴀᴄᴛ𝙸ᴏɴ Tʏᴘᴇ:', txnObj.metadata?.transactionType);

        return sendResponse(res, 'success', 'Transaction found', {
            transaction: txnObj
        });

    } catch (error) {
        console.error('Get Transaction Error:', error);
        return sendResponse(res, 'failed', 'Failed to fetch transaction');
    }
});

// ============================================
// ✅ GET REQUEST PAYMENT (User Requests Payment)
// ============================================
router.get('/request', auth, async (req, res) => {
    try {
        const { receiverApiKey, amount, note = '' } = req.query;
        const requester = req.user;

        console.log('📨 Payment Request From:', requester._id);

        if (!receiverApiKey || !amount) {
            return sendResponse(res, 'failed', 'Receiver API Key and amount are required');
        }

        if (amount < 1) {
            return sendResponse(res, 'failed', 'Minimum request amount is ₹1');
        }

        if (!receiverApiKey || receiverApiKey.length !== 10 || !/^[A-Z0-9]+$/.test(receiverApiKey)) {
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

        // Fire-and-forget Telegram notifications
        if (receiver.telegramId) {
            const requestMessage = 
`<b>───────────────</b>
<b>📨 Aᴩɪ Pᴀʏᴍᴇɴᴛ Rᴇǫᴜᴇꜱᴛ</b>
<b>───────────────</b>

<b>👤 Dᴇᴀʀ ${receiver.fullName},</b> Yᴏᴜ Hᴀᴠᴇ Rᴇᴄᴇɪᴠᴇᴅ A Pᴀʏᴍᴇɴᴛ Rᴇǫᴜᴇꜱᴛ.

👤 <b>Rᴇǫᴜᴇꜱᴛᴇʀ:</b> ${requester.fullName}
💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${amount}
📝 <b>Nᴏᴛᴇ:</b> ${note || 'N/A'}
📅 <code>${new Date().toLocaleString()}</code>

───────────────────────
✅ Pʟᴇᴀꜱᴇ Aᴘᴘʀᴏᴠᴇ Tʜɪꜱ Rᴇǫᴜᴇꜱᴛ Tᴏ Cᴏᴍᴘʟᴇᴛᴇ Tʜᴇ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ.
⚠️ Iꜰ Tʜɪꜱ Wᴀꜱɴ'ᴛ Yᴏᴜ, Pʟᴇᴀꜱᴇ Iɢɴᴏʀᴇ Tʜɪꜱ Mᴇꜱꜱᴀɢᴇ.
───────────────────────`;
            sendTelegramMessage(receiver.telegramId, requestMessage).catch(() => {});
        }

        if (requester.telegramId) {
            const confirmMessage = 
`<b>───────────────</b>
<b>📤 Aᴩɪ Pᴀʏᴍᴇɴᴛ Rᴇǫᴜᴇꜱᴛ Sᴇɴᴛ</b>
<b>───────────────</b>

<b>👤 Dᴇᴀʀ ${requester.fullName},</b> Yᴏᴜʀ Pᴀʏᴍᴇɴᴛ Rᴇǫᴜᴇꜱᴛ Hᴀꜱ Bᴇᴇɴ Sᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ.

👤 <b>Tᴏ:</b> ${receiver.fullName}
💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${amount}
📝 <b>Nᴏᴛᴇ:</b> ${note || 'N/A'}
📅 <code>${new Date().toLocaleString()}</code>

───────────────────────
✅ Yᴏᴜʀ Rᴇǫᴜᴇꜱᴛ Hᴀꜱ Bᴇᴇɴ Sᴇɴᴛ Tᴏ Tʜᴇ Rᴇᴄᴇɪᴠᴇʀ.
⚠️ Yᴏᴜ Wɪʟʟ Bᴇ Nᴏᴛɪꜰɪᴇᴅ Wʜᴇɴ Tʜᴇ Rᴇǫᴜᴇꜱᴛ Iꜱ Aᴘᴘʀᴏᴠᴇᴅ.
───────────────────────`;
            sendTelegramMessage(requester.telegramId, confirmMessage).catch(() => {});
        }

        return sendResponse(res, 'success', 'Payment request sent successfully', {
            requester: requester.fullName,
            receiver: receiver.fullName,
            receiverMobile: receiver.mobile,
            amount: amount,
            note: note || '',
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
        console.error('Payment Request Error:', error);
        return sendResponse(res, 'failed', 'Failed to send payment request');
    }
});

// ============================================
// ✅ GET MY API KEY
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
// ✅ GET VALIDATE API KEY (Internal)
// ============================================
router.get('/validate-key/:apiKey', async (req, res) => {
    try {
        const { apiKey } = req.params;
        
        if (!apiKey || apiKey.length !== 10 || !/^[A-Z0-9]+$/.test(apiKey)) {
            return sendResponse(res, 'failed', 'Invalid API Key format');
        }
        
        const user = await User.findOne({ apiKey }).select('fullName walletId mobile balance apiKeyActive');
        
        if (!user) {
            return sendResponse(res, 'failed', 'Invalid API Key');
        }
        
        if (user.apiKeyActive === false) {
            return sendResponse(res, 'failed', 'API Key is disabled');
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

module.exports = router;
