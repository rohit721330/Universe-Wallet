// FILE: routes/withdraw.js
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Withdrawal = require('../models/Withdraw');
const WithdrawSettings = require('../models/WithdrawSettings');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG = process.env.ADMIN_TG_ID;

// ============================================
// HELPER: Get Settings from Database
// ============================================
async function getWithdrawSettings() {
    try {
        let settings = await WithdrawSettings.findOne();
        if (!settings) {
            settings = new WithdrawSettings();
            await settings.save();
            console.log('Default Settings Created');
        }
        return settings;
    } catch (error) {
        console.error('Get Settings Error:', error.message);
        return WithdrawSettings.getDefaults();
    }
}

// ============================================
// HELPER: Calculate Withdrawal Fee
// ============================================
function calculateWithdrawFee(amount, fee, feeType) {
    if (!fee || fee <= 0 || !amount || amount <= 0) return 0;
    let feeAmount = 0;
    if (feeType === 'percentage') {
        feeAmount = (amount * fee) / 100;
    } else if (feeType === 'fixed') {
        feeAmount = fee;
    }
    return Math.round(feeAmount * 100) / 100;
}

// ============================================
// HELPER: Generate Transaction ID
// ============================================
function generateWithdrawTxnId() {
    return 'TXN_WITHDRAW_' + Date.now() + Math.floor(Math.random() * 99999);
}

// ============================================
// HELPER: Get Current Date Time in IST
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

// ============================================
// HELPER: Send Message via Telegram
// ============================================
async function sendTelegramMessage(chatId, message) {
    if (!BOT_TOKEN) {
        console.log('Bot Token Not Configured');
        return { success: false, error: 'BOT_TOKEN not configured' };
    }
    return new Promise((resolve) => {
        const https = require('https');
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const data = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' });
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
                    result.ok ? console.log('Telegram Message Sent') : console.error('Telegram Error:', result.description);
                    resolve({ success: result.ok, error: result.description });
                } catch (e) {
                    console.error('Parse Error:', e.message);
                    resolve({ success: false, error: e.message });
                }
            });
        });
        request.on('error', (error) => { 
            console.error('Request Error:', error.message); 
            resolve({ success: false, error: error.message }); 
        });
        request.write(data);
        request.end();
    });
}

// ============================================
// HELPER: Send Notification to Admin
// ============================================
async function notifyAdmin(message) {
    if (!ADMIN_TG) { 
        console.log('Admin Telegram Id Not Configured'); 
        return; 
    }
    try { 
        await sendTelegramMessage(ADMIN_TG, message); 
        console.log('Admin Notification Sent'); 
    } catch (error) { 
        console.error('Failed To Send Admin Notification:', error.message); 
    }
}

// ============================================
// HELPER: Check Withdrawal Settings
// ============================================
async function checkWithdrawSettings(amount) {
    const settings = await getWithdrawSettings();
    if (!settings.enabled) {
        return { allowed: false, message: 'Withdrawal Is Currently Disabled. Please Try Again Later.' };
    }
    if (amount < settings.minAmount) {
        return { allowed: false, message: `Minimum Withdrawal Amount Is ₹${settings.minAmount}. Your Amount: ₹${amount}` };
    }
    if (amount > settings.maxAmount) {
        return { allowed: false, message: `Maximum Withdrawal Amount Is ₹${settings.maxAmount}. Your Amount: ₹${amount}` };
    }
    return { allowed: true, settings };
}

