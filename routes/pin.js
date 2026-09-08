// FILE: routes/pin.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
require('dotenv').config();

// ===== INITIALIZE GLOBAL STORES =====
if (!global.pinOtpStore) {
    global.pinOtpStore = new Map();
}
// ====================================

// Telegram Bot Configuration from .env
const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TG_ID;
const JWT_SECRET = process.env.JWT_SECRET;

// ============================================
// HELPER FUNCTIONS
// ============================================

// Helper: Send message via Telegram
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
                    console.log('📨 Telegram response:', result.ok ? '✅ Success' : '❌ Failed');
                    if (!result.ok) {
                        console.error('Telegram error:', result.description);
                    }
                    resolve({ success: result.ok, error: result.description });
                } catch (e) {
                    console.error('Parse error:', e);
                    resolve({ success: false, error: e.message });
                }
            });
        });
        
        request.on('error', (error) => {
            console.error('Request error:', error);
            resolve({ success: false, error: error.message });
        });
        
        request.write(data);
        request.end();
    });
}

// Helper: Get current time in IST
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

// Helper: Generate OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper: Clean expired OTPs (run every minute)
function cleanExpiredOTPs() {
    const now = Date.now();
    for (const [key, value] of global.pinOtpStore.entries()) {
        if (now > value.expires) {
            global.pinOtpStore.delete(key);
        }
    }
}
// Run cleanup every minute
setInterval(cleanExpiredOTPs, 60000);

// ============================================
// VERIFY TOKEN MIDDLEWARE
// ============================================

const verifyToken = async (req, res, next) => {
    try {
        if (!JWT_SECRET) {
            console.error('JWT_SECRET environment variable is not set');
            return res.status(200).json({
                success: false,
                message: 'Sᴇʀᴠᴇʀ Cᴏɴꜰɪɢᴜʀᴀᴛɪᴏɴ Eʀʀᴏʀ'
            });
        }

        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(200).json({
                success: false,
                message: 'Aᴜᴛʜᴇɴᴛɪᴄᴀᴛɪᴏɴ Tᴏᴋᴇɴ Iꜱ Mɪꜱꜱɪɴɢ'
            });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        
        try {
            const user = await User.findById(decoded.userId);
            
            if (!user) {
                return res.status(200).json({
                    success: false,
                    message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ'
                });
            }
            
            req.user = user;
            next();
        } catch (dbError) {
            console.error('Database error in token verification:', dbError);
            return res.status(200).json({
                success: false,
                message: 'Dᴀᴛᴀʙᴀꜱᴇ Eʀʀᴏʀ'
            });
        }
    } catch (error) {
        console.error('Token verification error:', error);
        if (error.name === 'JsonWebTokenError') {
            return res.status(200).json({
                success: false,
                message: 'Iɴᴠᴀʟɪᴅ Tᴏᴋᴇɴ'
            });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(200).json({
                success: false,
                message: 'Tᴏᴋᴇɴ Exᴘɪʀᴇᴅ'
            });
        }
        return res.status(200).json({
            success: false,
            message: 'Aᴜᴛʜᴇɴᴛɪᴄᴀᴛɪᴏɴ Eʀʀᴏʀ'
        });
    }
};

// ============================================
// PIN MANAGEMENT ROUTES
// ============================================

