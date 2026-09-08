// FILE: routes/tg.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const crypto = require('crypto');
require('dotenv').config();

// ============================================================
// Tᴇʟᴇɢʀᴀᴍ • Pʀ𝙸ᴍᴇ Wᴀʟʟᴇᴛ — Bᴀᴄᴋᴇɴᴅ Rᴏᴜᴛᴇꜱ
// ============================================================

// Telegram Bot Configuration from .env with fallback values
const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TG_ID;
const JWT_SECRET = process.env.JWT_SECRET;

// ============================================================
// Cᴏʟᴏʀ Cᴏɴꜱᴛᴀɴᴛꜱ Fᴏʀ Cᴏɴꜱᴏʟᴇ Lᴏɢꜱ
// ============================================================
const COLORS = {
    GREEN: '\x1b[32m',
    RED: '\x1b[31m',
    BLUE: '\x1b[34m',
    RESET: '\x1b[0m'
};

// ============================================================
// Cᴏʟᴏʀᴇᴅ Cᴏɴꜱᴏʟᴇ Lᴏɢꜱ
// ============================================================
function logSuccess(message) {
    console.log(`${COLORS.GREEN}✅ ${message}${COLORS.RESET}`);
}

function logError(message) {
    console.log(`${COLORS.RED}❌ ${message}${COLORS.RESET}`);
}

function logInfo(message) {
    console.log(`${COLORS.BLUE}📌 ${message}${COLORS.RESET}`);
}

// Iɴ-Mᴇᴍᴏʀʏ OTP Sᴛᴏʀᴇ (Uꜱᴇ Rᴇᴅɪꜱ Iɴ Pʀᴏᴅᴜᴄᴛɪᴏɴ)
const otpStore = new Map();

// ============================================================
// Hᴇʟᴘᴇʀ: Sᴇɴᴅ Mᴇꜱꜱᴀɢᴇ Vɪᴀ Tᴇʟᴇɢʀᴀᴍ
// ============================================================
async function sendTelegramMessage(chatId, message) {
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
                    if (result.ok) {
                        logSuccess(`Tᴇʟᴇɢʀᴀᴍ Mᴇꜱꜱᴀɢᴇ Sᴇɴᴛ Tᴏ ${chatId}`);
                    } else {
                        logError(`Tᴇʟᴇɢʀᴀᴍ Eʀʀᴏʀ: ${result.description}`);
                    }
                    resolve({ success: result.ok, error: result.description });
                } catch (e) {
                    logError(`Pᴀʀꜱᴇ Eʀʀᴏʀ: ${e.message}`);
                    resolve({ success: false, error: e.message });
                }
            });
        });
        
        request.on('error', (error) => {
            logError(`Rᴇǫᴜᴇꜱᴛ Eʀʀᴏʀ: ${error.message}`);
            resolve({ success: false, error: error.message });
        });
        
        request.write(data);
        request.end();
    });
}

// ============================================================
// Hᴇʟᴘᴇʀ: Vᴇʀɪꜰʏ JWT Tᴏᴋᴇɴ & Gᴇᴛ Uꜱᴇʀ
// ============================================================
async function getUserFromToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logError('M𝙸ꜱꜱ𝙸ɴɢ Oʀ Iɴᴠᴀʟ𝙸ᴅ Aᴜᴛʜᴏʀ𝙸ᴢᴀᴛ𝙸ᴏɴ Hᴇᴀᴅᴇʀ');
        throw new Error('M𝙸ꜱꜱ𝙸ɴɢ Oʀ Iɴᴠᴀʟ𝙸ᴅ Aᴜᴛʜᴏʀ𝙸ᴢᴀᴛ𝙸ᴏɴ Hᴇᴀᴅᴇʀ');
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const user = await User.findById(decoded.userId);
    if (!user) {
        logError(`Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ: ${decoded.userId}`);
        throw new Error('Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ');
    }

    logInfo(`Uꜱᴇʀ Aᴜᴛʜᴇɴᴛ𝙸ᴄᴀᴛᴇᴅ: ${user.fullName || user.mobile}`);
    return user;
}

