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
            console.log('✅ Dᴇꜰᴀᴜʟᴛ Sᴇᴛᴛɪɴɢꜱ Cʀᴇᴀᴛᴇᴅ');
        }
        return settings;
    } catch (error) {
        console.error('❌ Gᴇᴛ Sᴇᴛᴛɪɴɢꜱ Eʀʀᴏʀ:', error.message);
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
    const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
    return now.toLocaleString('en-IN', options);
}

// ============================================
// HELPER: Send Message via Telegram
// ============================================
async function sendTelegramMessage(chatId, message) {
    if (!BOT_TOKEN) {
        console.log('⚠️ Bᴏᴛ Tᴏᴋᴇɴ Nᴏᴛ Cᴏɴꜰɪɢᴜʀᴇᴅ');
        return { success: false, error: 'BOT_TOKEN not configured' };
    }
    return new Promise((resolve) => {
        const https = require('https');
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const data = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' });
        const request = https.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(responseData);
                    result.ok ? console.log('✅ Tᴇʟᴇɢʀᴀᴍ Mᴇꜱꜱᴀɢᴇ Sᴇɴᴛ') : console.error('❌ Tᴇʟᴇɢʀᴀᴍ Eʀʀᴏʀ:', result.description);
                    resolve({ success: result.ok, error: result.description });
                } catch (e) {
                    console.error('❌ Pᴀʀꜱᴇ Eʀʀᴏʀ:', e.message);
                    resolve({ success: false, error: e.message });
                }
            });
        });
        request.on('error', (error) => { console.error('❌ Rᴇǫᴜᴇꜱᴛ Eʀʀᴏʀ:', error.message); resolve({ success: false, error: error.message }); });
        request.write(data);
        request.end();
    });
}

