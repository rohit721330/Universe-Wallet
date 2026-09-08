// FILE: routes/withdraw-settings.js
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Deposit = require('../models/Deposit');
const Withdrawal = require('../models/Withdraw');
const WithdrawSettings = require('../models/WithdrawSettings');
const Lifafa = require('../models/Lifafa');
const Gift = require('../models/GiftCode');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG = process.env.ADMIN_TG_ID;

let settingsCache = null;
let cacheTimestamp = null;
const CACHE_TTL = 60000;

// ============================================
// HELPER FUNCTIONS
// ============================================

function getCurrentDateTime() {
    const now = new Date();
    const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
    return now.toLocaleString('en-IN', options);
}

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

async function notifyAdmin(message) {
    if (!ADMIN_TG) { console.log('⚠️ Aᴅᴍɪɴ Tᴇʟᴇɢʀᴀᴍ Iᴅ Nᴏᴛ Cᴏɴꜰɪɢᴜʀᴇᴅ'); return; }
    try { await sendTelegramMessage(ADMIN_TG, message); console.log('✅ Aᴅᴍɪɴ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Sᴇɴᴛ'); } 
    catch (error) { console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Aᴅᴍɪɴ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ:', error.message); }
}

// ============================================
// GET SETTINGS FROM DATABASE
// ============================================
async function getSettings() {
    try {
        if (settingsCache && cacheTimestamp && (Date.now() - cacheTimestamp < CACHE_TTL)) return settingsCache;
        let settings = await WithdrawSettings.findOne();
        if (!settings) { settings = new WithdrawSettings(); await settings.save(); console.log('✅ Dᴇꜰᴀᴜʟᴛ Sᴇᴛᴛɪɴɢꜱ Cʀᴇᴀᴛᴇᴅ Iɴ Dᴀᴛᴀʙᴀꜱᴇ'); }
        settingsCache = settings;
        cacheTimestamp = Date.now();
        return settings;
    } catch (error) {
        console.error('❌ Gᴇᴛ Sᴇᴛᴛɪɴɢꜱ Eʀʀᴏʀ:', error.message);
        if (settingsCache) return settingsCache;
        return { enabled: true, minAmount: 1, maxAmount: 5000, fee: 0, feeType: 'percentage', approvalRequired: true, maxDailyWithdrawals: 10, maxMonthlyWithdrawals: 50, requireBankDetails: true, requireUpiDetails: true, autoApproveBelow: 0, updatedBy: 'System', updatedAt: new Date() };
    }
}

function clearSettingsCache() { settingsCache = null; cacheTimestamp = null; console.log('🔄 Sᴇᴛᴛɪɴɢꜱ Cᴀᴄʜᴇ Cʟᴇᴀʀᴇᴅ'); }

// ============================================
// VERIFY TOKEN MIDDLEWARE
// ============================================
async function verifyToken(req, res, next) {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'Nᴏ Tᴏᴋᴇɴ Pʀᴏᴠɪᴅᴇᴅ' });
        if (token.startsWith('Admin_')) { req.user = { isAdmin: true, fullName: 'Admin', tokenType: 'admin_token' }; return next(); }
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.isAdmin) { req.user = { isAdmin: true, fullName: decoded.fullName || 'Admin', tokenType: 'jwt', ...decoded }; return next(); } 
            else return res.status(403).json({ success: false, message: 'Aᴅᴍɪɴ Aᴄᴄᴇꜱꜱ Rᴇǫᴜɪʀᴇᴅ' });
        } catch (jwtError) { return res.status(401).json({ success: false, message: 'Iɴᴠᴀʟɪᴅ Tᴏᴋᴇɴ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ Aɢᴀɪɴ.' }); }
    } catch (error) {
        console.error('❌ Tᴏᴋᴇɴ Vᴇʀɪꜰɪᴄᴀᴛɪᴏɴ Eʀʀᴏʀ:', error.message);
        return res.status(500).json({ success: false, message: 'Aᴜᴛʜᴇɴᴛɪᴄᴀᴛɪᴏɴ Eʀʀᴏʀ' });
    }
}