// ============================================
// VERIFY TOKEN MIDDLEWARE
// ============================================
async function verifyToken(req, res, next) {
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
        if (user.isBlocked) {
            return res.status(403).json({ success: false, message: 'Your Account Is Blocked' });
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
}

// ============================================
// 1. REQUEST WITHDRAWAL - UPI Method
// ============================================
router.post('/upi', verifyToken, async (req, res) => {
    try {
        const { amount, upiId, note } = req.body;
        const user = req.user;
        const dateTime = getCurrentDateTime();
        
        console.log('UPI Withdrawal Request:', { User: user.mobile, Amount: amount, UPI: upiId });
        
        const settingsCheck = await checkWithdrawSettings(amount);
        if (!settingsCheck.allowed) {
            return res.status(400).json({ success: false, message: settingsCheck.message });
        }
        const settings = settingsCheck.settings;
        
        // Calculate Fee (Tax)
        const feeAmount = calculateWithdrawFee(amount, settings.fee, settings.feeType);
        // User will receive: amount - fee
        const userReceives = Math.round((amount - feeAmount) * 100) / 100;
        
        console.log('Fee Calculation:', { 
            WithdrawAmount: amount, 
            FeeRate: settings.fee, 
            FeeType: settings.feeType, 
            FeeAmount: feeAmount, 
            UserReceives: userReceives 
        });
        
        if (!upiId || !upiId.includes('@')) {
            return res.status(400).json({ success: false, message: 'Please Enter A Valid UPI ID (e.g. name@upi)' });
        }
        
        // Check Balance (only withdrawal amount, not including fee)
        if (user.balance < amount) {
            return res.status(400).json({ success: false, message: `Insufficient Balance. Required: ₹${amount.toFixed(2)}. Your Balance: ₹${user.balance.toFixed(2)}` });
        }
        
        if (settings.maxDailyWithdrawals > 0) {
            const today = new Date(); 
            today.setHours(0, 0, 0, 0);
            const todayCount = await Withdrawal.countDocuments({ userId: user._id, createdAt: { $gte: today } });
            if (todayCount >= settings.maxDailyWithdrawals) {
                return res.status(400).json({ success: false, message: `You Have Reached Your Daily Withdrawal Limit (${settings.maxDailyWithdrawals}). Please Try Tomorrow.` });
            }
        }
        
        if (settings.maxMonthlyWithdrawals > 0) {
            const monthStart = new Date(); 
            monthStart.setDate(1); 
            monthStart.setHours(0, 0, 0, 0);
            const monthCount = await Withdrawal.countDocuments({ userId: user._id, createdAt: { $gte: monthStart } });
            if (monthCount >= settings.maxMonthlyWithdrawals) {
                return res.status(400).json({ success: false, message: `You Have Reached Your Monthly Withdrawal Limit (${settings.maxMonthlyWithdrawals}). Please Try Next Month.` });
            }
        }
        
        const transactionId = generateWithdrawTxnId();
        const oldBalance = user.balance;
        // Deduct only the withdrawal amount (not fee)
        user.balance = Math.round((user.balance - amount) * 100) / 100;
        await user.save();
        
        const withdrawal = new Withdrawal({
            userId: user._id,
            walletId: user.walletId,
            amount: amount,
            fee: feeAmount,
            feeType: settings.feeType,
            feeRate: settings.fee,
            userReceives: userReceives,
            method: 'upi',
            upiId: upiId,
            status: 'pending',
            transactionId: transactionId,
            userNote: note || 'UPI Withdrawal',
            apiKeyUsed: null
        });
        await withdrawal.save();
        
        const transaction = new Transaction({
            tx_id: transactionId,
            user_id: user._id,
            sender_id: user._id,
            receiver_id: user._id,
            amount: amount,
            type: 'withdraw',
            status: 'pending',
            remark: note || 'UPI Withdrawal',
            description: `UPI Withdrawal to ${upiId} - Amount: ₹${amount.toFixed(2)} - Fee: ₹${feeAmount.toFixed(2)} - You Receive: ₹${userReceives.toFixed(2)}`,
            tx_time: new Date(),
            metadata: { 
                method: 'upi', 
                upiId: upiId, 
                oldBalance: oldBalance, 
                newBalance: user.balance, 
                withdrawalId: withdrawal._id, 
                status: 'pending', 
                amount: amount, 
                fee: feeAmount, 
                feeType: settings.feeType, 
                feeRate: settings.fee,
                userReceives: userReceives
            }
        });
        await transaction.save();
        
        console.log('UPI Withdrawal Created:', transactionId);
        
        const feeText = feeAmount > 0 ? `\nFee (${settings.feeType}): ₹${feeAmount.toFixed(2)}` : '';
        const receiveText = feeAmount > 0 ? `\nYou Receive: ₹${userReceives.toFixed(2)}` : '';
        
        await notifyAdmin(
`New UPI Withdrawal Request

User Information
Name: ${user.fullName}
Mobile: ${user.mobile}
Wallet ID: ${user.walletId}

Transaction Details
Amount: ₹${amount.toFixed(2)}${feeText}${receiveText}

Method: UPI
UPI ID: ${upiId}
Transaction ID: ${transactionId}
Note: ${note || 'No Comment'}
Date: ${dateTime}

Status: Pending Approval
Admin Action Required`);
        
        if (user.telegramId) {
            const userFeeText = feeAmount > 0 ? `\nFee Charged: ₹${feeAmount.toFixed(2)}\nYou Receive: ₹${userReceives.toFixed(2)}` : '';
            await sendTelegramMessage(user.telegramId,
`UPI Withdrawal Submitted

Dear ${user.fullName},

Your UPI withdrawal request has been submitted.

Amount: ₹${amount.toFixed(2)}
UPI ID: ${upiId}${userFeeText}
Transaction ID: ${transactionId}
New Balance: ₹${user.balance.toFixed(2)}
Date: ${dateTime}

Please wait for admin approval.`);
        }
        
        res.json({
            success: true,
            message: `UPI Withdrawal Request Submitted! ₹${amount.toFixed(2)} Has Been Deducted. You Will Receive ₹${userReceives.toFixed(2)} After Fee. Waiting For Admin Approval.`,
            transactionId: transactionId,
            amount: amount,
            fee: feeAmount,
            feeType: settings.feeType,
            feeRate: settings.fee,
            userReceives: userReceives,
            newBalance: user.balance,
            status: 'pending',
            method: 'upi'
        });
        
    } catch (error) {
        console.error('UPI Withdrawal Error:', error.message);
        res.status(500).json({ success: false, message: error.message || 'UPI Withdrawal Failed. Please Try Again.' });
    }
});

// ============================================
// 2. REQUEST WITHDRAWAL - Bank Method
// ============================================
router.post('/bank', verifyToken, async (req, res) => {
    try {
        const { amount, bankName, accountNumber, accountHolderName, ifscCode, note } = req.body;
        const user = req.user;
        const dateTime = getCurrentDateTime();
        
        console.log('Bank Withdrawal Request:', { User: user.mobile, Amount: amount, Bank: bankName });
        
        const settingsCheck = await checkWithdrawSettings(amount);
        if (!settingsCheck.allowed) {
            return res.status(400).json({ success: false, message: settingsCheck.message });
        }
        const settings = settingsCheck.settings;
        
        // Calculate Fee (Tax)
        const feeAmount = calculateWithdrawFee(amount, settings.fee, settings.feeType);
        // User will receive: amount - fee
        const userReceives = Math.round((amount - feeAmount) * 100) / 100;
        
        console.log('Fee Calculation:', { 
            WithdrawAmount: amount, 
            FeeRate: settings.fee, 
            FeeType: settings.feeType, 
            FeeAmount: feeAmount, 
            UserReceives: userReceives 
        });
        
        if (!bankName || !accountNumber || !accountHolderName || !ifscCode) {
            return res.status(400).json({ success: false, message: 'Please Fill All Bank Details' });
        }
        
        // Check Balance (only withdrawal amount, not including fee)
        if (user.balance < amount) {
            return res.status(400).json({ success: false, message: `Insufficient Balance. Required: ₹${amount.toFixed(2)}. Your Balance: ₹${user.balance.toFixed(2)}` });
        }
        
        if (settings.maxDailyWithdrawals > 0) {
            const today = new Date(); 
            today.setHours(0, 0, 0, 0);
            const todayCount = await Withdrawal.countDocuments({ userId: user._id, createdAt: { $gte: today } });
            if (todayCount >= settings.maxDailyWithdrawals) {
                return res.status(400).json({ success: false, message: `You Have Reached Your Daily Withdrawal Limit (${settings.maxDailyWithdrawals}). Please Try Tomorrow.` });
            }
        }
        
        if (settings.maxMonthlyWithdrawals > 0) {
            const monthStart = new Date(); 
            monthStart.setDate(1); 
            monthStart.setHours(0, 0, 0, 0);
            const monthCount = await Withdrawal.countDocuments({ userId: user._id, createdAt: { $gte: monthStart } });
            if (monthCount >= settings.maxMonthlyWithdrawals) {
                return res.status(400).json({ success: false, message: `You Have Reached Your Monthly Withdrawal Limit (${settings.maxMonthlyWithdrawals}). Please Try Next Month.` });
            }
        }
        
        const transactionId = generateWithdrawTxnId();
        const oldBalance = user.balance;
        // Deduct only the withdrawal amount (not fee)
        user.balance = Math.round((user.balance - amount) * 100) / 100;
        await user.save();
        
        const withdrawal = new Withdrawal({
            userId: user._id,
            walletId: user.walletId,
            amount: amount,
            fee: feeAmount,
            feeType: settings.feeType,
            feeRate: settings.fee,
            userReceives: userReceives,
            method: 'bank',
            bankName: bankName,
            accountNumber: accountNumber,
            accountHolderName: accountHolderName,
            ifscCode: ifscCode.toUpperCase(),
            status: 'pending',
            transactionId: transactionId,
            userNote: note || 'Bank Withdrawal',
            apiKeyUsed: null
        });
        await withdrawal.save();
        
        const transaction = new Transaction({
            tx_id: transactionId,
            user_id: user._id,
            sender_id: user._id,
            receiver_id: user._id,
            amount: amount,
            type: 'withdraw',
            status: 'pending',
            remark: note || 'Bank Withdrawal',
            description: `Bank Withdrawal to ${bankName} - ${accountNumber} - Amount: ₹${amount.toFixed(2)} - Fee: ₹${feeAmount.toFixed(2)} - You Receive: ₹${userReceives.toFixed(2)}`,
            tx_time: new Date(),
            metadata: { 
                method: 'bank', 
                bankName: bankName, 
                accountNumber: accountNumber, 
                oldBalance: oldBalance, 
                newBalance: user.balance, 
                withdrawalId: withdrawal._id, 
                status: 'pending', 
                amount: amount, 
                fee: feeAmount, 
                feeType: settings.feeType, 
                feeRate: settings.fee,
                userReceives: userReceives
            }
        });
        await transaction.save();
        
        console.log('Bank Withdrawal Created:', transactionId);
        
        const feeText = feeAmount > 0 ? `\nFee (${settings.feeType}): ₹${feeAmount.toFixed(2)}` : '';
        const receiveText = feeAmount > 0 ? `\nYou Receive: ₹${userReceives.toFixed(2)}` : '';
        
        await notifyAdmin(
`New Bank Withdrawal Request

User Information
Name: ${user.fullName}
Mobile: ${user.mobile}
Wallet ID: ${user.walletId}

Transaction Details
Amount: ₹${amount.toFixed(2)}${feeText}${receiveText}

Method: Bank
Bank: ${bankName}
Holder: ${accountHolderName}
Account: ${accountNumber}
IFSC: ${ifscCode.toUpperCase()}
Transaction ID: ${transactionId}
Note: ${note || 'No Comment'}
Date: ${dateTime}

Status: Pending Approval
Admin Action Required`);
        
        if (user.telegramId) {
            const userFeeText = feeAmount > 0 ? `\nFee Charged: ₹${feeAmount.toFixed(2)}\nYou Receive: ₹${userReceives.toFixed(2)}` : '';
            await sendTelegramMessage(user.telegramId,
`Bank Withdrawal Submitted

Dear ${user.fullName},

Your bank withdrawal request has been submitted.

Amount: ₹${amount.toFixed(2)}
Bank: ${bankName}
Account: ${accountNumber}${userFeeText}
Transaction ID: ${transactionId}
New Balance: ₹${user.balance.toFixed(2)}
Date: ${dateTime}

Please wait for admin approval.`);
        }
        
        res.json({
            success: true,
            message: `Bank Withdrawal Request Submitted! ₹${amount.toFixed(2)} Has Been Deducted. You Will Receive ₹${userReceives.toFixed(2)} After Fee. Waiting For Admin Approval.`,
            transactionId: transactionId,
            amount: amount,
            fee: feeAmount,
            feeType: settings.feeType,
            feeRate: settings.fee,
            userReceives: userReceives,
            newBalance: user.balance,
            status: 'pending',
            method: 'bank'
        });
        
    } catch (error) {
        console.error('Bank Withdrawal Error:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Bank Withdrawal Failed. Please Try Again.' });
    }
});