// ==================== SET PIN ====================
router.post('/set-pin', verifyToken, async (req, res) => {
    try {
        const { pin } = req.body;
        const user = req.user;

        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Aᴜᴛʜᴇɴᴛɪᴄᴀᴛᴇᴅ'
            });
        }

        const dateTime = getCurrentDateTime();

        // Validate PIN
        if (!pin) {
            return res.status(200).json({
                success: false,
                message: 'Pɪɴ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        if (pin.length !== 4) {
            return res.status(200).json({
                success: false,
                message: 'Pɪɴ Mᴜꜱᴛ Bᴇ Exᴀᴄᴛʟʏ 4 Dɪɢɪᴛꜱ'
            });
        }

        if (!/^\d{4}$/.test(pin)) {
            return res.status(200).json({
                success: false,
                message: 'Pɪɴ Mᴜꜱᴛ Cᴏɴᴛᴀɪɴ Oɴʟʏ Nᴜᴍᴇʀɪᴄ Dɪɢɪᴛꜱ'
            });
        }

        // Check if PIN already set
        if (user.pin) {
            return res.status(200).json({
                success: false,
                message: 'Pɪɴ Iꜱ Aʟʀᴇᴀᴅʏ Sᴇᴛ'
            });
        }

        // Check if this is a new user (first time PIN set)
        const isNewUser = user.isNewUser || false;

        // Hash and save PIN
        const hashedPin = await bcrypt.hash(pin, 12);
        user.pin = hashedPin;
        user.pin_set = true;
        user.isNewUser = false; // Mark as not new user anymore
        await user.save();

        // Send Welcome message via Telegram to user (only for new users)
        if (isNewUser && user.telegramId && BOT_TOKEN) {
            const welcomeMessage = 
`<b>────────────────────</b>
<b>💐 Wᴇʟᴄᴏᴍᴇ Tᴏ Pʀɪᴍᴇ Wᴀʟʟᴇᴛ! 💐</b>
<b>────────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜʀ Aᴄᴄᴏᴜɴᴛ Hᴀꜱ Bᴇᴇɴ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ Cʀᴇᴀᴛᴇᴅ.

<b>📱 Mᴏʙɪʟᴇ:</b> ${user.mobile}
<b>🆔 Wᴀʟʟᴇᴛ Iᴅ:</b> ${user.walletId}
<b>💰 Bᴀʟᴀɴᴄᴇ:</b> ₹${user.balance || 0}
<b>🔢 Pɪɴ:</b> ✅ Sᴇᴛ
<b>⏰ Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🛡️ Tᴇᴀᴍ Pʀɪᴍᴇ Wᴀʟʟᴇᴛ
───────────────────────`;
            
            await sendTelegramMessage(user.telegramId, welcomeMessage);
        }

        // Send Admin Notification for new user only
        if (isNewUser && ADMIN_TELEGRAM_ID && BOT_TOKEN) {
            const adminMessage = 
`<b>────────────────</b>
<b>🆕 Nᴇᴡ Uꜱᴇʀ Rᴇɢɪꜱᴛᴇʀᴇᴅ</b>
<b>────────────────</b>

<b>👤 Nᴀᴍᴇ:</b> ${user.fullName}
<b>📱 Mᴏʙɪʟᴇ:</b> ${user.mobile}
<b>🆔 Wᴀʟʟᴇᴛ Iᴅ:</b> ${user.walletId}
<b>🔑 Aᴘɪ Kᴇʏ:</b> <code>${user.apiKey}</code>
<b>🔢 Pɪɴ:</b> ✅ Sᴇᴛ
<b>📅 Tɪᴍᴇ:</b> ${dateTime}
───────────────────────
<b>👥 Tᴏᴛᴀʟ Uꜱᴇʀꜱ:</b> ${await User.countDocuments()}`;

            await sendTelegramMessage(ADMIN_TELEGRAM_ID, adminMessage);
        }

        res.status(200).json({
            success: true,
            message: isNewUser ? 'Pɪɴ Sᴇᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ! Wᴇʟᴄᴏᴍᴇ Tᴏ Pʀɪᴍᴇ Wᴀʟʟᴇᴛ' : 'Pɪɴ Sᴇᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ',
            isNewUser: isNewUser
        });

    } catch (error) {
        console.error('Set PIN error:', error);
        res.status(200).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Sᴇᴛ Pɪɴ'
        });
    }
});