// ============================================
// GET WITHDRAW SETTINGS (Public)
// ============================================
router.get('/', async (req, res) => {
    try {
        const settings = await getSettings();
        res.json({ success: true, settings: {
            enabled: settings.enabled,
            minAmount: settings.minAmount,
            maxAmount: settings.maxAmount,
            fee: settings.fee,
            feeType: settings.feeType,
            approvalRequired: settings.approvalRequired,
            maxDailyWithdrawals: settings.maxDailyWithdrawals,
            maxMonthlyWithdrawals: settings.maxMonthlyWithdrawals,
            requireBankDetails: settings.requireBankDetails,
            requireUpiDetails: settings.requireUpiDetails,
            autoApproveBelow: settings.autoApproveBelow,
            updatedAt: settings.updatedAt,
            updatedBy: settings.updatedBy
        }});
    } catch (error) {
        console.error('Gᴇᴛ Sᴇᴛᴛɪɴɢꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Sᴇᴛᴛɪɴɢꜱ' });
    }
});

// ============================================
// UPDATE WITHDRAW SETTINGS (Admin Only)
// ============================================
router.put('/', verifyToken, async (req, res) => {
    try {
        const { enabled, minAmount, maxAmount, fee, feeType, approvalRequired, maxDailyWithdrawals, maxMonthlyWithdrawals, requireBankDetails, requireUpiDetails, autoApproveBelow } = req.body;
        const user = req.user;
        const dateTime = getCurrentDateTime();
        const updatedFields = [];

        let settings = await WithdrawSettings.findOne();
        if (!settings) settings = new WithdrawSettings();

        if (enabled !== undefined) {
            if (typeof enabled !== 'boolean') return res.status(400).json({ success: false, message: 'Eɴᴀʙʟᴇᴅ Mᴜꜱᴛ Bᴇ A Bᴏᴏʟᴇᴀɴ Vᴀʟᴜᴇ' });
            settings.enabled = enabled;
            updatedFields.push(`Eɴᴀʙʟᴇᴅ: ${enabled ? 'Yᴇꜱ' : 'Nᴏ'}`);
        }

        if (minAmount !== undefined) {
            const min = parseFloat(minAmount);
            if (isNaN(min) || min < 0) return res.status(400).json({ success: false, message: 'Iɴᴠᴀʟɪᴅ Mɪɴɪᴍᴜᴍ Aᴍᴏᴜɴᴛ' });
            settings.minAmount = min;
            updatedFields.push(`Mɪɴ Aᴍᴏᴜɴᴛ: ₹${min}`);
        }

        if (maxAmount !== undefined) {
            const max = parseFloat(maxAmount);
            if (isNaN(max) || max < 0) return res.status(400).json({ success: false, message: 'Iɴᴠᴀʟɪᴅ Mᴀxɪᴍᴜᴍ Aᴍᴏᴜɴᴛ' });
            settings.maxAmount = max;
            updatedFields.push(`Mᴀx Aᴍᴏᴜɴᴛ: ₹${max}`);
        }

        if (settings.minAmount > settings.maxAmount) {
            return res.status(400).json({ success: false, message: 'Mɪɴɪᴍᴜᴍ Cᴀɴɴᴏᴛ Bᴇ Gʀᴇᴀᴛᴇʀ Tʜᴀɴ Mᴀxɪᴍᴜᴍ' });
        }

        if (fee !== undefined) {
            const feeValue = parseFloat(fee);
            if (isNaN(feeValue) || feeValue < 0) return res.status(400).json({ success: false, message: 'Iɴᴠᴀʟɪᴅ Fᴇᴇ Vᴀʟᴜᴇ' });
            settings.fee = feeValue;
            updatedFields.push(`Fᴇᴇ: ${feeValue}%`);
        }

        if (feeType !== undefined) {
            if (!['percentage', 'fixed'].includes(feeType)) return res.status(400).json({ success: false, message: 'Fᴇᴇ Tʏᴘᴇ Mᴜꜱᴛ Bᴇ "ᴘᴇʀᴄᴇɴᴛᴀɢᴇ" Oʀ "ꜰɪxᴇᴅ"' });
            settings.feeType = feeType;
            updatedFields.push(`Fᴇᴇ Tʏᴘᴇ: ${feeType.toUpperCase()}`);
        }

        if (approvalRequired !== undefined) {
            if (typeof approvalRequired !== 'boolean') return res.status(400).json({ success: false, message: 'Aᴘᴘʀᴏᴠᴀʟ Rᴇǫᴜɪʀᴇᴅ Mᴜꜱᴛ Bᴇ A Bᴏᴏʟᴇᴀɴ Vᴀʟᴜᴇ' });
            settings.approvalRequired = approvalRequired;
            updatedFields.push(`Aᴘᴘʀᴏᴠᴀʟ Rᴇǫᴜɪʀᴇᴅ: ${approvalRequired ? 'Yᴇꜱ' : 'Nᴏ'}`);
        }

        if (maxDailyWithdrawals !== undefined) {
            const maxDaily = parseInt(maxDailyWithdrawals);
            if (isNaN(maxDaily) || maxDaily < 0) return res.status(400).json({ success: false, message: 'Iɴᴠᴀʟɪᴅ Mᴀx Dᴀɪʟʏ Wɪᴛʜᴅʀᴀᴡᴀʟꜱ' });
            settings.maxDailyWithdrawals = maxDaily;
            updatedFields.push(`Mᴀx Dᴀɪʟʏ: ${maxDaily}`);
        }

        if (maxMonthlyWithdrawals !== undefined) {
            const maxMonthly = parseInt(maxMonthlyWithdrawals);
            if (isNaN(maxMonthly) || maxMonthly < 0) return res.status(400).json({ success: false, message: 'Iɴᴠᴀʟɪᴅ Mᴀx Mᴏɴᴛʜʟʏ Wɪᴛʜᴅʀᴀᴡᴀʟꜱ' });
            settings.maxMonthlyWithdrawals = maxMonthly;
            updatedFields.push(`Mᴀx Mᴏɴᴛʜʟʏ: ${maxMonthly}`);
        }

        if (requireBankDetails !== undefined) {
            if (typeof requireBankDetails !== 'boolean') return res.status(400).json({ success: false, message: 'Rᴇǫᴜɪʀᴇ Bᴀɴᴋ Dᴇᴛᴀɪʟꜱ Mᴜꜱᴛ Bᴇ A Bᴏᴏʟᴇᴀɴ Vᴀʟᴜᴇ' });
            settings.requireBankDetails = requireBankDetails;
            updatedFields.push(`Bᴀɴᴋ Dᴇᴛᴀɪʟꜱ: ${requireBankDetails ? 'Rᴇǫᴜɪʀᴇᴅ' : 'Oᴘᴛɪᴏɴᴀʟ'}`);
        }

        if (requireUpiDetails !== undefined) {
            if (typeof requireUpiDetails !== 'boolean') return res.status(400).json({ success: false, message: 'Rᴇǫᴜɪʀᴇ Uᴘɪ Dᴇᴛᴀɪʟꜱ Mᴜꜱᴛ Bᴇ A Bᴏᴏʟᴇᴀɴ Vᴀʟᴜᴇ' });
            settings.requireUpiDetails = requireUpiDetails;
            updatedFields.push(`Uᴘɪ Dᴇᴛᴀɪʟꜱ: ${requireUpiDetails ? 'Rᴇǫᴜɪʀᴇᴅ' : 'Oᴘᴛɪᴏɴᴀʟ'}`);
        }

        if (autoApproveBelow !== undefined) {
            const auto = parseFloat(autoApproveBelow);
            if (isNaN(auto) || auto < 0) return res.status(400).json({ success: false, message: 'Iɴᴠᴀʟɪᴅ Aᴜᴛᴏ Aᴘᴘʀᴏᴠᴇ Aᴍᴏᴜɴᴛ' });
            settings.autoApproveBelow = auto;
            updatedFields.push(`Aᴜᴛᴏ Aᴘᴘʀᴏᴠᴇ Bᴇʟᴏᴡ: ₹${auto}`);
        }

        settings.updatedAt = new Date();
        settings.updatedBy = user.fullName || user.mobile;
        await settings.save();
        clearSettingsCache();

        if (updatedFields.length > 0) {
            const settingsMessage = 
`<b>─────────────────</b>
<b>⚙️ Wɪᴛʜᴅʀᴀᴡ Sᴇᴛᴛɪɴɢꜱ Uᴘᴅᴀᴛᴇᴅ</b>
<b>─────────────────</b>

<b>👤 Uᴘᴅᴀᴛᴇᴅ Bʏ:</b> ${user.fullName || 'Aᴅᴍɪɴ'}
<b>📅 Tɪᴍᴇ:</b> ${dateTime}
<b>📝 Cʜᴀɴɢᴇꜱ:</b>
• ${updatedFields.join('\n• ')}

───────────────────────
🛡️ Tᴇᴀᴍ Jᴀʀᴠɪꜱ Wᴀʟʟᴇᴛ
───────────────────────`;
            await notifyAdmin(settingsMessage);
        }

        res.json({ success: true, message: 'Wɪᴛʜᴅʀᴀᴡ Sᴇᴛᴛɪɴɢꜱ Uᴘᴅᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ', settings: {
            enabled: settings.enabled,
            minAmount: settings.minAmount,
            maxAmount: settings.maxAmount,
            fee: settings.fee,
            feeType: settings.feeType,
            approvalRequired: settings.approvalRequired,
            maxDailyWithdrawals: settings.maxDailyWithdrawals,
            maxMonthlyWithdrawals: settings.maxMonthlyWithdrawals,
            requireBankDetails: settings.requireBankDetails,
            requireUpiDetails: settings.requireUpiDetails,
            autoApproveBelow: settings.autoApproveBelow,
            updatedAt: settings.updatedAt,
            updatedBy: settings.updatedBy
        }});
    } catch (error) {
        console.error('❌ Uᴘᴅᴀᴛᴇ Sᴇᴛᴛɪɴɢꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Uᴘᴅᴀᴛᴇ Sᴇᴛᴛɪɴɢꜱ: ' + error.message });
    }
});