// ============================================================
// Hᴇʟᴘᴇʀ: Gᴇɴᴇʀᴀᴛᴇ OTP (6-D𝙸ɢ𝙸ᴛ)
// ============================================================
function generateOTP() {
    return crypto.randomInt(100000, 999999).toString();
}

// ============================================================
// Hᴇʟᴘᴇʀ: Gᴇᴛ Cᴜʀʀᴇɴᴛ T𝙸ᴍᴇ Iɴ Iꜱᴛ
// ============================================================
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

// ============================================================
// Rᴏᴜᴛᴇ: Gᴇᴛ Tᴇʟᴇɢʀᴀᴍ Sᴛᴀᴛᴜꜱ
// ============================================================
router.get('/status', async (req, res) => {
    try {
        logInfo('Gᴇᴛᴛ𝙸ɴɢ Tᴇʟᴇɢʀᴀᴍ Sᴛᴀᴛᴜꜱ...');
        const user = await getUserFromToken(req);

        logSuccess(`Tᴇʟᴇɢʀᴀᴍ Sᴛᴀᴛᴜꜱ: ${user.telegramId || 'Nᴏᴛ L𝙸ɴᴋᴇᴅ'}`);
        res.json({
            success: true,
            telegramId: user.telegramId || null,
            linked: !!user.telegramId,
        });
    } catch (error) {
        logError(`Sᴛᴀᴛᴜꜱ Eʀʀᴏʀ: ${error.message}`);
        res.status(401).json({
            success: false,
            message: error.message || 'Uɴᴀᴜᴛʜᴏʀ𝙸ᴢᴇᴅ Aᴄᴄᴇꜱꜱ',
        });
    }
});