// ==================== VERIFY PIN ====================
router.post('/verify-pin', verifyToken, async (req, res) => {
    try {
        const { pin } = req.body;
        const user = req.user;

        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Aᴜᴛʜᴇɴᴛɪᴄᴀᴛᴇᴅ'
            });
        }

        const dateTime = getCurrentDateTime();

        // Validate PIN
        if (!pin) {
            return res.status(200).json({
                success: false,
                message: 'Pɪɴ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        if (pin.length !== 4) {
            return res.status(200).json({
                success: false,
                message: 'Pɪɴ Mᴜꜱᴛ Bᴇ Exᴀᴄᴛʟʏ 4 Dɪɢɪᴛꜱ'
            });
        }

        if (!/^\d{4}$/.test(pin)) {
            return res.status(200).json({
                success: false,
                message: 'Pɪɴ Mᴜꜱᴛ Cᴏɴᴛᴀɪɴ Oɴʟʏ Nᴜᴍᴇʀɪᴄ Dɪɢɪᴛꜱ'
            });
        }

        // Check if PIN is set
        if (!user.pin) {
            return res.status(200).json({
                success: false,
                message: 'Pɪɴ Hᴀꜱ Nᴏᴛ Bᴇᴇɴ Sᴇᴛ Yᴇᴛ'
            });
        }

        // Verify PIN
        const isValid = await bcrypt.compare(pin, user.pin);
        if (!isValid) {
            return res.status(200).json({
                success: false,
                message: 'Iɴᴄᴏʀʀᴇᴄᴛ Pɪɴ'
            });
        }

        // Send login notification via Telegram when PIN is verified
        if (user.telegramId && BOT_TOKEN) {
            const loginMessage = 
`<b>─────────────────</b>
<b>🚨 Nᴇᴡ Lᴏɢɪɴ Dᴇᴛᴇᴄᴛᴇᴅ!</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> A Nᴇᴡ Lᴏɢɪɴ Wᴀꜱ Dᴇᴛᴇᴄᴛᴇᴅ Oɴ Yᴏᴜʀ Aᴄᴄᴏᴜɴᴛ.

<b>📱 Mᴏʙɪʟᴇ:</b> ${user.mobile}
<b>🔰 Pᴜʀᴘᴏꜱᴇ:</b> PIN Vᴇʀɪꜰɪᴄᴀᴛɪᴏɴ
<b>⏰ Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
⚠️ Iꜰ Tʜɪꜱ Wᴀꜱɴ'ᴛ Yᴏᴜ, Cʜᴀɴɢᴇ Yᴏᴜʀ Pɪɴ Iᴍᴍᴇᴅɪᴀᴛᴇʟʏ Oʀ Cᴏɴᴛᴀᴄᴛ Sᴜᴘᴘᴏʀᴛ!
───────────────────────`;
            
            // Send asynchronously - don't wait for response
            sendTelegramMessage(user.telegramId, loginMessage).catch(err => {
                console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Pɪɴ Vᴇʀɪꜰɪᴄᴀᴛɪᴏɴ Lᴏɢɪɴ Aʟᴇʀᴛ:', err);
            });
        }

        res.status(200).json({
            success: true,
            message: 'Pɪɴ Vᴇʀɪꜰɪᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ'
        });

    } catch (error) {
        console.error('Verify PIN error:', error);
        res.status(200).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Vᴇʀɪꜰʏ Pɪɴ'
        });
    }
});