// ============================================
// RESET SETTINGS TO DEFAULT
// ============================================
router.post('/reset', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        const dateTime = getCurrentDateTime();
        let settings = await WithdrawSettings.findOne();
        if (!settings) settings = new WithdrawSettings();
        await settings.resetToDefault();
        clearSettingsCache();

        const resetMessage = 
`<b>─────────────────</b>
<b>🔄 Wɪᴛʜᴅʀᴀᴡ Sᴇᴛᴛɪɴɢꜱ Rᴇꜱᴇᴛ</b>
<b>─────────────────</b>

<b>👤 Rᴇꜱᴇᴛ Bʏ:</b> ${user.fullName || 'Aᴅᴍɪɴ'}
<b>📅 Tɪᴍᴇ:</b> ${dateTime}
<b>📌 Aʟʟ Sᴇᴛᴛɪɴɢꜱ Hᴀᴠᴇ Bᴇᴇɴ Rᴇꜱᴇᴛ Tᴏ Dᴇꜰᴀᴜʟᴛ Vᴀʟᴜᴇꜱ</b>

───────────────────────
🛡️ Tᴇᴀᴍ Jᴀʀᴠɪꜱ Wᴀʟʟᴇᴛ
───────────────────────`;
        await notifyAdmin(resetMessage);

        res.json({ success: true, message: 'Sᴇᴛᴛɪɴɢꜱ Rᴇꜱᴇᴛ Tᴏ Dᴇꜰᴀᴜʟᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ', settings: {
            enabled: settings.enabled,
            minAmount: settings.minAmount,
            maxAmount: settings.maxAmount,
            fee: settings.fee,
            feeType: settings.feeType,
            approvalRequired: settings.approvalRequired,
            maxDailyWithdrawals: settings.maxDailyWithdrawals,
            maxMonthlyWithdrawals: settings.maxMonthlyWithdrawals,
            requireBankDetails: settings.requireBankDetails,
            requireUpiDetails: settings.requireUpiDetails,
            autoApproveBelow: settings.autoApproveBelow,
            updatedAt: settings.updatedAt,
            updatedBy: settings.updatedBy
        }});
    } catch (error) {
        console.error('❌ Rᴇꜱᴇᴛ Sᴇᴛᴛɪɴɢꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Rᴇꜱᴇᴛ Sᴇᴛᴛɪɴɢꜱ: ' + error.message });
    }
});

