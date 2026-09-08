// FILE: routes/giftCode.js
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const GiftCode = require('../models/GiftCode'); // ✅ নতুন মডেল ইমপোর্ট
const axios = require('axios');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG = process.env.ADMIN_TG_ID;

// ==================== Verify Token Middleware ====================
const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'Nᴏ Tᴏᴋᴇɴ Pʀᴏᴠɪᴅᴇᴅ' });
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) return res.status(401).json({ success: false, message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ' });
        req.user = user;
        next();
    } catch (error) {
        console.error('Tᴏᴋᴇɴ Vᴇʀɪꜰɪᴄᴀᴛɪᴏɴ Eʀʀᴏʀ:', error.message);
        if (error.name === 'JsonWebTokenError') return res.status(401).json({ success: false, message: 'Iɴᴠᴀʟɪᴅ Tᴏᴋᴇɴ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ Aɢᴀɪɴ.' });
        if (error.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: 'Tᴏᴋᴇɴ Exᴘɪʀᴇᴅ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ Aɢᴀɪɴ.' });
        return res.status(500).json({ success: false, message: 'Aᴜᴛʜᴇɴᴛɪᴄᴀᴛɪᴏɴ Eʀʀᴏʀ' });
    }
};

// ==================== Helper Functions ====================
function generateGiftTxnId() { 
    return 'TXN_GIFT_' + Date.now() + Math.floor(Math.random() * 99999); 
}

async function sendTelegramMessage(chatId, message) {
    if (!BOT_TOKEN) return { success: false, error: 'BOT_TOKEN not configured' };
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const response = await axios.post(url, { 
            chat_id: chatId, 
            text: message, 
            parse_mode: 'HTML' 
        }, { 
            timeout: 15000, 
            headers: { 'Content-Type': 'application/json' } 
        });
        if (response.data && response.data.ok) return { success: true };
        return { success: false, error: response.data?.description || 'Unknown Error' };
    } catch (error) {
        console.error('Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Tᴇʟᴇɢʀᴀᴍ Mᴇꜱꜱᴀɢᴇ:', error.message);
        return { success: false, error: error.message };
    }
}

async function notifyAdmin(message) {
    if (!ADMIN_TG) return;
    try { 
        await sendTelegramMessage(ADMIN_TG, message); 
        console.log('✅ Aᴅᴍɪɴ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Sᴇɴᴛ'); 
    } catch (error) { 
        console.error('Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Aᴅᴍɪɴ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ:', error.message); 
    }
}

function getCurrentDateTime() {
    return new Date().toLocaleString('en-IN', { 
        timeZone: 'Asia/Kolkata', 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit', 
        hour12: true 
    });
}

// ✅ গিফট কোড ভ্যালিডেশন: ১-৫০ ক্যারেক্টার (স্পেস, ইমোজি, সিম্বল অনুমোদিত)
function isValidGiftCode(code) {
    if (!code || typeof code !== 'string') return false;
    const len = code.trim().length;
    return len >= 1 && len <= 50;
}

// ============================================
// GET BALANCE - GET /api/gift/balance
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
        console.error('Bᴀʟᴀɴᴄᴇ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ status: 'error', error: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Bᴀʟᴀɴᴄᴇ' });
    }
});