// ============================================================
// Rᴏᴜᴛᴇ: Sᴇɴᴅ OTP Tᴏ Tᴇʟᴇɢʀᴀᴍ
// ============================================================
router.post('/send-otp', async (req, res) => {
    try {
        const { telegramId } = req.body;
        const dateTime = getCurrentDateTime();
        logInfo(`Sᴇɴᴅ𝙸ɴɢ OTP Tᴏ Tᴇʟᴇɢʀᴀᴍ Iᴅ: ${telegramId}`);

        if (!telegramId || !/^\d{10}$/.test(telegramId)) {
            logError(`Iɴᴠᴀʟ𝙸ᴅ Tᴇʟᴇɢʀᴀᴍ Iᴅ Fᴏʀᴍᴀᴛ: ${telegramId}`);
            return res.status(400).json({
                success: false,
                message: 'Iɴᴠᴀʟ𝙸ᴅ Tᴇʟᴇɢʀᴀᴍ Iᴅ Fᴏʀᴍᴀᴛ — Exᴘᴇᴄᴛᴇᴅ 10 D𝙸ɢ𝙸ᴛꜱ',
            });
        }

        const user = await getUserFromToken(req);

        if (user.telegramId) {
            logError(`Tᴇʟᴇɢʀᴀᴍ Aʟʀᴇᴀᴅʏ L𝙸ɴᴋᴇᴅ Fᴏʀ Uꜱᴇʀ: ${user._id}`);
            return res.status(400).json({
                success: false,
                message: 'Tᴇʟᴇɢʀᴀᴍ Aʟʀᴇᴀᴅʏ L𝙸ɴᴋᴇᴅ Tᴏ Tʜ𝙸ꜱ Aᴄᴄᴏᴜɴᴛ',
            });
        }

        const otp = generateOTP();
        const expiresAt = Date.now() + 5 * 60 * 1000;

        otpStore.set(telegramId, {
            otp,
            expiresAt,
            userId: user._id.toString(),
        });

        setTimeout(() => {
            if (otpStore.get(telegramId)?.otp === otp) {
                otpStore.delete(telegramId);
                logInfo(`Cʟᴇᴀɴᴇᴅ Exᴘ𝙸ʀᴇᴅ OTP Fᴏʀ ${telegramId}`);
            }
        }, 5 * 60 * 1000);

        logSuccess(`OTP Gᴇɴᴇʀᴀᴛᴇᴅ Fᴏʀ ${telegramId}: ${otp}`);

        const otpMessage = 
`<b>──────────────</b>
<b>🔐 Oᴛᴘ Sᴇᴄᴛɪᴏɴ</b>
<b>──────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜʀ Oɴᴇ Tɪᴍᴇ Pᴀꜱꜱᴡᴏʀᴅ Hᴀꜱ Bᴇᴇɴ Gᴇɴᴇʀᴀᴛᴇᴅ.

📲 <b>Yᴏᴜʀ Oᴛᴘ:</b> <code>${otp}</code>
⏳ <b>Vᴀʟɪᴅɪᴛʏ:</b> 5 M𝙸ɴᴜᴛᴇꜱ
🎯 <b>Pᴜʀᴘᴏꜱᴇ:</b> Tᴇʟᴇɢʀᴀᴍ L𝙸ɴᴋ𝙸ɴɢ
📅 <code>${dateTime}</code>

───────────────────────
🔒 Dᴏ Nᴏᴛ Sʜᴀʀᴇ Tʜɪꜱ Oᴛᴘ Wɪᴛʜ Aɴʏᴏɴᴇ.
───────────────────────`;

        const result = await sendTelegramMessage(telegramId, otpMessage);

        if (!result.success) {
            logError(`Fᴀ𝙸ʟᴇᴅ Tᴏ Sᴇɴᴅ OTP Vɪᴀ Tᴇʟᴇɢʀᴀᴍ: ${result.error}`);
            return res.status(500).json({
                success: false,
                message: 'Fᴀ𝙸ʟᴇᴅ Tᴏ Sᴇɴᴅ Oᴛᴘ. Pʟᴇᴀꜱᴇ Mᴀᴋᴇ Sᴜʀᴇ Yᴏᴜ Hᴀᴠᴇ Sᴛᴀʀᴛᴇᴅ Tʜᴇ Bᴏᴛ Aɴᴅ Tʀʏ Aɢᴀ𝙸ɴ.'
            });
        }

        logSuccess(`OTP Sᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ Tᴏ ${telegramId}`);

        res.json({
            success: true,
            message: 'OTP Sᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ Tᴏ Yᴏᴜʀ Tᴇʟᴇɢʀᴀᴍ',
        });
    } catch (error) {
        logError(`Sᴇɴᴅ OTP Eʀʀᴏʀ: ${error.message}`);
        res.status(500).json({
            success: false,
            message: error.message || 'Fᴀ𝙸ʟᴇᴅ Tᴏ Sᴇɴᴅ OTP — Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀ𝙸ɴ',
        });
    }
});