// ==================== CHANGE PIN ====================
router.post('/change-pin', verifyToken, async (req, res) => {
    try {
        const { current_pin, new_pin } = req.body;
        const user = req.user;

        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Aᴜᴛʜᴇɴᴛɪᴄᴀᴛᴇᴅ'
            });
        }

        const dateTime = getCurrentDateTime();

        // Validate current PIN
        if (!current_pin) {
            return res.status(200).json({
                success: false,
                message: 'Cᴜʀʀᴇɴᴛ Pɪɴ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        // Validate new PIN
        if (!new_pin) {
            return res.status(200).json({
                success: false,
                message: 'Nᴇᴡ Pɪɴ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        if (new_pin.length !== 4) {
            return res.status(200).json({
                success: false,
                message: 'Nᴇᴡ Pɪɴ Mᴜꜱᴛ Bᴇ Exᴀᴄᴛʟʏ 4 Dɪɢɪᴛꜱ'
            });
        }

        if (!/^\d{4}$/.test(new_pin)) {
            return res.status(200).json({
                success: false,
                message: 'Nᴇᴡ Pɪɴ Mᴜꜱᴛ Cᴏɴᴛᴀɪɴ Oɴʟʏ Nᴜᴍᴇʀɪᴄ Dɪɢɪᴛꜱ'
            });
        }

        if (current_pin === new_pin) {
            return res.status(200).json({
                success: false,
                message: 'Nᴇᴡ Pɪɴ Cᴀɴɴᴏᴛ Bᴇ Sᴀᴍᴇ Aꜱ Cᴜʀʀᴇɴᴛ Pɪɴ'
            });
        }

        // Check if PIN is set
        if (!user.pin) {
            return res.status(200).json({
                success: false,
                message: 'Pɪɴ Hᴀꜱ Nᴏᴛ Bᴇᴇɴ Sᴇᴛ Yᴇᴛ'
            });
        }

        // Verify current PIN
        const isValid = await bcrypt.compare(current_pin, user.pin);
        if (!isValid) {
            return res.status(200).json({
                success: false,
                message: 'Iɴᴄᴏʀʀᴇᴄᴛ Cᴜʀʀᴇɴᴛ Pɪɴ'
            });
        }

        // Hash and save new PIN
        const hashedPin = await bcrypt.hash(new_pin, 12);
        user.pin = hashedPin;
        user.pin_set = true;
        await user.save();

        // Send confirmation via Telegram
        if (user.telegramId) {
            const message = 
`<b>─────────────────</b>
<b>🔄 Pɪɴ Cʜᴀɴɢᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜʀ Pɪɴ Hᴀꜱ Bᴇᴇɴ Cʜᴀɴɢᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ.

<b>🔄 Pɪɴ Sᴛᴀᴛᴜꜱ:</b> ✅ Cʜᴀɴɢᴇᴅ
<b>⏰ Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🔒 Iꜰ Tʜɪꜱ Wᴀꜱɴ'ᴛ Yᴏᴜ, Pʟᴇᴀꜱᴇ Cᴏɴᴛᴀᴄᴛ Sᴜᴘᴘᴏʀᴛ Iᴍᴍᴇᴅɪᴀᴛᴇʟʏ.
───────────────────────`;
            
            await sendTelegramMessage(user.telegramId, message);
        }

        res.status(200).json({
            success: true,
            message: 'Pɪɴ Cʜᴀɴɢᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ'
        });

    } catch (error) {
        console.error('Change PIN error:', error);
        res.status(200).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Cʜᴀɴɢᴇ Pɪɴ'
        });
    }
});

// ==================== VERIFY OLD PIN FOR CHANGE ====================
router.post('/verify-change-pin', verifyToken, async (req, res) => {
    try {
        const { current_pin } = req.body;
        const user = req.user;

        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Aᴜᴛʜᴇɴᴛɪᴄᴀᴛᴇᴅ'
            });
        }

        // Validate current PIN
        if (!current_pin) {
            return res.status(200).json({
                success: false,
                message: 'Cᴜʀʀᴇɴᴛ Pɪɴ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        if (current_pin.length !== 4) {
            return res.status(200).json({
                success: false,
                message: 'Pɪɴ Mᴜꜱᴛ Bᴇ Exᴀᴄᴛʟʏ 4 Dɪɢɪᴛꜱ'
            });
        }

        if (!/^\d{4}$/.test(current_pin)) {
            return res.status(200).json({
                success: false,
                message: 'Pɪɴ Mᴜꜱᴛ Cᴏɴᴛᴀɪɴ Oɴʟʏ Nᴜᴍᴇʀɪᴄ Dɪɢɪᴛꜱ'
            });
        }

        // Check if PIN is set
        if (!user.pin) {
            return res.status(200).json({
                success: false,
                message: 'Pɪɴ Hᴀꜱ Nᴏᴛ Bᴇᴇɴ Sᴇᴛ Yᴇᴛ'
            });
        }

        // Verify PIN
        const isValid = await bcrypt.compare(current_pin, user.pin);
        if (!isValid) {
            return res.status(200).json({
                success: false,
                message: 'Iɴᴄᴏʀʀᴇᴄᴛ Pɪɴ'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Pɪɴ Vᴇʀɪꜰɪᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ'
        });

    } catch (error) {
        console.error('Verify old PIN error:', error);
        res.status(200).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Vᴇʀɪꜰʏ Pɪɴ'
        });
    }
});