// ============================================
// CREATE GIFT CODE - POST /api/gift/create
// ============================================
router.post('/create', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        const { amount, note, giftCode } = req.body;
        const dateTime = getCurrentDateTime();

        // ✅ ভ্যালিডেশন
        if (!amount || amount <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Aᴍᴏᴜɴᴛ Mᴜꜱᴛ Bᴇ Gʀᴇᴀᴛᴇʀ Tʜᴀɴ 0' 
            });
        }

        if (!giftCode || giftCode.trim() === '') {
            return res.status(400).json({ 
                success: false, 
                message: 'Pʟᴇᴀꜱᴇ Eɴᴛᴇʀ A Gɪꜰᴛ Cᴏᴅᴇ' 
            });
        }

        const customCode = giftCode.trim().toUpperCase(); // ✅ MongoDB-তে uppercase সংরক্ষণ
        
        // ✅ ভ্যালিডেশন: ১-৫০ ক্যারেক্টার
        if (!isValidGiftCode(customCode)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cᴏᴅᴇ Mᴜꜱᴛ Bᴇ 1-50 Cʜᴀʀᴀᴄᴛᴇʀꜱ Lᴏɴɢ (Sᴘᴀᴄᴇ, Eᴍᴏᴊɪ, Sʏᴍʙᴏʟ Aʟʟᴏᴡᴇᴅ)' 
            });
        }

        // ✅ চেক করুন কোড আগে থেকে আছে কিনা
        const existingCode = await GiftCode.findOne({ code: customCode });
        if (existingCode) {
            return res.status(400).json({ 
                success: false, 
                message: 'Tʜɪꜱ Gɪꜰᴛ Cᴏᴅᴇ Aʟʀᴇᴀᴅʏ Exɪꜱᴛꜱ. Pʟᴇᴀꜱᴇ Cʜᴏᴏꜱᴇ A Dɪꜰꜰᴇʀᴇɴᴛ Oɴᴇ.' 
            });
        }

        // ✅ ব্যালেন্স চেক
        const giftAmount = parseFloat(amount);
        if (user.balance < giftAmount) {
            return res.status(400).json({ 
                success: false, 
                message: `Iɴꜱᴜꜰꜰɪᴄɪᴇɴᴛ Bᴀʟᴀɴᴄᴇ. Yᴏᴜʀ Cᴜʀʀᴇɴᴛ Bᴀʟᴀɴᴄᴇ Iꜱ ₹${user.balance.toFixed(2)}. Nᴇᴇᴅ ₹${giftAmount.toFixed(2)}.` 
            });
        }

        // ✅ গিফট কোড তৈরি করুন (MongoDB)
        const giftData = new GiftCode({
            code: customCode,
            amount: giftAmount,
            createdBy: user._id,
            isUsed: false,
            redeemedBy: null,
            redeemedAt: null,
            note: note || 'Gɪꜰᴛ Cᴏᴅᴇ'
        });

        await giftData.save();

        // ✅ ইউজারের ব্যালেন্স কাটুন
        user.balance -= giftAmount;
        await user.save();

        // ✅ ট্রানজেকশন তৈরি করুন
        const transactionId = generateGiftTxnId();
        await Transaction.create({
            tx_id: transactionId,
            user_id: user._id,
            sender_id: user._id,
            receiver_id: user._id,
            amount: giftAmount,
            type: 'gift',
            status: 'success',
            remark: `Gɪꜰᴛ Cᴏᴅᴇ Cʀᴇᴀᴛᴇᴅ: ${customCode}`,
            description: `Gɪꜰᴛ Cᴏᴅᴇ Cʀᴇᴀᴛᴇᴅ: ${customCode}`,
            tx_time: new Date(),
            metadata: { 
                giftCode: customCode, 
                note: note || 'Gɪꜰᴛ Cᴏᴅᴇ',
                amount: giftAmount 
            }
        });

        // ✅ টেলিগ্রাম নোটিফিকেশন (Creator)
        if (user.telegramId) {
            const creatorMessage = 
`<b>─────────────────</b>
<b>🎁 Gɪꜰᴛ Cᴏᴅᴇ Cʀᴇᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜʀ Gɪꜰᴛ Cᴏᴅᴇ Hᴀꜱ Bᴇᴇɴ Cʀᴇᴀᴛᴇᴅ.

🎫 <b>Gɪꜰᴛ Cᴏᴅᴇ:</b> <code>${customCode}</code>
💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${giftAmount.toFixed(2)}
📝 <b>Nᴏᴛᴇ:</b> ${note || 'Nᴏ Nᴏᴛᴇ'}
💳 <b>Nᴇᴡ Bᴀʟᴀɴᴄᴇ:</b> ₹${user.balance.toFixed(2)}

─────────────────────────
⚠️ Iꜰ Yᴏᴜ Dɪᴅɴ'ᴛ Cʀᴇᴀᴛᴇ Tʜɪꜱ, Cᴏɴᴛᴀᴄᴛ Sᴜᴘᴘᴏʀᴛ Iᴍᴍᴇᴅɪᴀᴛᴇʟʏ.
─────────────────────────`;
            await sendTelegramMessage(user.telegramId, creatorMessage);
        }

        // ✅ অ্যাডমিন নোটিফিকেশন
        const adminMessage = 