// ============================================================
// Rᴏᴜᴛᴇ: Vᴇʀɪꜰʏ OTP & Lɪɴᴋ Tᴇʟᴇɢʀᴀᴍ
// ============================================================
router.post('/verify-otp', async (req, res) => {
    try {
        const { telegramId, otp } = req.body;
        const dateTime = getCurrentDateTime();
        logInfo(`Vᴇʀ𝙸ꜰʏ𝙸ɴɢ OTP Fᴏʀ Tᴇʟᴇɢʀᴀᴍ Iᴅ: ${telegramId}`);

        if (!telegramId || !otp) {
            logError('M𝙸ꜱꜱ𝙸ɴɢ Tᴇʟᴇɢʀᴀᴍ Iᴅ Oʀ OTP');
            return res.status(400).json({
                success: false,
                message: 'M𝙸ꜱꜱ𝙸ɴɢ Tᴇʟᴇɢʀᴀᴍ Iᴅ Oʀ OTP',
            });
        }

        const storedData = otpStore.get(telegramId);
        if (!storedData) {
            logError(`Nᴏ OTP Fᴏᴜɴᴅ Fᴏʀ ${telegramId}`);
            return res.status(400).json({
                success: false,
                message: 'Nᴏ OTP Fᴏᴜɴᴅ Fᴏʀ Tʜ𝙸ꜱ Tᴇʟᴇɢʀᴀᴍ Iᴅ — Pʟᴇᴀꜱᴇ Rᴇǫᴜᴇꜱᴛ A Nᴇᴡ OTP',
            });
        }

        if (Date.now() > storedData.expiresAt) {
            otpStore.delete(telegramId);
            logError(`OTP Exᴘ𝙸ʀᴇᴅ Fᴏʀ ${telegramId}`);
            return res.status(400).json({
                success: false,
                message: 'OTP Exᴘ𝙸ʀᴇᴅ — Pʟᴇᴀꜱᴇ Rᴇǫᴜᴇꜱᴛ A Nᴇᴡ OTP',
            });
        }

        if (storedData.otp !== otp) {
            logError(`Iɴᴄᴏʀʀᴇᴄᴛ OTP Fᴏʀ ${telegramId}: ${otp}`);
            return res.status(400).json({
                success: false,
                message: 'Iɴᴄᴏʀʀᴇᴄᴛ OTP — Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀ𝙸ɴ',
            });
        }

        const user = await User.findById(storedData.userId);
        if (!user) {
            logError(`Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ: ${storedData.userId}`);
            return res.status(404).json({
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ — Pʟᴇᴀꜱᴇ Lᴏɢ𝙸ɴ Aɢᴀ𝙸ɴ',
            });
        }

        const existingUser = await User.findOne({ telegramId });
        if (existingUser && existingUser._id.toString() !== user._id.toString()) {
            logError(`Tᴇʟᴇɢʀᴀᴍ Iᴅ Aʟʀᴇᴀᴅʏ L𝙸ɴᴋᴇᴅ Tᴏ Aɴᴏᴛʜᴇʀ Uꜱᴇʀ: ${telegramId}`);
            return res.status(400).json({
                success: false,
                message: 'Tʜ𝙸ꜱ Tᴇʟᴇɢʀᴀᴍ Aᴄᴄᴏᴜɴᴛ Iꜱ Aʟʀᴇᴀᴅʏ L𝙸ɴᴋᴇᴅ Tᴏ Aɴᴏᴛʜᴇʀ Uꜱᴇʀ',
            });
        }

        user.telegramId = telegramId;
        await user.save();

        otpStore.delete(telegramId);

        logSuccess(`Tᴇʟᴇɢʀᴀᴍ L𝙸ɴᴋᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ Fᴏʀ Uꜱᴇʀ: ${user.fullName || user._id}`);

        const confirmMessage = 
`<b>─────────────────</b>
<b>✅ Tᴇʟᴇɢʀᴀᴍ Lɪɴᴋᴇᴅ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜʀ Tᴇʟᴇɢʀᴀᴍ Aᴄᴄᴏᴜɴᴛ Hᴀꜱ Bᴇᴇɴ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ Lɪɴᴋᴇᴅ.

🆔 <b>Tᴇʟᴇɢʀᴀᴍ Iᴅ:</b> ${telegramId}
📅 <code>${dateTime}</code>

───────────────────────
✅ Yᴏᴜ Cᴀɴ Nᴏᴡ Rᴇᴄᴇɪᴠᴇ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴꜱ.
───────────────────────`;

        await sendTelegramMessage(telegramId, confirmMessage);

        res.json({
            success: true,
            message: 'Tᴇʟᴇɢʀᴀᴍ L𝙸ɴᴋᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ',
            telegramId: user.telegramId,
        });
    } catch (error) {
        logError(`Vᴇʀ𝙸ꜰʏ OTP Eʀʀᴏʀ: ${error.message}`);
        res.status(500).json({
            success: false,
            message: error.message || 'Fᴀ𝙸ʟᴇᴅ Tᴏ Vᴇʀ𝙸ꜰʏ OTP — Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀ𝙸ɴ',
        });
    }
});