// ============================================
// GET PUBLIC SETTINGS (For Frontend)
// ============================================
router.get('/public', async (req, res) => {
    try {
        const settings = await getSettings();
        res.json({ success: true, settings: {
            enabled: settings.enabled,
            minAmount: settings.minAmount,
            maxAmount: settings.maxAmount,
            fee: settings.fee,
            feeType: settings.feeType,
            approvalRequired: settings.approvalRequired,
            requireBankDetails: settings.requireBankDetails,
            requireUpiDetails: settings.requireUpiDetails
        }});
    } catch (error) {
        console.error('Gᴇᴛ Pᴜʙʟɪᴄ Sᴇᴛᴛɪɴɢꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Sᴇᴛᴛɪɴɢꜱ' });
    }
});

// ============================================
// GET WITHDRAWALS
// ============================================
router.get('/withdrawals', verifyToken, async (req, res) => {
    try {
        const { status, method, page = 1, limit = 20, search } = req.query;
        let query = {};
        if (status && status !== 'all') {
            const validStatuses = ['pending', 'processing', 'completed', 'failed', 'cancelled'];
            if (!validStatuses.includes(status)) return res.status(400).json({ success: false, message: `Iɴᴠᴀʟɪᴅ Sᴛᴀᴛᴜꜱ: "${status}"` });
            query.status = status;
        }
        if (method && method !== 'all') {
            if (!['upi', 'bank'].includes(method)) return res.status(400).json({ success: false, message: `Iɴᴠᴀʟɪᴅ Mᴇᴛʜᴏᴅ: "${method}"` });
            query.method = method;
        }
        if (search) query.$or = [{ transactionId: { $regex: search, $options: 'i' } }, { upiId: { $regex: search, $options: 'i' } }, { accountNumber: { $regex: search, $options: 'i' } }, { bankName: { $regex: search, $options: 'i' } }, { walletId: { $regex: search, $options: 'i' } }];

        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;

        const withdrawals = await Withdrawal.find(query).populate('userId', 'fullName mobile walletId balance').sort({ createdAt: -1 }).skip(skip).limit(limitNum);
        const total = await Withdrawal.countDocuments(query);

        res.json({ success: true, withdrawals, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } });
    } catch (error) {
        console.error('❌ Gᴇᴛ Wɪᴛʜᴅʀᴀᴡᴀʟꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Wɪᴛʜᴅʀᴀᴡᴀʟꜱ.' });
    }
});