`<b>─────────────────</b>
<b>🎁 Nᴇᴡ Gɪꜰᴛ Cᴏᴅᴇ Cʀᴇᴀᴛᴇᴅ</b>
<b>─────────────────</b>

👤 <b>Cʀᴇᴀᴛᴏʀ:</b> ${user.fullName}
📱 <b>Mᴏʙɪʟᴇ:</b> ${user.mobile}
🤖 <b>Tᴇʟᴇɢʀᴀᴍ Iᴅ:</b> ${user.telegramId || 'N/A'}
🆔 <b>Wᴀʟʟᴇᴛ Iᴅ:</b> ${user.walletId}
🎫 <b>Gɪꜰᴛ Cᴏᴅᴇ:</b> <code>${customCode}</code>
💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${giftAmount.toFixed(2)}
📝 <b>Nᴏᴛᴇ:</b> ${note || 'Nᴏ Nᴏᴛᴇ'}

───────────────────────
📊 <b>Sᴛᴀᴛᴜꜱ:</b> Aᴄᴛɪᴠᴇ
───────────────────────`;
        await notifyAdmin(adminMessage);

        res.json({
            success: true,
            message: 'Gɪꜰᴛ Cᴏᴅᴇ Cʀᴇᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ',
            giftCode: customCode,
            amount: giftAmount,
            newBalance: user.balance
        });

    } catch (error) {
        console.error('Cʀᴇᴀᴛᴇ Gɪꜰᴛ Cᴏᴅᴇ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Fᴀɪʟᴇᴅ Tᴏ Cʀᴇᴀᴛᴇ Gɪꜰᴛ Cᴏᴅᴇ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.' 
        });
    }
});

// ============================================
// REDEEM GIFT CODE - POST /api/gift/redeem
// ============================================
router.post('/redeem', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        const { giftCode } = req.body;

        if (!giftCode || giftCode.trim() === '') {
            return res.status(400).json({ 
                success: false, 
                message: 'Gɪꜰᴛ Cᴏᴅᴇ Iꜱ Rᴇǫᴜɪʀᴇᴅ' 
            });
        }

        const code = giftCode.trim().toUpperCase(); // ✅ uppercase-এ রূপান্তর

        // ✅ ভ্যালিডেশন: ১-৫০ ক্যারেক্টার
        if (!isValidGiftCode(code)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Cᴏᴅᴇ Mᴜꜱᴛ Bᴇ 1-50 Cʜᴀʀᴀᴄᴛᴇʀꜱ Lᴏɴɢ' 
            });
        }

        // ✅ ডেটাবেস থেকে গিফট কোড খুঁজুন
        const giftData = await GiftCode.findOne({ code: code });
        if (!giftData) {
            return res.status(404).json({ 
                success: false, 
                message: 'Iɴᴠᴀʟɪᴅ Gɪꜰᴛ Cᴏᴅᴇ' 
            });
        }

        // ✅ চেক করুন কোড ইতিমধ্যে ব্যবহার হয়েছে কিনা
        if (giftData.isUsed) {
            return res.status(400).json({ 
                success: false, 
                message: 'Tʜɪꜱ Gɪꜰᴛ Cᴏᴅᴇ Hᴀꜱ Aʟʀᴇᴀᴅʏ Bᴇᴇɴ Uꜱᴇᴅ' 
            });
        }

        // ✅ চেক করুন ইউজার নিজের কোড রিডিম করছে কিনা
        if (giftData.createdBy.toString() === user._id.toString()) {
            return res.status(400).json({ 
                success: false, 
                message: 'Yᴏᴜ Cᴀɴɴᴏᴛ Rᴇᴅᴇᴇᴍ Yᴏᴜʀ Oᴡɴ Gɪꜰᴛ Cᴏᴅᴇ' 
            });
        }

        // ✅ গিফট কোড ব্যবহার করুন
        await giftData.use(user._id);

        // ✅ ইউজারের ব্যালেন্স যোগ করুন
        user.balance += giftData.amount;
        await user.save();

        // ✅ ট্রানজেকশন তৈরি করুন
        const transactionId = generateGiftTxnId();
        await Transaction.create({
            tx_id: transactionId,
            user_id: user._id,
            sender_id: giftData.createdBy,
            receiver_id: user._id,
            amount: giftData.amount,
            type: 'gift',
            status: 'success',
            remark: `Gɪꜰᴛ Cᴏᴅᴇ Rᴇᴅᴇᴇᴍᴇᴅ: ${code}`,
            description: `Gɪꜰᴛ Cᴏᴅᴇ Rᴇᴅᴇᴇᴍᴇᴅ: ${code}`,
            tx_time: new Date(),
            metadata: { 
                giftCode: code,
                creatorId: giftData.createdBy
            }
        });

        // ✅ টেলিগ্রাম নোটিফিকেশন (Redeemer)
        if (user.telegramId) {
            const redeemerMessage = 
`<b>─────────────────</b>
<b>🎁 Gɪꜰᴛ Cᴏᴅᴇ Rᴇᴅᴇᴇᴍᴇᴅ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜ Hᴀᴠᴇ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ Rᴇᴅᴇᴇᴍᴇᴅ Tʜᴇ Gɪꜰᴛ Cᴏᴅᴇ.

🎫 <b>Gɪꜰᴛ Cᴏᴅᴇ:</b> <code>${code}</code>
💰 <b>Aᴍᴏᴜɴᴛ Aᴅᴅᴇᴅ:</b> ₹${giftData.amount.toFixed(2)}
💳 <b>Nᴇᴡ Bᴀʟᴀɴᴄᴇ:</b> ₹${user.balance.toFixed(2)}

─────────────────────────
✅ Aᴍᴏᴜɴᴛ Cʀᴇᴅɪᴛᴇᴅ Tᴏ Yᴏᴜʀ Wᴀʟʟᴇᴛ.
─────────────────────────`;
            await sendTelegramMessage(user.telegramId, redeemerMessage);
        }

        // ✅ অ্যাডমিন নোটিফিকেশন
        const adminMessage = 