// ============================================================
// Rᴏᴜᴛᴇ: Uɴʟɪɴᴋ Tᴇʟᴇɢʀᴀᴍ (Nᴏ OTP Rᴇǫᴜɪʀᴇᴅ)
// ============================================================
router.post('/unlink', async (req, res) => {
    try {
        logInfo('Uɴʟ𝙸ɴᴋ𝙸ɴɢ Tᴇʟᴇɢʀᴀᴍ...');
        const user = await getUserFromToken(req);

        if (!user.telegramId) {
            logError('Nᴏ Tᴇʟᴇɢʀᴀᴍ Aᴄᴄᴏᴜɴᴛ Tᴏ Uɴʟ𝙸ɴᴋ');
            return res.status(400).json({
                success: false,
                message: 'Nᴏ Tᴇʟᴇɢʀᴀᴍ Aᴄᴄᴏᴜɴᴛ Tᴏ Uɴʟ𝙸ɴᴋ',
            });
        }

        const telegramId = user.telegramId;
        const dateTime = getCurrentDateTime();

        user.telegramId = null;
        await user.save();

        logSuccess(`Tᴇʟᴇɢʀᴀᴍ Uɴʟ𝙸ɴᴋᴇᴅ Fᴏʀ Uꜱᴇʀ: ${user.fullName || user._id}`);

        const unlinkMessage = 
`<b>─────────────────</b>
<b>🔴 Tᴇʟᴇɢʀᴀᴍ Uɴʟɪɴᴋᴇᴅ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜʀ Tᴇʟᴇɢʀᴀᴍ Aᴄᴄᴏᴜɴᴛ Hᴀꜱ Bᴇᴇɴ Dɪꜱᴄᴏɴɴᴇᴄᴛᴇᴅ Fʀᴏᴍ Pʀɪᴍᴇ Wᴀʟʟᴇᴛ.

🆔 <b>Tᴇʟᴇɢʀᴀᴍ Iᴅ:</b> ${telegramId}
📅 <code>${dateTime}</code>

───────────────────────
📵 Yᴏᴜ Wɪʟʟ Nᴏ Lᴏɴɢᴇʀ Rᴇᴄᴇɪᴠᴇ Aʟᴇʀᴛꜱ Oɴ Tʜɪꜱ Aᴄᴄᴏᴜɴᴛ.
───────────────────────`;

        await sendTelegramMessage(telegramId, unlinkMessage);

        res.json({
            success: true,
            message: 'Tᴇʟᴇɢʀᴀᴍ Uɴʟ𝙸ɴᴋᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ',
        });
    } catch (error) {
        logError(`Uɴʟ𝙸ɴᴋ Eʀʀᴏʀ: ${error.message}`);
        res.status(500).json({
            success: false,
            message: error.message || 'Fᴀ𝙸ʟᴇᴅ Tᴏ Uɴʟ𝙸ɴᴋ Tᴇʟᴇɢʀᴀᴍ — Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀ𝙸ɴ',
        });
    }
});