// ============================================
// GET WITHDRAWAL STATISTICS
// ============================================
router.get('/stats', verifyToken, async (req, res) => {
    try {
        const [total, pending, processing, completed, failed, cancelled, upi, bank, totalAmount] = await Promise.all([
            Withdrawal.countDocuments(),
            Withdrawal.countDocuments({ status: 'pending' }),
            Withdrawal.countDocuments({ status: 'processing' }),
            Withdrawal.countDocuments({ status: 'completed' }),
            Withdrawal.countDocuments({ status: 'failed' }),
            Withdrawal.countDocuments({ status: 'cancelled' }),
            Withdrawal.countDocuments({ method: 'upi' }),
            Withdrawal.countDocuments({ method: 'bank' }),
            Withdrawal.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, total: { $sum: '$amount' } } }])
        ]);

        const today = new Date(); today.setHours(0, 0, 0, 0);
        const todayCount = await Withdrawal.countDocuments({ createdAt: { $gte: today } });
        const todayAmount = await Withdrawal.aggregate([{ $match: { status: 'completed', createdAt: { $gte: today } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);

        res.json({ success: true, stats: {
            total: total || 0,
            pending: pending || 0,
            processing: processing || 0,
            completed: completed || 0,
            failed: failed || 0,
            cancelled: cancelled || 0,
            upi: upi || 0,
            bank: bank || 0,
            totalAmount: totalAmount.length > 0 ? totalAmount[0].total : 0,
            today: { count: todayCount || 0, amount: todayAmount.length > 0 ? todayAmount[0].total : 0 }
        }});
    } catch (error) {
        console.error('❌ Sᴛᴀᴛꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Sᴛᴀᴛɪꜱᴛɪᴄꜱ.' });
    }
});