`<b>─────────────────</b>
<b>🎁 Gɪꜰᴛ Cᴏᴅᴇ Rᴇᴅᴇᴇᴍᴇᴅ</b>
<b>─────────────────</b>

👤 <b>Rᴇᴅᴇᴇᴍᴇʀ:</b> ${user.fullName}
📱 <b>Mᴏʙɪʟᴇ:</b> ${user.mobile}
🤖 <b>Tᴇʟᴇɢʀᴀᴍ Iᴅ:</b> ${user.telegramId || 'N/A'}
🎫 <b>Gɪꜰᴛ Cᴏᴅᴇ:</b> <code>${code}</code>
💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${giftData.amount.toFixed(2)}
💳 <b>Nᴇᴡ Bᴀʟᴀɴᴄᴇ:</b> ₹${user.balance.toFixed(2)}

───────────────────────
📊 <b>Sᴛᴀᴛᴜꜱ:</b> Uꜱᴇᴅ
───────────────────────`;
        await notifyAdmin(adminMessage);

        res.json({
            success: true,
            message: 'Gɪꜰᴛ Cᴏᴅᴇ Rᴇᴅᴇᴇᴍᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ',
            amount: giftData.amount,
            newBalance: user.balance,
            isUsed: true
        });

    } catch (error) {
        console.error('Rᴇᴅᴇᴇᴍ Gɪꜰᴛ Cᴏᴅᴇ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Fᴀɪʟᴇᴅ Tᴏ Rᴇᴅᴇᴇᴍ Gɪꜰᴛ Cᴏᴅᴇ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.' 
        });
    }
});

// ============================================
// GET GIFT CODE DETAILS - GET /api/gift/details/:code
// ============================================
router.get('/details/:code', verifyToken, async (req, res) => {
    try {
        const { code } = req.params;
        const user = req.user;
        
        if (!code) {
            return res.status(400).json({ 
                success: false, 
                message: 'Gɪꜰᴛ Cᴏᴅᴇ Iꜱ Rᴇǫᴜɪʀᴇᴅ' 
            });
        }

        const giftData = await GiftCode.findOne({ code: code.toUpperCase() });
        if (!giftData) {
            return res.status(404).json({ 
                success: false, 
                message: 'Iɴᴠᴀʟɪᴅ Gɪꜰᴛ Cᴏᴅᴇ' 
            });
        }

        // ✅ শুধু ক্রিয়েটর বা অ্যাডমিন দেখতে পারবে
        if (giftData.createdBy.toString() !== user._id.toString() && !user.isAdmin) {
            return res.status(403).json({ 
                success: false, 
                message: 'Uɴᴀᴜᴛʜᴏʀɪᴢᴇᴅ Tᴏ Vɪᴇᴡ Tʜɪꜱ Gɪꜰᴛ Cᴏᴅᴇ' 
            });
        }

        // ✅ ক্রিয়েটরের তথ্য আনা
        const creator = await User.findById(giftData.createdBy);
        const redeemer = giftData.redeemedBy ? await User.findById(giftData.redeemedBy) : null;

        res.json({
            success: true,
            giftCode: {
                code: giftData.code,
                amount: giftData.amount,
                isUsed: giftData.isUsed,
                note: giftData.note,
                creatorName: creator ? creator.fullName : 'Unknown',
                creatorMobile: creator ? creator.mobile : 'Unknown',
                redeemedBy: redeemer ? redeemer.fullName : null,
                redeemedAt: giftData.redeemedAt,
                createdAt: giftData.createdAt
            }
        });
    } catch (error) {
        console.error('Gɪꜰᴛ Cᴏᴅᴇ Dᴇᴛᴀɪʟꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Gɪꜰᴛ Cᴏᴅᴇ Dᴇᴛᴀɪʟꜱ' 
        });
    }
});