// ============================================
// HELPER: Send Notification to Admin
// ============================================
async function notifyAdmin(message) {
    if (!ADMIN_TG) { console.log('⚠️ Aᴅᴍɪɴ Tᴇʟᴇɢʀᴀᴍ Iᴅ Nᴏᴛ Cᴏɴꜰɪɢᴜʀᴇᴅ'); return; }
    try { await sendTelegramMessage(ADMIN_TG, message); console.log('✅ Aᴅᴍɪɴ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Sᴇɴᴛ'); } 
    catch (error) { console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Aᴅᴍɪɴ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ:', error.message); }
}

// ============================================
// HELPER: Check Withdrawal Settings
// ============================================
async function checkWithdrawSettings(amount) {
    const settings = await getWithdrawSettings();
    if (!settings.enabled) {
        return { allowed: false, message: 'Wɪᴛʜᴅʀᴀᴡᴀʟ Iꜱ Cᴜʀʀᴇɴᴛʟʏ Dɪꜱᴀʙʟᴇᴅ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ Lᴀᴛᴇʀ.' };
    }
    if (amount < settings.minAmount) {
        return { allowed: false, message: `Mɪɴɪᴍᴜᴍ Wɪᴛʜᴅʀᴀᴡᴀʟ Aᴍᴏᴜɴᴛ Iꜱ ₹${settings.minAmount}. Yᴏᴜʀ Aᴍᴏᴜɴᴛ: ₹${amount}` };
    }
    if (amount > settings.maxAmount) {
        return { allowed: false, message: `Mᴀxɪᴍᴜᴍ Wɪᴛʜᴅʀᴀᴡᴀʟ Aᴍᴏᴜɴᴛ Iꜱ ₹${settings.maxAmount}. Yᴏᴜʀ Aᴍᴏᴜɴᴛ: ₹${amount}` };
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
            return res.status(401).json({ success: false, message: 'Nᴏ Tᴏᴋᴇɴ Pʀᴏᴠɪᴅᴇᴅ' });
        }
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ' });
        }
        if (user.isBlocked) {
            return res.status(403).json({ success: false, message: 'Yᴏᴜʀ Aᴄᴄᴏᴜɴᴛ Iꜱ Bʟᴏᴄᴋᴇᴅ' });
        }
        req.user = user;
        next();
    } catch (error) {
        console.error('❌ Tᴏᴋᴇɴ Vᴇʀɪꜰɪᴄᴀᴛɪᴏɴ Eʀʀᴏʀ:', error.message);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ success: false, message: 'Iɴᴠᴀʟɪᴅ Tᴏᴋᴇɴ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ Aɢᴀɪɴ.' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Tᴏᴋᴇɴ Exᴘɪʀᴇᴅ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ Aɢᴀɪɴ.' });
        }
        return res.status(500).json({ success: false, message: 'Aᴜᴛʜᴇɴᴛɪᴄᴀᴛɪᴏɴ Eʀʀᴏʀ' });
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
        
        console.log('📤 UPI Wɪᴛʜᴅʀᴀᴡᴀʟ Rᴇǫᴜᴇꜱᴛ:', { Uꜱᴇʀ: user.mobile, Aᴍᴏᴜɴᴛ: amount, UPI: upiId });
        
        const settingsCheck = await checkWithdrawSettings(amount);
        if (!settingsCheck.allowed) {
            return res.status(400).json({ success: false, message: settingsCheck.message });
        }
        const settings = settingsCheck.settings;
        
        // ✅ Calculate Fee (Tax)
        const feeAmount = calculateWithdrawFee(amount, settings.fee, settings.feeType);
        // ✅ User will receive: amount - fee
        const userReceives = Math.round((amount - feeAmount) * 100) / 100;
        
        console.log('💰 Fᴇᴇ Cᴀʟᴄᴜʟᴀᴛɪᴏɴ:', { 
            WɪᴛʜᴅʀᴀᴡAᴍᴏᴜɴᴛ: amount, 
            FᴇᴇRᴀᴛᴇ: settings.fee, 
            FᴇᴇTʏᴘᴇ: settings.feeType, 
            FᴇᴇAᴍᴏᴜɴᴛ: feeAmount, 
            UꜱᴇʀRᴇᴄᴇɪᴠᴇꜱ: userReceives 
        });
        
        if (!upiId || !upiId.includes('@')) {
            return res.status(400).json({ success: false, message: 'Pʟᴇᴀꜱᴇ Eɴᴛᴇʀ A Vᴀʟɪᴅ UPI ID (ᴇ.ɢ. ɴᴀᴍᴇ@ᴜᴘɪ)' });
        }
        
        // ✅ Check Balance (only withdrawal amount, not including fee)
        if (user.balance < amount) {
            return res.status(400).json({ success: false, message: `Iɴꜱᴜꜰꜰɪᴄɪᴇɴᴛ Bᴀʟᴀɴᴄᴇ. Rᴇǫᴜɪʀᴇᴅ: ₹${amount.toFixed(2)}. Yᴏᴜʀ Bᴀʟᴀɴᴄᴇ: ₹${user.balance.toFixed(2)}` });
        }
        
        if (settings.maxDailyWithdrawals > 0) {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const todayCount = await Withdrawal.countDocuments({ userId: user._id, createdAt: { $gte: today } });
            if (todayCount >= settings.maxDailyWithdrawals) {
                return res.status(400).json({ success: false, message: `Yᴏᴜ Hᴀᴠᴇ Rᴇᴀᴄʜᴇᴅ Yᴏᴜʀ Dᴀɪʟʏ Wɪᴛʜᴅʀᴀᴡᴀʟ Lɪᴍɪᴛ (${settings.maxDailyWithdrawals}). Pʟᴇᴀꜱᴇ Tʀʏ Tᴏᴍᴏʀʀᴏᴡ.` });
            }
        }
        
        if (settings.maxMonthlyWithdrawals > 0) {
            const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
            const monthCount = await Withdrawal.countDocuments({ userId: user._id, createdAt: { $gte: monthStart } });
            if (monthCount >= settings.maxMonthlyWithdrawals) {
                return res.status(400).json({ success: false, message: `Yᴏᴜ Hᴀᴠᴇ Rᴇᴀᴄʜᴇᴅ Yᴏᴜʀ Mᴏɴᴛʜʟʏ Wɪᴛʜᴅʀᴀᴡᴀʟ Lɪᴍɪᴛ (${settings.maxMonthlyWithdrawals}). Pʟᴇᴀꜱᴇ Tʀʏ Nᴇxᴛ Mᴏɴᴛʜ.` });
            }
        }
        
        const transactionId = generateWithdrawTxnId();
        const oldBalance = user.balance;
        // ✅ Deduct only the withdrawal amount (not fee)
        user.balance = Math.round((user.balance - amount) * 100) / 100;
        await user.save();
        
        const withdrawal = new Withdrawal({
            userId: user._id,
            walletId: user.walletId,
            amount: amount, // Withdrawal amount
            fee: feeAmount, // Fee charged
            feeType: settings.feeType,
            feeRate: settings.fee,
            userReceives: userReceives, // Amount user will receive after fee
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
        
        console.log('✅ UPI Wɪᴛʜᴅʀᴀᴡᴀʟ Cʀᴇᴀᴛᴇᴅ:', transactionId);
        
        const feeText = feeAmount > 0 ? `\n💸 Fᴇᴇ (${settings.feeType}): ₹${feeAmount.toFixed(2)}` : '';
        const receiveText = feeAmount > 0 ? `\n💵 Yᴏᴜ Rᴇᴄᴇɪᴠᴇ: ₹${userReceives.toFixed(2)}` : '';
        
        await notifyAdmin(
`<b>─────────────────</b>
<b>📩 Nᴇᴡ UPI Wɪᴛʜᴅʀᴀᴡᴀʟ Rᴇǫᴜᴇꜱᴛ</b>
<b>─────────────────</b>

<b>👤 Uꜱᴇʀ Iɴꜰᴏʀᴍᴀᴛɪᴏɴ</b>
👤 Nᴀᴍᴇ: ${user.fullName}
📱 Mᴏʙɪʟᴇ: ${user.mobile}
🆔 Wᴀʟʟᴇᴛ Iᴅ: ${user.walletId}

<b>💰 Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Dᴇᴛᴀɪʟꜱ</b>
💵 Aᴍᴏᴜɴᴛ: <b>₹${amount.toFixed(2)}</b>${feeText}${receiveText}

📱 Mᴇᴛʜᴏᴅ: UPI
🆔 UPI Iᴅ: ${upiId}
🆔 Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ: ${transactionId}
📝 Nᴏᴛᴇ: ${note || 'Nᴏ Cᴏᴍᴍᴇɴᴛ'}
📅 <code>${dateTime}</code>

───────────────────────
📊 Sᴛᴀᴛᴜꜱ: ⏳ Pᴇɴᴅɪɴɢ Aᴘᴘʀᴏᴠᴀʟ
⚠️ Aᴅᴍɪɴ Aᴄᴛɪᴏɴ Rᴇǫᴜɪʀᴇᴅ
───────────────────────`);
        
        if (user.telegramId) {
            const userFeeText = feeAmount > 0 ? `\n💸 <b>Fᴇᴇ Cʜᴀʀɢᴇᴅ:</b> ₹${feeAmount.toFixed(2)}\n💵 <b>Yᴏᴜ Rᴇᴄᴇɪᴠᴇ:</b> ₹${userReceives.toFixed(2)}` : '';
            await sendTelegramMessage(user.telegramId,
`<b>─────────────────</b>
<b>⏳ UPI Wɪᴛʜᴅʀᴀᴡᴀʟ Sᴜʙᴍɪᴛᴛᴇᴅ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜʀ UPI Wɪᴛʜᴅʀᴀᴡᴀʟ Rᴇǫᴜᴇꜱᴛ Hᴀꜱ Bᴇᴇɴ Sᴜʙᴍɪᴛᴛᴇᴅ.

💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${amount.toFixed(2)}
📱 <b>UPI Iᴅ:</b> ${upiId}${userFeeText}
🆔 <b>Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ:</b> ${transactionId}
💳 <b>Nᴇᴡ Bᴀʟᴀɴᴄᴇ:</b> ₹${user.balance.toFixed(2)}
📅 <code>${dateTime}</code>

───────────────────────
⏳ Pʟᴇᴀꜱᴇ Wᴀɪᴛ Fᴏʀ Aᴅᴍɪɴ Aᴘᴘʀᴏᴠᴀʟ.
───────────────────────`);
        }
        
        res.json({
            success: true,
            message: `✅ UPI Wɪᴛʜᴅʀᴀᴡᴀʟ Rᴇǫᴜᴇꜱᴛ Sᴜʙᴍɪᴛᴛᴇᴅ! ₹${amount.toFixed(2)} Hᴀꜱ Bᴇᴇɴ Dᴇᴅᴜᴄᴛᴇᴅ. Yᴏᴜ Wɪʟʟ Rᴇᴄᴇɪᴠᴇ ₹${userReceives.toFixed(2)} Aꜰᴛᴇʀ Fᴇᴇ. Wᴀɪᴛɪɴɢ Fᴏʀ Aᴅᴍɪɴ Aᴘᴘʀᴏᴠᴀʟ.`,
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
        console.error('❌ UPI Wɪᴛʜᴅʀᴀᴡᴀʟ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ success: false, message: error.message || 'UPI Wɪᴛʜᴅʀᴀᴡᴀʟ Fᴀɪʟᴇᴅ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.' });
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
        
        console.log('📤 Bᴀɴᴋ Wɪᴛʜᴅʀᴀᴡᴀʟ Rᴇǫᴜᴇꜱᴛ:', { Uꜱᴇʀ: user.mobile, Aᴍᴏᴜɴᴛ: amount, Bᴀɴᴋ: bankName });
        
        const settingsCheck = await checkWithdrawSettings(amount);
        if (!settingsCheck.allowed) {
            return res.status(400).json({ success: false, message: settingsCheck.message });
        }
        const settings = settingsCheck.settings;
        
        // ✅ Calculate Fee (Tax)
        const feeAmount = calculateWithdrawFee(amount, settings.fee, settings.feeType);
        // ✅ User will receive: amount - fee
        const userReceives = Math.round((amount - feeAmount) * 100) / 100;
        
        console.log('💰 Fᴇᴇ Cᴀʟᴄᴜʟᴀᴛɪᴏɴ:', { 
            WɪᴛʜᴅʀᴀᴡAᴍᴏᴜɴᴛ: amount, 
            FᴇᴇRᴀᴛᴇ: settings.fee, 
            FᴇᴇTʏᴘᴇ: settings.feeType, 
            FᴇᴇAᴍᴏᴜɴᴛ: feeAmount, 
            UꜱᴇʀRᴇᴄᴇɪᴠᴇꜱ: userReceives 
        });
        
        if (!bankName || !accountNumber || !accountHolderName || !ifscCode) {
            return res.status(400).json({ success: false, message: 'Pʟᴇᴀꜱᴇ Fɪʟʟ Aʟʟ Bᴀɴᴋ Dᴇᴛᴀɪʟꜱ' });
        }
        
        // ✅ Check Balance (only withdrawal amount, not including fee)
        if (user.balance < amount) {
            return res.status(400).json({ success: false, message: `Iɴꜱᴜꜰꜰɪᴄɪᴇɴᴛ Bᴀʟᴀɴᴄᴇ. Rᴇǫᴜɪʀᴇᴅ: ₹${amount.toFixed(2)}. Yᴏᴜʀ Bᴀʟᴀɴᴄᴇ: ₹${user.balance.toFixed(2)}` });
        }
        
        if (settings.maxDailyWithdrawals > 0) {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const todayCount = await Withdrawal.countDocuments({ userId: user._id, createdAt: { $gte: today } });
            if (todayCount >= settings.maxDailyWithdrawals) {
                return res.status(400).json({ success: false, message: `Yᴏᴜ Hᴀᴠᴇ Rᴇᴀᴄʜᴇᴅ Yᴏᴜʀ Dᴀɪʟʏ Wɪᴛʜᴅʀᴀᴡᴀʟ Lɪᴍɪᴛ (${settings.maxDailyWithdrawals}). Pʟᴇᴀꜱᴇ Tʀʏ Tᴏᴍᴏʀʀᴏᴡ.` });
            }
        }
        
        if (settings.maxMonthlyWithdrawals > 0) {
            const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
            const monthCount = await Withdrawal.countDocuments({ userId: user._id, createdAt: { $gte: monthStart } });
            if (monthCount >= settings.maxMonthlyWithdrawals) {
                return res.status(400).json({ success: false, message: `Yᴏᴜ Hᴀᴠᴇ Rᴇᴀᴄʜᴇᴅ Yᴏᴜʀ Mᴏɴᴛʜʟʏ Wɪᴛʜᴅʀᴀᴡᴀʟ Lɪᴍɪᴛ (${settings.maxMonthlyWithdrawals}). Pʟᴇᴀꜱᴇ Tʀʏ Nᴇxᴛ Mᴏɴᴛʜ.` });
            }
        }
        
        const transactionId = generateWithdrawTxnId();
        const oldBalance = user.balance;
        // ✅ Deduct only the withdrawal amount (not fee)
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
        
        console.log('✅ Bᴀɴᴋ Wɪᴛʜᴅʀᴀᴡᴀʟ Cʀᴇᴀᴛᴇᴅ:', transactionId);
        
        const feeText = feeAmount > 0 ? `\n💸 Fᴇᴇ (${settings.feeType}): ₹${feeAmount.toFixed(2)}` : '';
        const receiveText = feeAmount > 0 ? `\n💵 Yᴏᴜ Rᴇᴄᴇɪᴠᴇ: ₹${userReceives.toFixed(2)}` : '';
        
        await notifyAdmin(
`<b>─────────────────</b>
<b>📩 Nᴇᴡ Bᴀɴᴋ Wɪᴛʜᴅʀᴀᴡᴀʟ Rᴇǫᴜᴇꜱᴛ</b>
<b>─────────────────</b>

<b>👤 Uꜱᴇʀ Iɴꜰᴏʀᴍᴀᴛɪᴏɴ</b>
👤 Nᴀᴍᴇ: ${user.fullName}
📱 Mᴏʙɪʟᴇ: ${user.mobile}
🆔 Wᴀʟʟᴇᴛ Iᴅ: ${user.walletId}

<b>💰 Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Dᴇᴛᴀɪʟꜱ</b>
💵 Aᴍᴏᴜɴᴛ: <b>₹${amount.toFixed(2)}</b>${feeText}${receiveText}

🏦 Mᴇᴛʜᴏᴅ: Bᴀɴᴋ
🏛️ Bᴀɴᴋ: ${bankName}
👤 Hᴏʟᴅᴇʀ: ${accountHolderName}
🔢 Aᴄᴄᴏᴜɴᴛ: ${accountNumber}
🔑 IFSC: ${ifscCode.toUpperCase()}
🆔 Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ: ${transactionId}
📝 Nᴏᴛᴇ: ${note || 'Nᴏ Cᴏᴍᴍᴇɴᴛ'}
📅 <code>${dateTime}</code>

───────────────────────
📊 Sᴛᴀᴛᴜꜱ: ⏳ Pᴇɴᴅɪɴɢ Aᴘᴘʀᴏᴠᴀʟ
⚠️ Aᴅᴍɪɴ Aᴄᴛɪᴏɴ Rᴇǫᴜɪʀᴇᴅ
───────────────────────`);
        
        if (user.telegramId) {
            const userFeeText = feeAmount > 0 ? `\n💸 <b>Fᴇᴇ Cʜᴀʀɢᴇᴅ:</b> ₹${feeAmount.toFixed(2)}\n💵 <b>Yᴏᴜ Rᴇᴄᴇɪᴠᴇ:</b> ₹${userReceives.toFixed(2)}` : '';
            await sendTelegramMessage(user.telegramId,
`<b>─────────────────</b>
<b>⏳ Bᴀɴᴋ Wɪᴛʜᴅʀᴀᴡᴀʟ Sᴜʙᴍɪᴛᴛᴇᴅ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜʀ Bᴀɴᴋ Wɪᴛʜᴅʀᴀᴡᴀʟ Rᴇǫᴜᴇꜱᴛ Hᴀꜱ Bᴇᴇɴ Sᴜʙᴍɪᴛᴛᴇᴅ.

💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${amount.toFixed(2)}
🏦 <b>Bᴀɴᴋ:</b> ${bankName}
🔢 <b>Aᴄᴄᴏᴜɴᴛ:</b> ${accountNumber}${userFeeText}
🆔 <b>Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ:</b> ${transactionId}
💳 <b>Nᴇᴡ Bᴀʟᴀɴᴄᴇ:</b> ₹${user.balance.toFixed(2)}
📅 <code>${dateTime}</code>

───────────────────────
⏳ Pʟᴇᴀꜱᴇ Wᴀɪᴛ Fᴏʀ Aᴅᴍɪɴ Aᴘᴘʀᴏᴠᴀʟ.
───────────────────────`);
        }
        
        res.json({
            success: true,
            message: `✅ Bᴀɴᴋ Wɪᴛʜᴅʀᴀᴡᴀʟ Rᴇǫᴜᴇꜱᴛ Sᴜʙᴍɪᴛᴛᴇᴅ! ₹${amount.toFixed(2)} Hᴀꜱ Bᴇᴇɴ Dᴇᴅᴜᴄᴛᴇᴅ. Yᴏᴜ Wɪʟʟ Rᴇᴄᴇɪᴠᴇ ₹${userReceives.toFixed(2)} Aꜰᴛᴇʀ Fᴇᴇ. Wᴀɪᴛɪɴɢ Fᴏʀ Aᴅᴍɪɴ Aᴘᴘʀᴏᴠᴀʟ.`,
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
        console.error('❌ Bᴀɴᴋ Wɪᴛʜᴅʀᴀᴡᴀʟ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ success: false, message: error.message || 'Bᴀɴᴋ Wɪᴛʜᴅʀᴀᴡᴀʟ Fᴀɪʟᴇᴅ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.' });
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
        res.json({ success: true, withdrawals: withdrawals, pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) } });
    } catch (error) {
        console.error('❌ Hɪꜱᴛᴏʀʏ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Hɪꜱᴛᴏʀʏ' });
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
            return res.status(404).json({ success: false, message: 'Wɪᴛʜᴅʀᴀᴡᴀʟ Nᴏᴛ Fᴏᴜɴᴅ' });
        }
        res.json({ success: true, withdrawal: withdrawal });
    } catch (error) {
        console.error('❌ Dᴇᴛᴀɪʟꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Dᴇᴛᴀɪʟꜱ' });
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
        console.error('❌ Bᴀʟᴀɴᴄᴇ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Bᴀʟᴀɴᴄᴇ' });
    }
});

module.exports = router;