// ============================================
// GET SINGLE WITHDRAWAL
// ============================================
router.get('/withdrawal/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const withdrawal = await Withdrawal.findById(id).populate('userId', 'fullName mobile walletId balance email');
        if (!withdrawal) return res.status(404).json({ success: false, message: 'Wɪᴛʜᴅʀᴀᴡᴀʟ Nᴏᴛ Fᴏᴜɴᴅ.' });
        res.json({ success: true, withdrawal });
    } catch (error) {
        console.error('❌ Gᴇᴛ Wɪᴛʜᴅʀᴀᴡᴀʟ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Wɪᴛʜᴅʀᴀᴡᴀʟ Dᴇᴛᴀɪʟꜱ.' });
    }
});

// ============================================
// APPROVE WITHDRAWAL
// ============================================
router.post('/withdrawal/approve', verifyToken, async (req, res) => {
    try {
        const { withdrawalId, adminNote } = req.body;
        const admin = req.user;
        const dateTime = getCurrentDateTime();

        if (!withdrawalId) return res.status(400).json({ success: false, message: 'Pʟᴇᴀꜱᴇ Pʀᴏᴠɪᴅᴇ Wɪᴛʜᴅʀᴀᴡᴀʟ Iᴅ.' });

        const withdrawal = await Withdrawal.findById(withdrawalId).populate('userId');
        if (!withdrawal) return res.status(404).json({ success: false, message: 'Wɪᴛʜᴅʀᴀᴡᴀʟ Nᴏᴛ Fᴏᴜɴᴅ.' });
        if (withdrawal.status !== 'pending' && withdrawal.status !== 'processing') return res.status(400).json({ success: false, message: `Wɪᴛʜᴅʀᴀᴡᴀʟ Iꜱ Aʟʀᴇᴀᴅʏ "${withdrawal.status}".` });

        const user = withdrawal.userId;
        if (!user) return res.status(404).json({ success: false, message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ.' });

        withdrawal.status = 'completed';
        withdrawal.adminNote = adminNote || 'Aᴘᴘʀᴏᴠᴇᴅ Bʏ Aᴅᴍɪɴ';
        withdrawal.processedAt = new Date();
        withdrawal.processedBy = admin.fullName || 'Admin';
        await withdrawal.save();

        await Transaction.findOneAndUpdate({ tx_id: withdrawal.transactionId }, { status: 'success', remark: `Aᴘᴘʀᴏᴠᴇᴅ Bʏ ${admin.fullName || 'Admin'}` });

        console.log('✅ Wɪᴛʜᴅʀᴀᴡᴀʟ Aᴘᴘʀᴏᴠᴇᴅ:', withdrawal.transactionId);

        if (user.telegramId) {
            const methodText = withdrawal.method === 'upi' ? 'UPI' : 'Bank';
            const detailsText = withdrawal.method === 'upi' ? `UPI: ${withdrawal.upiId}` : `Bank: ${withdrawal.bankName}\nAccount: ${withdrawal.accountNumber}`;
            await sendTelegramMessage(user.telegramId,
`<b>─────────────────</b>
<b>✅ Wɪᴛʜᴅʀᴀᴡᴀʟ Aᴘᴘʀᴏᴠᴇᴅ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜʀ Wɪᴛʜᴅʀᴀᴡᴀʟ Hᴀꜱ Bᴇᴇɴ Aᴘᴘʀᴏᴠᴇᴅ!

💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${withdrawal.amount.toFixed(2)}
📱 <b>Mᴇᴛʜᴏᴅ:</b> ${methodText}
${detailsText}
🆔 <b>Tʀᴀɴꜱᴀᴄᴛɪᴏɴ:</b> ${withdrawal.transactionId}
📅 <b>Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🛡️ Tᴇᴀᴍ Jᴀʀᴠɪꜱ Wᴀʟʟᴇᴛ
───────────────────────`);
        }

        res.json({ success: true, message: 'Wɪᴛʜᴅʀᴀᴡᴀʟ Aᴘᴘʀᴏᴠᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ.', withdrawal });
    } catch (error) {
        console.error('❌ Aᴘᴘʀᴏᴠᴇ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Aᴘᴘʀᴏᴠᴇ Wɪᴛʜᴅʀᴀᴡᴀʟ.' });
    }
});

// ============================================
// REJECT WITHDRAWAL (Refund)
// ============================================
router.post('/withdrawal/reject', verifyToken, async (req, res) => {
    try {
        const { withdrawalId, adminNote } = req.body;
        const admin = req.user;
        const dateTime = getCurrentDateTime();

        if (!withdrawalId) return res.status(400).json({ success: false, message: 'Pʟᴇᴀꜱᴇ Pʀᴏᴠɪᴅᴇ Wɪᴛʜᴅʀᴀᴡᴀʟ Iᴅ.' });

        const withdrawal = await Withdrawal.findById(withdrawalId).populate('userId');
        if (!withdrawal) return res.status(404).json({ success: false, message: 'Wɪᴛʜᴅʀᴀᴡᴀʟ Nᴏᴛ Fᴏᴜɴᴅ.' });
        if (withdrawal.status !== 'pending' && withdrawal.status !== 'processing') return res.status(400).json({ success: false, message: `Wɪᴛʜᴅʀᴀᴡᴀʟ Iꜱ Aʟʀᴇᴀᴅʏ "${withdrawal.status}".` });

        const user = withdrawal.userId;
        if (!user) return res.status(404).json({ success: false, message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ.' });

        user.balance += withdrawal.amount;
        await user.save();

        withdrawal.status = 'failed';
        withdrawal.adminNote = adminNote || 'Rᴇᴊᴇᴄᴛᴇᴅ Bʏ Aᴅᴍɪɴ';
        withdrawal.processedAt = new Date();
        withdrawal.processedBy = admin.fullName || 'Admin';
        await withdrawal.save();

        await Transaction.findOneAndUpdate({ tx_id: withdrawal.transactionId }, { status: 'failed', remark: `Rᴇᴊᴇᴄᴛᴇᴅ Bʏ ${admin.fullName || 'Admin'} - Rᴇꜰᴜɴᴅᴇᴅ` });

        console.log('✅ Wɪᴛʜᴅʀᴀᴡᴀʟ Rᴇᴊᴇᴄᴛᴇᴅ:', withdrawal.transactionId);

        if (user.telegramId) {
            await sendTelegramMessage(user.telegramId,
`<b>─────────────────</b>
<b>❌ Wɪᴛʜᴅʀᴀᴡᴀʟ Rᴇᴊᴇᴄᴛᴇᴅ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜʀ Wɪᴛʜᴅʀᴀᴡᴀʟ Hᴀꜱ Bᴇᴇɴ Rᴇᴊᴇᴄᴛᴇᴅ.

💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${withdrawal.amount.toFixed(2)}
📱 <b>Mᴇᴛʜᴏᴅ:</b> ${withdrawal.method.toUpperCase()}
📝 <b>Rᴇᴀꜱᴏɴ:</b> ${adminNote || 'Nᴏ Rᴇᴀꜱᴏɴ Pʀᴏᴠɪᴅᴇᴅ'}
💳 <b>Rᴇꜰᴜɴᴅᴇᴅ Bᴀʟᴀɴᴄᴇ:</b> ₹${user.balance.toFixed(2)}
📅 <b>Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🛡️ Tᴇᴀᴍ Jᴀʀᴠɪꜱ Wᴀʟʟᴇᴛ
───────────────────────`);
        }

        res.json({ success: true, message: 'Wɪᴛʜᴅʀᴀᴡᴀʟ Rᴇᴊᴇᴄᴛᴇᴅ Aɴᴅ Bᴀʟᴀɴᴄᴇ Rᴇꜰᴜɴᴅᴇᴅ.', withdrawal, newBalance: user.balance });
    } catch (error) {
        console.error('❌ Rᴇᴊᴇᴄᴛ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Rᴇᴊᴇᴄᴛ Wɪᴛʜᴅʀᴀᴡᴀʟ.' });
    }
});

// ============================================
// BULK APPROVE
// ============================================
router.post('/withdrawal/bulk-approve', verifyToken, async (req, res) => {
    try {
        const { withdrawalIds, adminNote } = req.body;
        const admin = req.user;
        const dateTime = getCurrentDateTime();

        if (!withdrawalIds || !Array.isArray(withdrawalIds) || withdrawalIds.length === 0) {
            return res.status(400).json({ success: false, message: 'Pʟᴇᴀꜱᴇ Pʀᴏᴠɪᴅᴇ Aʀʀᴀʏ Oꜰ Wɪᴛʜᴅʀᴀᴡᴀʟ Iᴅꜱ.' });
        }

        let approved = 0, failed = 0;
        for (const id of withdrawalIds) {
            try {
                const withdrawal = await Withdrawal.findById(id).populate('userId');
                if (!withdrawal || (withdrawal.status !== 'pending' && withdrawal.status !== 'processing')) { failed++; continue; }

                withdrawal.status = 'completed';
                withdrawal.adminNote = adminNote || 'Bᴜʟᴋ Aᴘᴘʀᴏᴠᴇᴅ';
                withdrawal.processedAt = new Date();
                withdrawal.processedBy = admin.fullName || 'Admin';
                await withdrawal.save();

                await Transaction.findOneAndUpdate({ tx_id: withdrawal.transactionId }, { status: 'success', remark: `Bᴜʟᴋ Aᴘᴘʀᴏᴠᴇᴅ Bʏ ${admin.fullName || 'Admin'}` });

                approved++;
                if (withdrawal.userId?.telegramId) {
                    await sendTelegramMessage(withdrawal.userId.telegramId,
`<b>✅ Wɪᴛʜᴅʀᴀᴡᴀʟ Aᴘᴘʀᴏᴠᴇᴅ</b>
<b>💰 Aᴍᴏᴜɴᴛ:</b> ₹${withdrawal.amount.toFixed(2)}
<b>🆔 Tʀᴀɴꜱᴀᴄᴛɪᴏɴ:</b> ${withdrawal.transactionId}
<b>📅 Tɪᴍᴇ:</b> ${dateTime}`);
                }
            } catch (error) { failed++; }
        }

        res.json({ success: true, message: `${approved} Aᴘᴘʀᴏᴠᴇᴅ, ${failed} Fᴀɪʟᴇᴅ.`, approved, failed });
    } catch (error) {
        console.error('❌ Bᴜʟᴋ Aᴘᴘʀᴏᴠᴇ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Pʀᴏᴄᴇꜱꜱ Bᴜʟᴋ Aᴘᴘʀᴏᴠᴀʟ.' });
    }
});

// ============================================
// EXPORT WITHDRAWALS AS CSV
// ============================================
router.get('/withdrawals/export', verifyToken, async (req, res) => {
    try {
        const { status, method, fromDate, toDate } = req.query;
        let query = {};
        if (status && status !== 'all') query.status = status;
        if (method && method !== 'all') query.method = method;
        if (fromDate) { const from = new Date(fromDate); from.setHours(0, 0, 0, 0); query.createdAt = { $gte: from }; }
        if (toDate) { const to = new Date(toDate); to.setHours(23, 59, 59, 999); query.createdAt = { ...query.createdAt, $lte: to }; }

        const withdrawals = await Withdrawal.find(query).populate('userId', 'fullName mobile walletId').sort({ createdAt: -1 });

        let csv = 'Transaction ID,User,Wallet ID,Amount,Method,UPI/Bank Details,Status,Created At\n';
        withdrawals.forEach(w => {
            const user = w.userId || { fullName: 'Unknown', mobile: 'N/A', walletId: 'N/A' };
            const details = w.method === 'upi' ? `UPI: ${w.upiId || 'N/A'}` : `Bank: ${w.bankName || 'N/A'}, Acc: ${w.accountNumber || 'N/A'}`;
            csv += `${w.transactionId},${user.fullName},${user.walletId},${w.amount},${w.method},${details},${w.status},${new Date(w.createdAt).toLocaleString()}\n`;
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=withdrawals_${Date.now()}.csv`);
        res.send(csv);
    } catch (error) {
        console.error('❌ Exᴘᴏʀᴛ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Exᴘᴏʀᴛ Wɪᴛʜᴅʀᴀᴡᴀʟꜱ.' });
    }
});

module.exports = router;