// ============================================
// GET MY GIFT CODES - GET /api/gift/my-codes
// ============================================
router.get('/my-codes', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        
        const giftCodes = await GiftCode.find({ createdBy: user._id })
            .sort({ createdAt: -1 })
            .populate('redeemedBy', 'fullName mobile');

        const formattedCodes = giftCodes.map(g => ({
            code: g.code,
            amount: g.amount,
            isUsed: g.isUsed,
            note: g.note,
            redeemedBy: g.redeemedBy ? g.redeemedBy.fullName : null,
            redeemedAt: g.redeemedAt,
            createdAt: g.createdAt
        }));

        res.json({ 
            success: true, 
            codes: formattedCodes, 
            total: formattedCodes.length 
        });
    } catch (error) {
        console.error('Mʏ Gɪꜰᴛ Cᴏᴅᴇꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Gɪꜰᴛ Cᴏᴅᴇꜱ' 
        });
    }
});

// ============================================
// GET ALL GIFT CODES (Admin Only) - GET /api/gift/all
// ============================================
router.get('/all', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        if (!user.isAdmin) {
            return res.status(403).json({ 
                success: false, 
                message: 'Aᴅᴍɪɴ Aᴄᴄᴇꜱꜱ Rᴇǫᴜɪʀᴇᴅ' 
            });
        }

        const giftCodes = await GiftCode.find({})
            .sort({ createdAt: -1 })
            .populate('createdBy', 'fullName mobile telegramId walletId')
            .populate('redeemedBy', 'fullName mobile telegramId');

        const formattedCodes = giftCodes.map(g => ({
            code: g.code,
            amount: g.amount,
            isUsed: g.isUsed,
            note: g.note,
            creatorName: g.createdBy ? g.createdBy.fullName : 'Unknown',
            creatorMobile: g.createdBy ? g.createdBy.mobile : 'Unknown',
            creatorTelegramId: g.createdBy ? g.createdBy.telegramId : null,
            redeemedBy: g.redeemedBy ? g.redeemedBy.fullName : null,
            redeemedAt: g.redeemedAt,
            createdAt: g.createdAt
        }));

        res.json({ 
            success: true, 
            codes: formattedCodes, 
            total: formattedCodes.length 
        });
    } catch (error) {
        console.error('Aʟʟ Gɪꜰᴛ Cᴏᴅᴇꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Gɪꜰᴛ Cᴏᴅᴇꜱ' 
        });
    }
});

// ============================================
// DELETE GIFT CODE (Admin Only) - DELETE /api/gift/:code
// ============================================
router.delete('/:code', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        if (!user.isAdmin) {
            return res.status(403).json({ 
                success: false, 
                message: 'Aᴅᴍɪɴ Aᴄᴄᴇꜱꜱ Rᴇǫᴜɪʀᴇᴅ' 
            });
        }

        const { code } = req.params;
        if (!code) {
            return res.status(400).json({ 
                success: false, 
                message: 'Gɪꜰᴛ Cᴏᴅᴇ Iꜱ Rᴇǫᴜɪʀᴇᴅ' 
            });
        }

        const giftData = await GiftCode.findOneAndDelete({ code: code.toUpperCase() });
        if (!giftData) {
            return res.status(404).json({ 
                success: false, 
                message: 'Gɪꜰᴛ Cᴏᴅᴇ Nᴏᴛ Fᴏᴜɴᴅ' 
            });
        }

        console.log(`✅ Gɪꜰᴛ Cᴏᴅᴇ "${code}" Dᴇʟᴇᴛᴇᴅ Bʏ Aᴅᴍɪɴ: ${user.fullName}`);
        res.json({ 
            success: true, 
            message: 'Gɪꜰᴛ Cᴏᴅᴇ Dᴇʟᴇᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ' 
        });
    } catch (error) {
        console.error('Dᴇʟᴇᴛᴇ Gɪꜰᴛ Cᴏᴅᴇ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ 
            success: false, 
            message: 'Fᴀɪʟᴇᴅ Tᴏ Dᴇʟᴇᴛᴇ Gɪꜰᴛ Cᴏᴅᴇ' 
        });
    }
});

module.exports = router;