// ============================================
// 3. GET WITHDRAWAL HISTORY
// ============================================
router.get('/history', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        const { limit = 50, page = 1 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const withdrawals = await Withdrawal.find({ userId: user._id }).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const total = await Withdrawal.countDocuments({ userId: user._id });
        res.json({ 
            success: true, 
            withdrawals: withdrawals, 
            pagination: { 
                total, 
                page: parseInt(page), 
                limit: parseInt(limit), 
                pages: Math.ceil(total / parseInt(limit)) 
            } 
        });
    } catch (error) {
        console.error('History Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Fetch History' });
    }
});

// ============================================
// 4. GET SINGLE WITHDRAWAL
// ============================================
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;
        const withdrawal = await Withdrawal.findOne({ _id: id, userId: user._id });
        if (!withdrawal) {
            return res.status(404).json({ success: false, message: 'Withdrawal Not Found' });
        }
        res.json({ success: true, withdrawal: withdrawal });
    } catch (error) {
        console.error('Details Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Fetch Details' });
    }
});

// ============================================
// 5. CHECK BALANCE
// ============================================
router.get('/balance', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        res.json({ success: true, balance: user.balance, name: user.fullName, walletId: user.walletId });
    } catch (error) {
        console.error('Balance Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Fetch Balance' });
    }
});

module.exports = router;