// ============================================================
// Rᴏᴜᴛᴇ: Wᴇʙʜᴏᴏᴋ Fᴏʀ Tᴇʟᴇɢʀᴀᴍ Bᴏᴛ
// ============================================================
router.post('/webhook', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message) {
            return res.sendStatus(200);
        }

        const chatId = message.chat.id;
        const text = message.text || '';
        const dateTime = getCurrentDateTime();

        logInfo(`Rᴇᴄᴇ𝙸ᴠᴇᴅ Mᴇꜱꜱᴀɢᴇ Fʀᴏᴍ ${chatId}: ${text}`);

        if (text.startsWith('/status')) {
            const user = await User.findOne({ telegramId: chatId.toString() });
            if (user) {
                const statusMessage = 
`<b>──────────────</b>
<b>✅ Lɪɴᴋᴇᴅ Sᴛᴀᴛᴜꜱ</b>
<b>──────────────</b>

Yᴏᴜʀ Tᴇʟᴇɢʀᴀᴍ Iꜱ Cᴜʀʀᴇɴᴛʟʏ Lɪɴᴋᴇᴅ Tᴏ Pʀɪᴍᴇ Wᴀʟʟᴇᴛ.

👤 <b>Uꜱᴇʀ:</b> ${user.fullName}
🆔 <b>Wᴀʟʟᴇᴛ Iᴅ:</b> ${user.walletId}
📱 <b>Tᴇʟᴇɢʀᴀᴍ Iᴅ:</b> ${chatId}

───────────────────────
🔔 Yᴏᴜ Wɪʟʟ Rᴇᴄᴇɪᴠᴇ Rᴇᴀʟ-Tɪᴍᴇ Aʟᴇʀᴛꜱ Hᴇʀᴇ.
───────────────────────`;
                
                await sendTelegramMessage(chatId, statusMessage);
                logSuccess(`Sᴛᴀᴛᴜꜱ Mᴇꜱꜱᴀɢᴇ Sᴇɴᴛ Tᴏ ${chatId} (L𝙸ɴᴋᴇᴅ)`);
            } else {
                const notLinkedMessage = 
`<b>───────────</b>
<b>❌ Nᴏᴛ Lɪɴᴋᴇᴅ</b>
<b>───────────</b>

Yᴏᴜʀ Tᴇʟᴇɢʀᴀᴍ Iꜱ Nᴏᴛ Cᴜʀʀᴇɴᴛʟʏ Lɪɴᴋᴇᴅ Tᴏ Aɴʏ Pʀɪᴍᴇ Wᴀʟʟᴇᴛ Aᴄᴄᴏᴜɴᴛ.

───────────────────────
Tᴏ Lɪɴᴋ, Pʟᴇᴀꜱᴇ Tʀʏ Tᴏ Cᴏɴᴛᴀᴄᴛ Sᴜᴩᴩᴏʀᴛ Tᴇᴀᴍ.
───────────────────────`;
                
                await sendTelegramMessage(chatId, notLinkedMessage);
                logInfo(`Sᴛᴀᴛᴜꜱ Mᴇꜱꜱᴀɢᴇ Sᴇɴᴛ Tᴏ ${chatId} (Nᴏᴛ L𝙸ɴᴋᴇᴅ)`);
            }
        }

        res.sendStatus(200);
    } catch (error) {
        logError(`Wᴇʙʜᴏᴏᴋ Eʀʀᴏʀ: ${error.message}`);
        res.sendStatus(500);
    }
});

// ============================================================
// Rᴏᴜᴛᴇ: Sᴇᴛ Wᴇʙʜᴏᴏᴋ
// ============================================================
router.post('/set-webhook', async (req, res) => {
    try {
        if (!BOT_TOKEN) {
            logError('BOT_TOKEN Iꜱ Nᴏᴛ Cᴏɴꜰ𝙸ɢᴜʀᴇᴅ');
            return res.status(500).json({
                success: false,
                message: 'BOT_TOKEN Iꜱ Nᴏᴛ Cᴏɴꜰ𝙸ɢᴜʀᴇᴅ',
            });
        }
        const webhookUrl = req.body.url || `${process.env.APP_URL || 'https://prime-wallet-lifafa.vercel.app'}/api/tg/webhook`;
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webhookUrl}`;
        const response = await axios.get(url);
        logSuccess(`Wᴇʙʜᴏᴏᴋ Sᴇᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ: ${webhookUrl}`);
        res.json({
            success: true,
            message: 'Wᴇʙʜᴏᴏᴋ Sᴇᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ',
            data: response.data,
        });
    } catch (error) {
        logError(`Sᴇᴛ Wᴇʙʜᴏᴏᴋ Eʀʀᴏʀ: ${error.message}`);
        res.status(500).json({
            success: false,
            message: error.message || 'Fᴀ𝙸ʟᴇᴅ Tᴏ Sᴇᴛ Wᴇʙʜᴏᴏᴋ — Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀ𝙸ɴ',
        });
    }
});

// ============================================================
// Rᴏᴜᴛᴇ: Cʟᴇᴀɴᴜᴘ Exᴘɪʀᴇᴅ OTPs
// ============================================================
router.post('/cleanup-otps', (req, res) => {
    const now = Date.now();
    let count = 0;
    for (const [key, value] of otpStore.entries()) {
        if (now > value.expiresAt) {
            otpStore.delete(key);
            count++;
        }
    }
    logInfo(`Cʟᴇᴀɴᴇᴅ Uᴘ ${count} Exᴘ𝙸ʀᴇᴅ OTPꜱ`);
    res.json({
        success: true,
        message: `Cʟᴇᴀɴᴇᴅ Uᴘ ${count} Exᴘ𝙸ʀᴇᴅ OTPꜱ`,
        count,
    });
});

module.exports = router;