// ==================== CHECK PIN STATUS ====================
router.get('/check-pin-status', verifyToken, async (req, res) => {
    try {
        const user = req.user;

        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Aᴜᴛʜᴇɴᴛɪᴄᴀᴛᴇᴅ'
            });
        }

        res.status(200).json({
            success: true,
            hasPin: !!user.pin,
            pinSet: user.pin_set || false,
            isNewUser: user.isNewUser || false,
            message: user.pin ? 'Pɪɴ Iꜱ Sᴇᴛ' : 'Pɪɴ Iꜱ Nᴏᴛ Sᴇᴛ'
        });

    } catch (error) {
        console.error('Check PIN status error:', error);
        res.status(200).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Cʜᴇᴄᴋ Pɪɴ Sᴛᴀᴛᴜꜱ'
        });
    }
});

// ==================== FORGOT PIN - SEND OTP ====================
router.post('/forgot-pin-send-otp', verifyToken, async (req, res) => {
    try {
        const { tg_id } = req.body;
        const user = req.user;

        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Aᴜᴛʜᴇɴᴛɪᴄᴀᴛᴇᴅ'
            });
        }

        const dateTime = getCurrentDateTime();

        // Validate Telegram ID
        if (!tg_id) {
            return res.status(200).json({
                success: false,
                message: 'Tᴇʟᴇɢʀᴀᴍ Iᴅ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        // Check if PIN is set
        if (!user.pin) {
            return res.status(200).json({
                success: false,
                message: 'Pɪɴ Hᴀꜱ Nᴏᴛ Bᴇᴇɴ Sᴇᴛ Yᴇᴛ'
            });
        }

        // Verify Telegram ID matches
        if (user.telegramId !== tg_id) {
            return res.status(200).json({
                success: false,
                message: 'Tᴇʟᴇɢʀᴀᴍ Iᴅ Dᴏᴇꜱ Nᴏᴛ Mᴀᴛᴄʜ'
            });
        }

        // Check rate limiting (2 minutes between OTP requests)
        const lastOTPTime = user.lastOTPTime || 0;
        const timeSinceLastOTP = Date.now() - lastOTPTime;
        if (timeSinceLastOTP < 120000) {
            const remainingTime = Math.ceil((120000 - timeSinceLastOTP) / 1000);
            return res.status(200).json({
                success: false,
                message: `Pʟᴇᴀꜱᴇ ᴡᴀɪᴛ ${remainingTime} ꜱᴇᴄᴏɴᴅꜱ ʙᴇꜰᴏʀᴇ ʀᴇǫᴜᴇꜱᴛɪɴɢ ᴀɴᴏᴛʜᴇʀ Oᴛᴘ`
            });
        }

        // Generate OTP
        const otp = generateOTP();
        const expires = Date.now() + 5 * 60 * 1000;
        global.pinOtpStore.set(user._id.toString(), { otp, expires });

        // Update last OTP time
        user.lastOTPTime = Date.now();
        await user.save();

        // Auto-delete OTP after expiry
        setTimeout(() => {
            if (global.pinOtpStore?.get(user._id.toString())?.otp === otp) {
                global.pinOtpStore.delete(user._id.toString());
            }
        }, 5 * 60 * 1000);

        console.log(`📱 Forgot PIN OTP for ${user.mobile}: ${otp}`);

        // Send OTP via Telegram
        const otpMessage = 
`<b>─────────────</b>
<b>🔐 Pɪɴ Rᴇᴄᴏᴠᴇʀʏ Oᴛᴘ</b>
<b>─────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜʀ Pɪɴ Rᴇᴄᴏᴠᴇʀʏ Oᴛᴘ Hᴀꜱ Bᴇᴇɴ Gᴇɴᴇʀᴀᴛᴇᴅ.

<b>📲 Yᴏᴜʀ Oᴛᴘ:</b> <code>${otp}</code>
<b>⏳ Vᴀʟɪᴅɪᴛʏ:</b> 5 Mɪɴᴜᴛᴇꜱ
<b>🎯 Pᴜʀᴘᴏꜱᴇ:</b> Pɪɴ Rᴇᴄᴏᴠᴇʀʏ
<b>⏰ Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🔒 Dᴏ Nᴏᴛ Sʜᴀʀᴇ Tʜɪꜱ Oᴛᴘ Wɪᴛʜ Aɴʏᴏɴᴇ.
───────────────────────`;

        const result = await sendTelegramMessage(user.telegramId, otpMessage);

        if (!result.success) {
            console.error('Failed to send OTP via Telegram:', result.error);
            return res.status(200).json({
                success: false,
                message: 'Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Oᴛᴘ'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Oᴛᴘ Sᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ'
        });

    } catch (error) {
        console.error('Send forgot PIN OTP error:', error);
        res.status(200).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Oᴛᴘ'
        });
    }
});

// ==================== FORGOT PIN - VERIFY OTP ====================
router.post('/forgot-pin-verify-otp', verifyToken, async (req, res) => {
    try {
        const { otp } = req.body;
        const user = req.user;

        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Aᴜᴛʜᴇɴᴛɪᴄᴀᴛᴇᴅ'
            });
        }

        // Validate OTP
        if (!otp) {
            return res.status(200).json({
                success: false,
                message: 'Oᴛᴘ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        if (otp.length !== 6) {
            return res.status(200).json({
                success: false,
                message: 'Oᴛᴘ Mᴜꜱᴛ Bᴇ Exᴀᴄᴛʟʏ 6 Dɪɢɪᴛꜱ'
            });
        }

        if (!/^\d{6}$/.test(otp)) {
            return res.status(200).json({
                success: false,
                message: 'Oᴛᴘ Mᴜꜱᴛ Cᴏɴᴛᴀɪɴ Oɴʟʏ Nᴜᴍᴇʀɪᴄ Dɪɢɪᴛꜱ'
            });
        }

        // Check OTP
        const storedData = global.pinOtpStore?.get(user._id.toString());
        if (!storedData) {
            return res.status(200).json({
                success: false,
                message: 'Nᴏ Oᴛᴘ Fᴏᴜɴᴅ. Pʟᴇᴀꜱᴇ Rᴇǫᴜᴇꜱᴛ A Nᴇᴡ Oᴛᴘ.'
            });
        }

        if (storedData.otp !== otp) {
            return res.status(200).json({
                success: false,
                message: 'Iɴᴠᴀʟɪᴅ Oᴛᴘ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.'
            });
        }

        if (Date.now() > storedData.expires) {
            global.pinOtpStore.delete(user._id.toString());
            return res.status(200).json({
                success: false,
                message: 'Oᴛᴘ Exᴘɪʀᴇᴅ. Pʟᴇᴀꜱᴇ Rᴇǫᴜᴇꜱᴛ A Nᴇᴡ Oᴛᴘ.'
            });
        }

        // Clear OTP from store after verification
        global.pinOtpStore.delete(user._id.toString());

        console.log(`✅ OTP verified for user: ${user.mobile}`);

        res.status(200).json({
            success: true,
            message: 'Oᴛᴘ Vᴇʀɪꜰɪᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ'
        });

    } catch (error) {
        console.error('Verify forgot PIN OTP error:', error);
        res.status(200).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Vᴇʀɪꜰʏ Oᴛᴘ'
        });
    }
});

// ==================== FORGOT PIN - RESET PIN ====================
router.post('/forgot-pin-reset', verifyToken, async (req, res) => {
    try {
        const { new_pin } = req.body;
        const user = req.user;

        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Aᴜᴛʜᴇɴᴛɪᴄᴀᴛᴇᴅ'
            });
        }

        const dateTime = getCurrentDateTime();

        // Validate new PIN
        if (!new_pin) {
            return res.status(200).json({
                success: false,
                message: 'Nᴇᴡ Pɪɴ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        if (new_pin.length !== 4) {
            return res.status(200).json({
                success: false,
                message: 'Nᴇᴡ Pɪɴ Mᴜꜱᴛ Bᴇ Exᴀᴄᴛʟʏ 4 Dɪɢɪᴛꜱ'
            });
        }

        if (!/^\d{4}$/.test(new_pin)) {
            return res.status(200).json({
                success: false,
                message: 'Nᴇᴡ Pɪɴ Mᴜꜱᴛ Cᴏɴᴛᴀɪɴ Oɴʟʏ Nᴜᴍᴇʀɪᴄ Dɪɢɪᴛꜱ'
            });
        }

        // Hash and save new PIN
        const hashedPin = await bcrypt.hash(new_pin, 12);
        user.pin = hashedPin;
        user.pin_set = true;
        await user.save();

        console.log(`✅ PIN reset successful for user: ${user.mobile}`);

        // Send confirmation via Telegram
        if (user.telegramId) {
            const message = 
`<b>─────────────────</b>
<b>✅ Pɪɴ Rᴇꜱᴇᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜʀ Pɪɴ Hᴀꜱ Bᴇᴇɴ Rᴇꜱᴇᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ.

<b>🔄 Pɪɴ Sᴛᴀᴛᴜꜱ:</b> ✅ Rᴇꜱᴇᴛ
<b>⏰ Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🔒 Iꜰ Tʜɪꜱ Wᴀꜱɴ'ᴛ Yᴏᴜ, Pʟᴇᴀꜱᴇ Cᴏɴᴛᴀᴄᴛ Sᴜᴘᴘᴏʀᴛ Iᴍᴍᴇᴅɪᴀᴛᴇʟʏ.
───────────────────────`;
            
            await sendTelegramMessage(user.telegramId, message);
        }

        res.status(200).json({
            success: true,
            message: 'Pɪɴ Rᴇꜱᴇᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ'
        });

    } catch (error) {
        console.error('Reset PIN error:', error);
        res.status(200).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Rᴇꜱᴇᴛ Pɪɴ'
        });
    }
});

// ==================== REMOVE PIN (Admin Only) ====================
router.delete('/remove-pin', verifyToken, async (req, res) => {
    try {
        const user = req.user;

        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Aᴜᴛʜᴇɴᴛɪᴄᴀᴛᴇᴅ'
            });
        }

        // Check if user is admin
        if (!user.isAdmin) {
            return res.status(200).json({
                success: false,
                message: 'Aᴅᴍɪɴ Aᴄᴄᴇꜱꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        user.pin = null;
        user.pin_set = false;
        await user.save();

        res.status(200).json({
            success: true,
            message: 'Pɪɴ Rᴇᴍᴏᴠᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ'
        });

    } catch (error) {
        console.error('Remove PIN error:', error);
        res.status(200).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Rᴇᴍᴏᴠᴇ Pɪɴ'
        });
    }
});

module.exports = router;
