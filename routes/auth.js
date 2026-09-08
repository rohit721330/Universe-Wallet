// FILE: routes/auth.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
require('dotenv').config();

// ===== INITIALIZE GLOBAL STORES =====
if (!global.loginOtpStore) {
    global.loginOtpStore = new Map();
}
if (!global.regOtpStore) {
    global.regOtpStore = new Map();
}
if (!global.resetOtpStore) {
    global.resetOtpStore = new Map();
}
// ====================================

// Rate limiters
const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Tᴏᴏ Mᴀɴʏ Oᴛᴘ Rᴇǫᴜᴇꜱᴛꜱ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ Lᴀᴛᴇʀ.' }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: 'Tᴏᴏ Mᴀɴʏ Lᴏɢɪɴ Aᴛᴛᴇᴍᴘᴛꜱ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ Lᴀᴛᴇʀ.' }
});

// Telegram Bot Configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID;
const JWT_SECRET = process.env.JWT_SECRET;

// Validate required environment variables
if (!BOT_TOKEN) {
    console.error('❌ Bᴏᴛ Tᴏᴋᴇɴ Iꜱ Nᴏᴛ Sᴇᴛ Iɴ Eɴᴠɪʀᴏɴᴍᴇɴᴛ Vᴀʀɪᴀʙʟᴇꜱ.');
}
if (!ADMIN_TG_ID) {
    console.error('❌ Aᴅᴍɪɴ Tɢ Iᴅ Iꜱ Nᴏᴛ Sᴇᴛ Iɴ Eɴᴠɪʀᴏɴᴍᴇɴᴛ Vᴀʀɪᴀʙʟᴇꜱ.');
}
if (!JWT_SECRET) {
    console.error('❌ Jᴡᴛ Sᴇᴄʀᴇᴛ Iꜱ Nᴏᴛ Sᴇᴛ Iɴ Eɴᴠɪʀᴏɴᴍᴇɴᴛ Vᴀʀɪᴀʙʟᴇꜱ.');
}

// ==================== VERIFY TOKEN (Middleware) ====================
const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(200).json({ 
                success: false, 
                message: 'Nᴏ Tᴏᴋᴇɴ Pʀᴏᴠɪᴅᴇᴅ' 
            });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (!user) {
            return res.status(200).json({ 
                success: false, 
                message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ' 
            });
        }
        
        req.user = user;
        next();
    } catch (error) {
        console.error('Uɴᴋɴᴏᴡɴ Eʀʀᴏʀ:', error);
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
            message: 'Aᴜᴛʜ Eʀʀᴏʀ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.' 
        });
    }
};

// ==================== HELPER FUNCTIONS ====================
// Helper: Send message via Telegram with improved reliability
async function sendTelegramMessage(chatId, message) {
    if (!BOT_TOKEN) {
        console.error('❌ Cᴀɴ\'ᴛ Sᴇɴᴅ Tᴇʟᴇɢʀᴀᴍ Mᴇꜱꜱᴀɢᴇ. Bᴏᴛ Tᴏᴋᴇɴ Nᴏᴛ Sᴇᴛ.');
        return { success: false, error: 'BOT_TOKEN not configured' };
    }

    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        console.log('📤 Sᴇɴᴅɪɴɢ Tᴇʟᴇɢʀᴀᴍ Mᴇꜱꜱᴀɢᴇ Tᴏ Cʜᴀᴛ:', chatId);
        
        const response = await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        }, {
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data && response.data.ok) {
            console.log('✅ Tᴇʟᴇɢʀᴀᴍ Mᴇꜱꜱᴀɢᴇ Sᴇɴᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ Tᴏ Cʜᴀᴛ:', chatId);
            return { success: true };
        } else {
            console.error('❌ Tᴇʟᴇɢʀᴀᴍ Aᴘɪ Rᴇꜱᴘᴏɴꜱᴇ:', response.data?.description || 'Uɴᴋɴᴏᴡɴ Eʀʀᴏʀ');
            return { success: false, error: response.data?.description || 'Uɴᴋɴᴏᴡɴ Eʀʀᴏʀ' };
        }
    } catch (error) {
        console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Tᴇʟᴇɢʀᴀᴍ Mᴇꜱꜱᴀɢᴇ:', error.message);
        if (error.response) {
            console.error('Tᴇʟᴇɢʀᴀᴍ Aᴘɪ Rᴇꜱᴘᴏɴꜱᴇ:', error.response.data);
        }
        if (error.code === 'ECONNABORTED') {
            return { success: false, error: 'Tᴇʟᴇɢʀᴀᴍ Aᴘɪ Tɪᴍᴇ Oᴜᴛ' };
        }
        return { success: false, error: error.message };
    }
}

// Helper: Generate OTP
function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper: Generate Wallet ID
function generateWalletId() {
    const prefix = 'PW';
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let letterPart = '';
    for (let i = 0; i < 2; i++) {
        letterPart += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    let numberPart = '';
    for (let i = 0; i < 6; i++) {
        numberPart += Math.floor(Math.random() * 10).toString();
    }
    return prefix + letterPart + numberPart;
}

// Helper: Generate API Key
function generateApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 10; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
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

// Helper: Get client IP
function getClientIp(req) {
    return req.headers['x-forwarded-for'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress || 
           req.ip || 
           'Unknown';
}

// Helper: Clean expired OTPs
function cleanExpiredOtps() {
    const now = Date.now();
    const stores = [global.loginOtpStore, global.regOtpStore, global.resetOtpStore];
    stores.forEach(store => {
        if (store) {
            for (const [key, value] of store.entries()) {
                if (value.expires && value.expires < now) {
                    store.delete(key);
                }
            }
        }
    });
}

// Run cleanup every 5 minutes
setInterval(cleanExpiredOtps, 5 * 60 * 1000);

// ==================== VERIFY OTP ENDPOINT ====================
router.post('/verify-otp', async (req, res) => {
    try {
        const { mobile, telegramId, otp } = req.body;
        
        console.log('🔍 Vᴇʀɪꜰʏ Oᴛᴘ Rᴇǫᴜᴇꜱᴛ:', { mobile, telegramId, otp });
        
        if (!otp) {
            return res.status(200).json({ 
                success: false,
                message: 'Oᴛᴘ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }
        
        let storedData = null;
        let identifier = null;
        let user = null;
        
        if (mobile) {
            user = await User.findOne({ mobile });
            if (!user) {
                return res.status(200).json({ 
                    success: false,
                    message: 'Nᴏ Aᴄᴄᴏᴜɴᴛ Fᴏᴜɴᴅ Wɪᴛʜ Tʜɪꜱ Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ'
                });
            }
            storedData = global.resetOtpStore?.get(mobile);
            identifier = mobile;
        } else if (telegramId) {
            user = await User.findOne({ telegramId });
            if (!user) {
                return res.status(200).json({ 
                    success: false,
                    message: 'Nᴏ Aᴄᴄᴏᴜɴᴛ Fᴏᴜɴᴅ Wɪᴛʜ Tʜɪꜱ Tᴇʟᴇɢʀᴀᴍ Iᴅ'
                });
            }
            storedData = global.resetOtpStore?.get(telegramId);
            identifier = telegramId;
        } else {
            return res.status(200).json({ 
                success: false,
                message: 'Mᴏʙɪʟᴇ Oʀ Tᴇʟᴇɢʀᴀᴍ Iᴅ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }
        
        console.log('📦 Sᴛᴏʀᴇᴅ Dᴀᴛᴀ:', storedData);
        console.log('🔑 Iᴅᴇɴᴛɪꜰɪᴇʀ:', identifier);
        
        if (!storedData) {
            return res.status(200).json({ 
                success: false,
                message: 'Nᴏ Oᴛᴘ Fᴏᴜɴᴅ. Pʟᴇᴀꜱᴇ Rᴇǫᴜᴇꜱᴛ A Nᴇᴡ Oᴛᴘ'
            });
        }
        
        if (storedData.otp !== otp) {
            return res.status(200).json({ 
                success: false,
                message: 'Iɴᴠᴀʟɪᴅ Oᴛᴘ. Pʟᴇᴀꜱᴇ Eɴᴛᴇʀ Tʜᴇ Cᴏʀʀᴇᴄᴛ 6-Dɪɢɪᴛ Cᴏᴅᴇ'
            });
        }
        
        if (Date.now() > storedData.expires) {
            global.resetOtpStore.delete(identifier);
            return res.status(200).json({ 
                success: false,
                message: 'Oᴛᴘ Exᴘɪʀᴇᴅ. Pʟᴇᴀꜱᴇ Rᴇǫᴜᴇꜱᴛ A Nᴇᴡ Oᴛᴘ'
            });
        }
        
        res.status(200).json({ 
            success: true, 
            verified: true,
            message: 'Oᴛᴘ Vᴇʀɪꜰɪᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ'
        });
        
    } catch (error) {
        console.error('❌ Vᴇʀɪꜰʏ Oᴛᴘ Eʀʀᴏʀ:', error);
        res.status(200).json({ 
            success: false,
            message: 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ'
        });
    }
});

// ==================== LOGIN WITH PASSWORD ====================
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { mobile, password } = req.body;
        const clientIp = getClientIp(req);
        const dateTime = getCurrentDateTime();
        
        if (!mobile || !password) {
            return res.status(200).json({ 
                success: false,
                message: 'Mᴏʙɪʟᴇ & Pᴀꜱꜱᴡᴏʀᴅ Rᴇǫᴜɪʀᴇᴅ'
            });
        }
        
        const user = await User.findOne({ mobile });
        if (!user) {
            return res.status(200).json({ 
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ. Pʟᴇᴀꜱᴇ Cʜᴇᴄᴋ Yᴏᴜʀ Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ.'
            });
        }
        
        const isValid = await user.comparePassword(password);
        
        if (!isValid) {
            return res.status(200).json({ 
                success: false,
                message: 'Iɴᴠᴀʟɪᴅ Pᴀꜱꜱᴡᴏʀᴅ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.'
            });
        }
        
        if (user.isBlocked) {
            return res.status(200).json({ 
                success: false,
                message: 'Yᴏᴜʀ Aᴄᴄᴏᴜɴᴛ Hᴀꜱ Bᴇᴇɴ Bʟᴏᴄᴋᴇᴅ. Pʟᴇᴀꜱᴇ Cᴏɴᴛᴀᴄᴛ Sᴜᴘᴘᴏʀᴛ.'
            });
        }
        
        const token = jwt.sign(
            { userId: user._id, isAdmin: user.isAdmin },
            JWT_SECRET,
            { expiresIn: '90d' }
        );
        
        // Send login notification via Telegram
        if (user.telegramId && BOT_TOKEN) {
            const loginMessage = 
`<b>─────────────────</b>
<b>🚨 Nᴇᴡ Lᴏɢɪɴ Dᴇᴛᴇᴄᴛᴇᴅ!</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> A Nᴇᴡ Lᴏɢɪɴ Wᴀꜱ Dᴇᴛᴇᴄᴛᴇᴅ Oɴ Yᴏᴜʀ Aᴄᴄᴏᴜɴᴛ.

<b>📱 Mᴏʙɪʟᴇ:</b> ${user.mobile}
<b>🔰 Pᴜʀᴘᴏꜱᴇ:</b> Pᴀꜱꜱᴡᴏʀᴅ Lᴏɢɪɴ
<b>🌐 Iᴘ:</b> ${clientIp}
<b>⏰ Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
⚠️ Iꜰ Tʜɪꜱ Wᴀꜱɴ'ᴛ Yᴏᴜ, Cʜᴀɴɢᴇ Yᴏᴜʀ Pᴀꜱꜱᴡᴏʀᴅ Iᴍᴍᴇᴅɪᴀᴛᴇʟʏ Oʀ Cᴏɴᴛᴀᴄᴛ Sᴜᴘᴘᴏʀᴛ Tᴇᴀᴍ!
───────────────────────`;
            
            sendTelegramMessage(user.telegramId, loginMessage).catch(err => {
                console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Lᴏɢɪɴ Aʟᴇʀᴛ:', err);
            });
        }
        
        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id,
                fullName: user.fullName,
                mobile: user.mobile,
                walletId: user.walletId,
                balance: user.balance,
                isAdmin: user.isAdmin,
                pin_set: user.pin_set,
                isNewUser: user.isNewUser || false
            }
        });
    } catch (error) {
        console.error('❌ Lᴏɢɪɴ Eʀʀᴏʀ:', error);
        res.status(200).json({ 
            success: false,
            message: 'Lᴏɢɪɴ Fᴀɪʟᴇᴅ. Pʟᴇᴀꜱᴇ Cʜᴇᴄᴋ Yᴏᴜʀ Cᴏɴɴᴇᴄᴛɪᴏɴ Aɴᴅ Tʀʏ Aɢᴀɪɴ.'
        });
    }
});

// ==================== LOGIN WITH OTP ====================
router.post('/login-with-otp', loginLimiter, async (req, res) => {
    try {
        const { mobile, otp } = req.body;
        const clientIp = getClientIp(req);
        const dateTime = getCurrentDateTime();
        
        if (!mobile || !otp) {
            return res.status(200).json({ 
                success: false,
                message: 'Mᴏʙɪʟᴇ & Oᴛᴘ Rᴇǫᴜɪʀᴇᴅ'
            });
        }
        
        const storedData = global.loginOtpStore?.get(mobile);
        if (!storedData) {
            return res.status(200).json({ 
                success: false,
                message: 'Nᴏ Oᴛᴘ Fᴏᴜɴᴅ. Pʟᴇᴀꜱᴇ Rᴇǫᴜᴇꜱᴛ A Nᴇᴡ Oᴛᴘ Bʏ Cʟɪᴄᴋɪɴɢ "Sᴇɴᴅ Oᴛᴘ".'
            });
        }
        
        if (storedData.otp !== otp) {
            return res.status(200).json({ 
                success: false,
                message: 'Iɴᴠᴀʟɪᴅ Oᴛᴘ. Pʟᴇᴀꜱᴇ Eɴᴛᴇʀ Tʜᴇ Cᴏʀʀᴇᴄᴛ 6-Dɪɢɪᴛ Cᴏᴅᴇ.'
            });
        }
        
        if (Date.now() > storedData.expires) {
            global.loginOtpStore.delete(mobile);
            return res.status(200).json({ 
                success: false,
                message: 'Oᴛᴘ Exᴘɪʀᴇᴅ. Pʟᴇᴀꜱᴇ Rᴇǫᴜᴇꜱᴛ A Nᴇᴡ Oᴛᴘ.'
            });
        }
        
        const user = await User.findOne({ mobile });
        if (!user) {
            return res.status(200).json({ 
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ. Pʟᴇᴀꜱᴇ Cʜᴇᴄᴋ Yᴏᴜʀ Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ.'
            });
        }
        
        if (user.isBlocked) {
            return res.status(200).json({ 
                success: false,
                message: 'Yᴏᴜʀ Aᴄᴄᴏᴜɴᴛ Hᴀꜱ Bᴇᴇɴ Bʟᴏᴄᴋᴇᴅ. Pʟᴇᴀꜱᴇ Cᴏɴᴛᴀᴄᴛ Sᴜᴘᴘᴏʀᴛ.'
            });
        }
        
        global.loginOtpStore.delete(mobile);
        
        const token = jwt.sign(
            { userId: user._id, isAdmin: user.isAdmin },
            JWT_SECRET,
            { expiresIn: '90d' }
        );
        
        // Send login notification via Telegram
        if (user.telegramId && BOT_TOKEN) {
            const loginMessage = 
`<b>─────────────────</b>
<b>🚨 Nᴇᴡ Lᴏɢɪɴ Dᴇᴛᴇᴄᴛᴇᴅ!</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> A Nᴇᴡ Lᴏɢɪɴ Wᴀꜱ Dᴇᴛᴇᴄᴛᴇᴅ Oɴ Yᴏᴜʀ Aᴄᴄᴏᴜɴᴛ.

<b>📱 Mᴏʙɪʟᴇ:</b> ${user.mobile}
<b>🔰 Pᴜʀᴘᴏꜱᴇ:</b> OTP Lᴏɢɪɴ
<b>🌐 Iᴘ:</b> ${clientIp}
<b>⏰ Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
⚠️ Iꜰ Tʜɪꜱ Wᴀꜱɴ'ᴛ Yᴏᴜ, Cʜᴀɴɢᴇ Yᴏᴜʀ Pᴀꜱꜱᴡᴏʀᴅ Iᴍᴍᴇᴅɪᴀᴛᴇʟʏ Oʀ Cᴏɴᴛᴀᴄᴛ Sᴜᴘᴘᴏʀᴛ Tᴇᴀᴍ!
───────────────────────`;
            
            sendTelegramMessage(user.telegramId, loginMessage).catch(err => {
                console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Lᴏɢɪɴ Aʟᴇʀᴛ:', err);
            });
        }
        
        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id,
                fullName: user.fullName,
                mobile: user.mobile,
                walletId: user.walletId,
                balance: user.balance,
                isAdmin: user.isAdmin,
                pin_set: user.pin_set,
                isNewUser: user.isNewUser || false
            }
        });
    } catch (error) {
        console.error('❌ Lᴏɢɪɴ Wɪᴛʜ Oᴛᴘ Eʀʀᴏʀ:', error);
        res.status(200).json({ 
            success: false,
            message: 'Lᴏɢɪɴ Wɪᴛʜ Oᴛᴘ Fᴀɪʟᴇᴅ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.'
        });
    }
});

// ==================== SEND OTP FOR LOGIN ====================
router.post('/send-login-otp', otpLimiter, async (req, res) => {
    try {
        const { mobile } = req.body;
        const dateTime = getCurrentDateTime();
        
        console.log('📱 Lᴏɢɪɴ Oᴛᴘ Rᴇǫᴜᴇꜱᴛ Fᴏʀ Mᴏʙɪʟᴇ:', mobile);
        
        if (!mobile || !/^\d{10}$/.test(mobile)) {
            return res.status(200).json({ 
                success: false,
                message: 'Pʟᴇᴀꜱᴇ Eɴᴛᴇʀ A Vᴀʟɪᴅ 10-Dɪɢɪᴛ Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ.'
            });
        }
        
        const user = await User.findOne({ mobile });
        if (!user) {
            return res.status(200).json({ 
                success: false,
                message: 'Nᴏ Aᴄᴄᴏᴜɴᴛ Fᴏᴜɴᴅ Wɪᴛʜ Tʜɪꜱ Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ. Pʟᴇᴀꜱᴇ Rᴇɢɪꜱᴛᴇʀ Fɪʀꜱᴛ.'
            });
        }
        
        if (!user.telegramId) {
            return res.status(200).json({ 
                success: false,
                message: 'Tᴇʟᴇɢʀᴀᴍ Iᴅ Nᴏᴛ Lɪɴᴋᴇᴅ Tᴏ Yᴏᴜʀ Aᴄᴄᴏᴜɴᴛ. Pʟᴇᴀꜱᴇ Lɪɴᴋ Yᴏᴜʀ Tᴇʟᴇɢʀᴀᴍ Iᴅ Fɪʀꜱᴛ.'
            });
        }

        if (!BOT_TOKEN) {
            return res.status(200).json({ 
                success: false,
                message: 'Oᴛᴘ Sᴇʀᴠɪᴄᴇ Iꜱ Nᴏᴛ Cᴏɴꜰɪɢᴜʀᴇᴅ. Pʟᴇᴀꜱᴇ Cᴏɴᴛᴀᴄᴛ Sᴜᴘᴘᴏʀᴛ.'
            });
        }
        
        const otp = generateOTP();
        const expires = Date.now() + 5 * 60 * 1000;
        global.loginOtpStore.set(mobile, { otp, expires });
        
        console.log(`📱 Lᴏɢɪɴ Oᴛᴘ Fᴏʀ ${mobile}: ${otp}`);
        
        const otpMessage = 
`<b>─────────────</b>
<b>🔐 Oᴛᴘ Sᴇᴄᴛɪᴏɴ</b>
<b>─────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜʀ Oɴᴇ Tɪᴍᴇ Pᴀꜱꜱᴡᴏʀᴅ Hᴀꜱ Bᴇᴇɴ Gᴇɴᴇʀᴀᴛᴇᴅ.

<b>📲 Yᴏᴜʀ Oᴛᴘ:</b> <code>${otp}</code>
<b>⏳ Vᴀʟɪᴅɪᴛʏ:</b> 5 Mɪɴᴜᴛᴇꜱ
<b>🎯 Pᴜʀᴘᴏꜱᴇ:</b> Lᴏɢɪɴ
<b>⏰ Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🔒 Dᴏ Nᴏᴛ Sʜᴀʀᴇ Tʜɪꜱ Oᴛᴘ Wɪᴛʜ Aɴʏᴏɴᴇ.
⚠️ Iꜰ Tʜɪꜱ Wᴀꜱɴ'ᴛ Yᴏᴜ, Cᴏɴᴛᴀᴄᴛ Sᴜᴘᴘᴏʀᴛ Tᴇᴀᴍ!
───────────────────────`;
        
        const result = await sendTelegramMessage(user.telegramId, otpMessage);
        
        if (!result.success) {
            console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Oᴛᴘ Vɪᴀ Tᴇʟᴇɢʀᴀᴍ:', result.error);
            global.loginOtpStore.delete(mobile);
            
            if (result.error === 'Tᴇʟᴇɢʀᴀᴍ Aᴘɪ Tɪᴍᴇ Oᴜᴛ' || result.error.includes('ECONN')) {
                return res.status(200).json({ 
                    success: false,
                    message: 'Tᴇʟᴇɢʀᴀᴍ Sᴇʀᴠɪᴄᴇ Iꜱ Uɴᴀᴠᴀɪʟᴀʙʟᴇ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ Iɴ A Fᴇᴡ Mᴏᴍᴇɴᴛꜱ.'
                });
            }
            
            return res.status(200).json({ 
                success: false,
                message: 'Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Oᴛᴘ. Pʟᴇᴀꜱᴇ Mᴀᴋᴇ Sᴜʀᴇ Yᴏᴜ Hᴀᴠᴇ Sᴛᴀʀᴛᴇᴅ Tʜᴇ Bᴏᴛ (@Prime_Alerts_Ibot) Aɴᴅ Tʀʏ Aɢᴀɪɴ.'
            });
        }
        
        console.log('✅ Oᴛᴘ Sᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ Tᴏ:', user.telegramId);
        
        res.status(200).json({ 
            success: true, 
            message: 'Oᴛᴘ Sᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ Tᴏ Yᴏᴜʀ Tᴇʟᴇɢʀᴀᴍ'
        });
        
    } catch (error) {
        console.error('❌ Sᴇɴᴅ Lᴏɢɪɴ Oᴛᴘ Eʀʀᴏʀ:', error);
        res.status(200).json({ 
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Oᴛᴘ. Pʟᴇᴀꜱᴇ Cʜᴇᴄᴋ Yᴏᴜʀ Cᴏɴɴᴇᴄᴛɪᴏɴ Aɴᴅ Tʀʏ Aɢᴀɪɴ.'
        });
    }
});

// ==================== SEND OTP FOR REGISTRATION ====================
router.post('/send-registration-otp', otpLimiter, async (req, res) => {
    try {
        const { tg_id, name } = req.body;
        const dateTime = getCurrentDateTime();
        
        console.log('📝 Rᴇɢɪꜱᴛʀᴀᴛɪᴏɴ Oᴛᴘ Rᴇǫᴜᴇꜱᴛ:', { tg_id, name });
        
        if (!tg_id) {
            return res.status(200).json({ 
                success: false,
                message: 'Tᴇʟᴇɢʀᴀᴍ Iᴅ Iꜱ Rᴇǫᴜɪʀᴇᴅ. Pʟᴇᴀꜱᴇ Eɴᴛᴇʀ Yᴏᴜʀ Tᴇʟᴇɢʀᴀᴍ Iᴅ.'
            });
        }
        
        const existingUser = await User.findOne({ telegramId: tg_id });
        if (existingUser) {
            return res.status(200).json({ 
                success: false,
                message: 'Tʜɪꜱ Tᴇʟᴇɢʀᴀᴍ Iᴅ Iꜱ Aʟʀᴇᴀᴅʏ Rᴇɢɪꜱᴛᴇʀᴇᴅ. Pʟᴇᴀꜱᴇ Uꜱᴇ A Dɪꜰꜰᴇʀᴇɴᴛ Iᴅ Oʀ Lᴏɢɪɴ.'
            });
        }

        if (!BOT_TOKEN) {
            return res.status(200).json({ 
                success: false,
                message: 'Oᴛᴘ Sᴇʀᴠɪᴄᴇ Iꜱ Nᴏᴛ Cᴏɴꜰɪɢᴜʀᴇᴅ. Pʟᴇᴀꜱᴇ Cᴏɴᴛᴀᴄᴛ Sᴜᴘᴘᴏʀᴛ.'
            });
        }
        
        const otp = generateOTP();
        const expires = Date.now() + 5 * 60 * 1000;
        global.regOtpStore.set(tg_id, { otp, expires });
        
        console.log(`📱 Rᴇɢɪꜱᴛʀᴀᴛɪᴏɴ Oᴛᴘ Fᴏʀ ${tg_id}: ${otp}`);
        
        const otpMessage = 
`<b>─────────────</b>
<b>🔐 Oᴛᴘ Sᴇᴄᴛɪᴏɴ</b>
<b>─────────────</b>

<b>👤 Dᴇᴀʀ ${name || 'User'},</b> Yᴏᴜʀ Oɴᴇ Tɪᴍᴇ Pᴀꜱꜱᴡᴏʀᴅ Hᴀꜱ Bᴇᴇɴ Gᴇɴᴇʀᴀᴛᴇᴅ.

<b>📲 Yᴏᴜʀ Oᴛᴘ:</b> <code>${otp}</code>
<b>⏳ Vᴀʟɪᴅɪᴛʏ:</b> 5 Mɪɴᴜᴛᴇꜱ
<b>🎯 Pᴜʀᴘᴏꜱᴇ:</b> Rᴇɢɪꜱᴛʀᴀᴛɪᴏɴ
<b>⏰ Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🔒 Dᴏ Nᴏᴛ Sʜᴀʀᴇ Tʜɪꜱ Oᴛᴘ Wɪᴛʜ Aɴʏᴏɴᴇ.
───────────────────────`;
        
        const result = await sendTelegramMessage(tg_id, otpMessage);
        
        if (!result.success) {
            console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Oᴛᴘ Vɪᴀ Tᴇʟᴇɢʀᴀᴍ:', result.error);
            global.regOtpStore.delete(tg_id);
            
            if (result.error === 'Tᴇʟᴇɢʀᴀᴍ Aᴘɪ Tɪᴍᴇ Oᴜᴛ' || result.error.includes('ECONN')) {
                return res.status(200).json({ 
                    success: false,
                    message: 'Tᴇʟᴇɢʀᴀᴍ Sᴇʀᴠɪᴄᴇ Iꜱ Uɴᴀᴠᴀɪʟᴀʙʟᴇ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ Iɴ A Fᴇᴡ Mᴏᴍᴇɴᴛꜱ.'
                });
            }
            
            return res.status(200).json({ 
                success: false,
                message: 'Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Oᴛᴘ. Pʟᴇᴀꜱᴇ Mᴀᴋᴇ Sᴜʀᴇ Yᴏᴜ Hᴀᴠᴇ Sᴛᴀʀᴛᴇᴅ Tʜᴇ Bᴏᴛ (@Prime_Alerts_Ibot) Aɴᴅ Tʀʏ Aɢᴀɪɴ.'
            });
        }
        
        console.log('✅ Rᴇɢɪꜱᴛʀᴀᴛɪᴏɴ Oᴛᴘ Sᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ Tᴏ:', tg_id);
        
        res.status(200).json({ 
            success: true, 
            message: 'Oᴛᴘ Sᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ Tᴏ Yᴏᴜʀ Tᴇʟᴇɢʀᴀᴍ'
        });
        
    } catch (error) {
        console.error('❌ Sᴇɴᴅ Rᴇɢɪꜱᴛʀᴀᴛɪᴏɴ Oᴛᴘ Eʀʀᴏʀ:', error);
        res.status(200).json({ 
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Oᴛᴘ. Pʟᴇᴀꜱᴇ Cʜᴇᴄᴋ Yᴏᴜʀ Cᴏɴɴᴇᴄᴛɪᴏɴ Aɴᴅ Tʀʏ Aɢᴀɪɴ.'
        });
    }
});

// ==================== REGISTER NEW USER ====================
router.post('/register', async (req, res) => {
    try {
        const { name, mobile, password, tg_id, otp } = req.body;
        const dateTime = getCurrentDateTime();
        
        console.log('📝 Rᴇɢɪꜱᴛʀᴀᴛɪᴏɴ Rᴇǫᴜᴇꜱᴛ Rᴇᴄᴇɪᴠᴇᴅ:', { 
            name, mobile, tg_id, otp: otp ? '✅ Pʀᴏᴠɪᴅᴇᴅ' : '❌ Mɪꜱꜱɪɴɢ', 
            password: password ? '✅ Pʀᴏᴠɪᴅᴇᴅ' : '❌ Mɪꜱꜱɪɴɢ' 
        });
        
        if (!name || !mobile || !password || !tg_id || !otp) {
            const missing = [];
            if (!name) missing.push('Nᴀᴍᴇ');
            if (!mobile) missing.push('Mᴏʙɪʟᴇ');
            if (!password) missing.push('Pᴀꜱꜱᴡᴏʀᴅ');
            if (!tg_id) missing.push('Tᴇʟᴇɢʀᴀᴍ Iᴅ');
            if (!otp) missing.push('Oᴛᴘ');
            
            return res.status(200).json({ 
                success: false,
                message: `Mɪꜱꜱɪɴɢ Fɪᴇʟᴅꜱ: ${missing.join(', ')}`
            });
        }
        
        // Check if mobile starts with 9, 8, or 7
        if (!/^[9|8|7][0-9]{9}$/.test(mobile)) {
            return res.status(200).json({ 
                success: false,
                message: 'Iɴᴠᴀʟɪᴅ Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ. Mᴏʙɪʟᴇ Mᴜꜱᴛ Sᴛᴀʀᴛ Wɪᴛʜ 9, 8, Oʀ 7.'
            });
        }
        
        if (password.length < 8 || password.length > 15) {
            return res.status(200).json({ 
                success: false,
                message: 'Pᴀꜱꜱᴡᴏʀᴅ Mᴜꜱᴛ Bᴇ 8-15 Cʜᴀʀᴀᴄᴛᴇʀꜱ Lᴏɴɢ.'
            });
        }
        
        const hasUppercase = /[A-Z]/.test(password);
        const hasLowercase = /[a-z]/.test(password);
        const hasNumber = /[0-9]/.test(password);
        
        if (!hasUppercase || !hasLowercase || !hasNumber) {
            return res.status(200).json({ 
                success: false,
                message: 'Pᴀꜱꜱᴡᴏʀᴅ Mᴜꜱᴛ Cᴏɴᴛᴀɪɴ Uᴘᴘᴇʀᴄᴀꜱᴇ, Lᴏᴡᴇʀᴄᴀꜱᴇ, Aɴᴅ Nᴜᴍʙᴇʀ.'
            });
        }
        
        const storedData = global.regOtpStore?.get(tg_id);
        console.log('📦 Sᴛᴏʀᴇᴅ Oᴛᴘ Dᴀᴛᴀ:', storedData ? 'Fᴏᴜɴᴅ' : 'Nᴏᴛ Fᴏᴜɴᴅ');
        
        if (!storedData) {
            return res.status(200).json({ 
                success: false,
                message: 'Pʟᴇᴀꜱᴇ Rᴇǫᴜᴇꜱᴛ Aɴ Oᴛᴘ Fɪʀꜱᴛ Bʏ Cʟɪᴄᴋɪɴɢ "Sᴇɴᴅ Oᴛᴘ".'
            });
        }
        
        console.log('🔍 Cᴏᴍᴘᴀʀɪɴɢ Oᴛᴘ:', { 
            provided: otp, 
            stored: storedData.otp,
            matches: storedData.otp === otp,
            expired: Date.now() > storedData.expires
        });
        
        if (storedData.otp !== otp) {
            return res.status(200).json({ 
                success: false,
                message: 'Iɴᴠᴀʟɪᴅ Oᴛᴘ. Pʟᴇᴀꜱᴇ Eɴᴛᴇʀ Tʜᴇ Cᴏʀʀᴇᴄᴛ 6-Dɪɢɪᴛ Cᴏᴅᴇ.'
            });
        }
        
        if (Date.now() > storedData.expires) {
            global.regOtpStore.delete(tg_id);
            return res.status(200).json({ 
                success: false,
                message: 'Oᴛᴘ Exᴘɪʀᴇᴅ. Pʟᴇᴀꜱᴇ Rᴇǫᴜᴇꜱᴛ A Nᴇᴡ Oᴛᴘ.'
            });
        }
        
        const existingUser = await User.findOne({ $or: [{ mobile }, { telegramId: tg_id }] });
        if (existingUser) {
            let errorMsg = 'Uꜱᴇʀ Aʟʀᴇᴀᴅʏ Exɪꜱᴛꜱ';
            if (existingUser.mobile === mobile && existingUser.telegramId === tg_id) {
                errorMsg = 'Uꜱᴇʀ Aʟʀᴇᴀᴅʏ Exɪꜱᴛꜱ Wɪᴛʜ Tʜɪꜱ Mᴏʙɪʟᴇ Aɴᴅ Tᴇʟᴇɢʀᴀᴍ Iᴅ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ.';
            } else if (existingUser.mobile === mobile) {
                errorMsg = 'Tʜɪꜱ Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ Iꜱ Aʟʀᴇᴀᴅʏ Rᴇɢɪꜱᴛᴇʀᴇᴅ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ.';
            } else if (existingUser.telegramId === tg_id) {
                errorMsg = 'Tʜɪꜱ Tᴇʟᴇɢʀᴀᴍ Iᴅ Iꜱ Aʟʀᴇᴀᴅʏ Rᴇɢɪꜱᴛᴇʀᴇᴅ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ.';
            }
            return res.status(200).json({ 
                success: false,
                message: errorMsg
            });
        }
        
        let walletId = generateWalletId();
        let walletIdExists = await User.findOne({ walletId });
        while (walletIdExists) {
            walletId = generateWalletId();
            walletIdExists = await User.findOne({ walletId });
        }
        
        let apiKey = generateApiKey();
        let apiKeyExists = await User.findOne({ apiKey });
        while (apiKeyExists) {
            apiKey = generateApiKey();
            apiKeyExists = await User.findOne({ apiKey });
        }
        
        // Create user with isNewUser flag
        const user = await User.create({
            fullName: name,
            mobile: mobile,
            password: password,
            telegramId: tg_id,
            walletId: walletId,
            apiKey: apiKey,
            balance: 0,
            pin: null,
            pin_set: false,
            isNewUser: true, // Mark as new user - Welcome message will be sent after PIN set
            isAdmin: false,
            isBlocked: false
        });
        
        global.regOtpStore.delete(tg_id);
        
        console.log('✅ Uꜱᴇʀ Cʀᴇᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ:', user._id);
        
        // Generate JWT token
        const token = jwt.sign(
            { userId: user._id, isAdmin: false },
            JWT_SECRET,
            { expiresIn: '90d' }
        );
        
        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id,
                fullName: user.fullName,
                mobile: user.mobile,
                walletId: user.walletId,
                apiKey: user.apiKey,
                balance: user.balance,
                isAdmin: user.isAdmin,
                pin_set: user.pin_set,
                isNewUser: user.isNewUser
            },
            message: 'Aᴄᴄᴏᴜɴᴛ Cʀᴇᴀᴛᴇᴅ! Pʟᴇᴀꜱᴇ Sᴇᴛ Yᴏᴜʀ Pɪɴ Tᴏ Cᴏɴᴛɪɴᴜᴇ.'
        });
        
    } catch (error) {
        console.error('❌ Rᴇɢɪꜱᴛʀᴀᴛɪᴏɴ Eʀʀᴏʀ:', error);
        
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            let message = 'Uꜱᴇʀ Aʟʀᴇᴀᴅʏ Exɪꜱᴛꜱ';
            if (field === 'mobile') {
                message = 'Tʜɪꜱ Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ Iꜱ Aʟʀᴇᴀᴅʏ Rᴇɢɪꜱᴛᴇʀᴇᴅ.';
            } else if (field === 'telegramId') {
                message = 'Tʜɪꜱ Tᴇʟᴇɢʀᴀᴍ Iᴅ Iꜱ Aʟʀᴇᴀᴅʏ Rᴇɢɪꜱᴛᴇʀᴇᴅ.';
            } else if (field === 'walletId') {
                message = 'Wᴀʟʟᴇᴛ Iᴅ Gᴇɴᴇʀᴀᴛɪᴏɴ Cᴏɴꜰʟɪᴄᴛ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.';
            }
            return res.status(200).json({ 
                success: false,
                message: message
            });
        }
        
        res.status(200).json({ 
            success: false,
            message: 'Rᴇɢɪꜱᴛʀᴀᴛɪᴏɴ Fᴀɪʟᴇᴅ. Pʟᴇᴀꜱᴇ Cʜᴇᴄᴋ Yᴏᴜʀ Dᴇᴛᴀɪʟꜱ Aɴᴅ Tʀʏ Aɢᴀɪɴ.'
        });
    }
});

// ==================== FORGOT PASSWORD - Send OTP ====================
router.post('/send-forgot-password-otp', otpLimiter, async (req, res) => {
    try {
        const { mobile, telegramId } = req.body;
        const dateTime = getCurrentDateTime();
        let user = null;
        let identifier = null;
        
        console.log('📱 Fᴏʀɢᴏᴛ Pᴀꜱꜱᴡᴏʀᴅ Rᴇǫᴜᴇꜱᴛ:', { mobile, telegramId });
        
        if (mobile) {
            if (!/^\d{10}$/.test(mobile)) {
                return res.status(200).json({ 
                    success: false,
                    message: 'Pʟᴇᴀꜱᴇ Eɴᴛᴇʀ A Vᴀʟɪᴅ 10-Dɪɢɪᴛ Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ.'
                });
            }
            user = await User.findOne({ mobile });
            identifier = mobile;
        } else if (telegramId) {
            if (!/^\d+$/.test(telegramId)) {
                return res.status(200).json({ 
                    success: false,
                    message: 'Pʟᴇᴀꜱᴇ Eɴᴛᴇʀ A Vᴀʟɪᴅ Tᴇʟᴇɢʀᴀᴍ Iᴅ (Nᴜᴍᴇʀɪᴄ).'
                });
            }
            user = await User.findOne({ telegramId });
            identifier = telegramId;
        } else {
            return res.status(200).json({ 
                success: false,
                message: 'Mᴏʙɪʟᴇ Oʀ Tᴇʟᴇɢʀᴀᴍ Iᴅ Iꜱ Rᴇǫᴜɪʀᴇᴅ.'
            });
        }
        
        if (!user) {
            return res.status(200).json({ 
                success: false,
                message: 'Nᴏ Aᴄᴄᴏᴜɴᴛ Fᴏᴜɴᴅ Wɪᴛʜ Tʜɪꜱ ' + (mobile ? 'Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ' : 'Tᴇʟᴇɢʀᴀᴍ Iᴅ') + '.'
            });
        }
        
        if (!user.telegramId) {
            return res.status(200).json({ 
                success: false,
                message: 'Tᴇʟᴇɢʀᴀᴍ Iᴅ Nᴏᴛ Lɪɴᴋᴇᴅ Tᴏ Yᴏᴜʀ Aᴄᴄᴏᴜɴᴛ. Pʟᴇᴀꜱᴇ Cᴏɴᴛᴀᴄᴛ Sᴜᴘᴘᴏʀᴛ.'
            });
        }

        if (!BOT_TOKEN) {
            return res.status(200).json({ 
                success: false,
                message: 'Oᴛᴘ Sᴇʀᴠɪᴄᴇ Iꜱ Nᴏᴛ Cᴏɴꜰɪɢᴜʀᴇᴅ. Pʟᴇᴀꜱᴇ Cᴏɴᴛᴀᴄᴛ Sᴜᴘᴘᴏʀᴛ.'
            });
        }
        
        const otp = generateOTP();
        const expires = Date.now() + 5 * 60 * 1000;
        global.resetOtpStore.set(identifier, { otp, expires });
        
        console.log(`📱 Fᴏʀɢᴇᴛ Pᴀꜱꜱᴡᴏʀᴅ Oᴛᴘ Fᴏʀ ${identifier}: ${otp}`);
        
        const otpMessage = 
`<b>─────────────</b>
<b>🔐 Oᴛᴘ Sᴇᴄᴛɪᴏɴ</b>
<b>─────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜʀ Oɴᴇ Tɪᴍᴇ Pᴀꜱꜱᴡᴏʀᴅ Hᴀꜱ Bᴇᴇɴ Gᴇɴᴇʀᴀᴛᴇᴅ.

<b>📲 Yᴏᴜʀ Oᴛᴘ:</b> <code>${otp}</code>
<b>⏳ Vᴀʟɪᴅɪᴛʏ:</b> 5 Mɪɴᴜᴛᴇꜱ
<b>🎯 Pᴜʀᴘᴏꜱᴇ:</b> Pᴀꜱꜱᴡᴏʀᴅ Fᴏʀɢᴏᴛ
<b>⏰ Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🔒 Dᴏ Nᴏᴛ Sʜᴀʀᴇ Tʜɪꜱ Oᴛᴘ Wɪᴛʜ Aɴʏᴏɴᴇ.
⚠️ Iꜰ Tʜɪꜱ Wᴀꜱɴ'ᴛ Yᴏᴜ, Tʀʏ Tᴏ Cᴏɴᴛᴀᴄᴛ Wɪᴛʜ Sᴜᴘᴘᴏʀᴛ Tᴇᴀᴍ!
───────────────────────`;
        
        const result = await sendTelegramMessage(user.telegramId, otpMessage);
        
        if (!result.success) {
            console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Oᴛᴘ Vɪᴀ Tᴇʟᴇɢʀᴀᴍ:', result.error);
            global.resetOtpStore.delete(identifier);
            
            if (result.error === 'Tᴇʟᴇɢʀᴀᴍ Aᴘɪ Tɪᴍᴇ Oᴜᴛ' || result.error.includes('ECONN')) {
                return res.status(200).json({ 
                    success: false,
                    message: 'Tᴇʟᴇɢʀᴀᴍ Sᴇʀᴠɪᴄᴇ Iꜱ Uɴᴀᴠᴀɪʟᴀʙʟᴇ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ Iɴ A Fᴇᴡ Mᴏᴍᴇɴᴛꜱ.'
                });
            }
            
            return res.status(200).json({ 
                success: false,
                message: 'Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Oᴛᴘ. Pʟᴇᴀꜱᴇ Mᴀᴋᴇ Sᴜʀᴇ Yᴏᴜ Hᴀᴠᴇ Sᴛᴀʀᴛᴇᴅ Tʜᴇ Bᴏᴛ Aɴᴅ Tʀʏ Aɢᴀɪɴ.'
            });
        }
        
        console.log('✅ Oᴛᴘ Sᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ Tᴏ:', user.telegramId);
        
        res.status(200).json({ 
            success: true, 
            message: 'Oᴛᴘ Sᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ Tᴏ Yᴏᴜʀ Tᴇʟᴇɢʀᴀᴍ'
        });
        
    } catch (error) {
        console.error('❌ Sᴇɴᴅ Fᴏʀɢᴏᴛ Pᴀꜱꜱᴡᴏʀᴅ Oᴛᴘ Eʀʀᴏʀ:', error);
        res.status(200).json({ 
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Oᴛᴘ. Pʟᴇᴀꜱᴇ Cʜᴇᴄᴋ Yᴏᴜʀ Cᴏɴɴᴇᴄᴛɪᴏɴ Aɴᴅ Tʀʏ Aɢᴀɪɴ.'
        });
    }
});

// ==================== FORGOT PASSWORD - Reset Password ====================
router.post('/reset-password', async (req, res) => {
    try {
        const { mobile, telegramId, otp, password } = req.body;
        const dateTime = getCurrentDateTime();
        let identifier = null;
        let user = null;
        
        console.log('🔑 Rᴇꜱᴇᴛ Pᴀꜱꜱᴡᴏʀᴅ Rᴇǫᴜᴇꜱᴛ:', { mobile, telegramId, otp });
        
        if (!otp || !password) {
            return res.status(200).json({ 
                success: false,
                message: 'Oᴛᴘ Aɴᴅ Pᴀꜱꜱᴡᴏʀᴅ Aʀᴇ Rᴇǫᴜɪʀᴇᴅ.'
            });
        }
        
        if (password.length < 4) {
            return res.status(200).json({ 
                success: false,
                message: 'Pᴀꜱꜱᴡᴏʀᴅ Mᴜꜱᴛ Bᴇ Aᴛ Lᴇᴀꜱᴛ 4 Cʜᴀʀᴀᴄᴛᴇʀꜱ Lᴏɴɢ.'
            });
        }
        
        if (mobile) {
            user = await User.findOne({ mobile });
            identifier = mobile;
        } else if (telegramId) {
            user = await User.findOne({ telegramId });
            identifier = telegramId;
        } else {
            return res.status(200).json({ 
                success: false,
                message: 'Mᴏʙɪʟᴇ Oʀ Tᴇʟᴇɢʀᴀᴍ Iᴅ Iꜱ Rᴇǫᴜɪʀᴇᴅ.'
            });
        }
        
        if (!user) {
            return res.status(200).json({ 
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ. Pʟᴇᴀꜱᴇ Cʜᴇᴄᴋ Yᴏᴜʀ Dᴇᴛᴀɪʟꜱ.'
            });
        }
        
        const storedData = global.resetOtpStore?.get(identifier);
        if (!storedData) {
            return res.status(200).json({ 
                success: false,
                message: 'Nᴏ Oᴛᴘ Fᴏᴜɴᴅ. Pʟᴇᴀꜱᴇ Rᴇǫᴜᴇꜱᴛ A Nᴇᴡ Oᴛᴘ.'
            });
        }
        
        if (storedData.otp !== otp) {
            return res.status(200).json({ 
                success: false,
                message: 'Iɴᴠᴀʟɪᴅ Oᴛᴘ. Pʟᴇᴀꜱᴇ Eɴᴛᴇʀ Tʜᴇ Cᴏʀʀᴇᴄᴛ 6-Dɪɢɪᴛ Cᴏᴅᴇ.'
            });
        }
        
        if (Date.now() > storedData.expires) {
            global.resetOtpStore.delete(identifier);
            return res.status(200).json({ 
                success: false,
                message: 'Oᴛᴘ Exᴘɪʀᴇᴅ. Pʟᴇᴀꜱᴇ Rᴇǫᴜᴇꜱᴛ A Nᴇᴡ Oᴛᴘ.'
            });
        }
        
        global.resetOtpStore.delete(identifier);
        
        user.password = password;
        await user.save();
        
        if (user.telegramId && BOT_TOKEN) {
            const confirmMessage = 
`<b>─────────────────</b>
<b>✅ Pᴀꜱꜱᴡᴏʀᴅ Rᴇꜱᴇᴛ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜʀ Pᴀꜱꜱᴡᴏʀᴅ Hᴀꜱ Jᴜꜱᴛ Bᴇᴇɴ Cʜᴀɴɢᴇᴅ.

<b>⏰ Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🔒 Pʟᴇᴀꜱᴇ Kᴇᴇᴘ Iᴛ Sᴀꜰᴇ.
⚠️ Iꜰ Tʜɪꜱ Wᴀꜱɴ'ᴛ Yᴏᴜ, Cʜᴀɴɢᴇ Yᴏᴜʀ Pᴀꜱꜱᴡᴏʀᴅ Iᴍᴍᴇᴅɪᴀᴛᴇʟʏ Oʀ Cᴏɴᴛᴀᴄᴛ Sᴜᴘᴘᴏʀᴛ Tᴇᴀᴍ!
───────────────────────`;
            
            sendTelegramMessage(user.telegramId, confirmMessage).catch(err => {
                console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Pᴀꜱꜱᴡᴏʀᴅ Rᴇꜱᴇᴛ Cᴏɴꜰɪʀᴍᴀᴛɪᴏɴ:', err);
            });
        }
        
        res.status(200).json({ 
            success: true, 
            message: 'Pᴀꜱꜱᴡᴏʀᴅ Rᴇꜱᴇᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ'
        });
        
    } catch (error) {
        console.error('❌ Rᴇꜱᴇᴛ Pᴀꜱꜱᴡᴏʀᴅ Eʀʀᴏʀ:', error);
        res.status(200).json({ 
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Rᴇꜱᴇᴛ Pᴀꜱꜱᴡᴏʀᴅ. Pʟᴇᴀꜱᴇ Cʜᴇᴄᴋ Yᴏᴜʀ Cᴏɴɴᴇᴄᴛɪᴏɴ Aɴᴅ Tʀʏ Aɢᴀɪɴ.'
        });
    }
});

// ==================== GET CURRENT USER (Protected) ====================
router.get('/me', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        res.status(200).json({
            success: true,
            user: {
                id: user._id,
                fullName: user.fullName,
                mobile: user.mobile,
                walletId: user.walletId,
                apiKey: user.apiKey,
                telegramId: user.telegramId,
                balance: user.balance,
                pin_set: user.pin_set,
                isNewUser: user.isNewUser || false,
                isAdmin: user.isAdmin,
                createdAt: user.createdAt,
                profilePicture: user.profilePicture || null
            }
        });
    } catch (error) {
        console.error('❌ Uɴᴋɴᴏᴡɴ Eʀʀᴏʀ:', error);
        res.status(200).json({ 
            success: false, 
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Uꜱᴇʀ Dᴀᴛᴀ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.'
        });
    }
});

// ============================================
// GET USER BY API KEY - GET /api/auth/user-by-apikey/:apiKey
// ============================================
router.get('/user-by-apikey/:apiKey', async (req, res) => {
    try {
        const { apiKey } = req.params;
        console.log('🔍 Fᴇᴛᴄʜɪɴɢ Uꜱᴇʀ Bʏ API Kᴇʏ:', apiKey);

        if (!apiKey) {
            return res.status(200).json({
                success: false,
                message: 'API Kᴇʏ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        const user = await User.findOne({ apiKey: apiKey });

        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ Wɪᴛʜ Tʜɪꜱ API Kᴇʏ'
            });
        }

        return res.status(200).json({
            success: true,
            mobile: user.mobile,
            fullName: user.fullName,
            walletId: user.walletId,
            balance: user.balance
        });

    } catch (error) {
        console.error('❌ Gᴇᴛ Uꜱᴇʀ Bʏ API Kᴇʏ Eʀʀᴏʀ:', error);
        return res.status(200).json({
            success: false,
            message: 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.'
        });
    }
});

// ==================== GET USER BY TELEGRAM ID ====================
router.get('/user-by-telegram/:tgid', async (req, res) => {
    try {
        const { tgid } = req.params;
        if (!tgid) {
            return res.status(200).json({
                success: false,
                message: 'Tᴇʟᴇɢʀᴀᴍ Iᴅ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }
        
        const user = await User.findOne({ telegramId: tgid });
        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ'
            });
        }
        
        return res.status(200).json({
            success: true,
            mobile: user.mobile,
            fullName: user.fullName,
            walletId: user.walletId,
            balance: user.balance
        });
    } catch (error) {
        console.error('❌ Gᴇᴛ Uꜱᴇʀ Bʏ Tᴇʟᴇɢʀᴀᴍ Eʀʀᴏʀ:', error);
        return res.status(200).json({
            success: false,
            message: 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.'
        });
    }
});

// ==================== VERIFY TOKEN ====================
router.get('/verify', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        
        res.status(200).json({
            success: true,
            data: {
                user: {
                    id: user._id,
                    fullName: user.fullName,
                    mobile: user.mobile,
                    walletId: user.walletId,
                    telegramId: user.telegramId,
                    balance: user.balance || 0,
                    pin_set: user.pin_set,
                    isNewUser: user.isNewUser || false,
                    isAdmin: user.isAdmin,
                    createdAt: user.createdAt
                }
            }
        });
    } catch (error) {
        console.error('❌ Vᴇʀɪꜰʏ Eʀʀᴏʀ:', error);
        res.status(200).json({ 
            success: false,
            message: 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.'
        });
    }
});

// ==================== TELEGRAM AUTO LOGIN ====================
router.post('/telegram-login', async (req, res) => {
    try {
        const { telegramId } = req.body;
        
        console.log('🤖 Tᴇʟᴇɢʀᴀᴍ Aᴜᴛᴏ Lᴏɢɪɴ Rᴇǫᴜᴇꜱᴛ Fᴏʀ:', telegramId);
        
        if (!telegramId) {
            return res.status(200).json({
                success: false,
                message: 'Tᴇʟᴇɢʀᴀᴍ Iᴅ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }
        
        // Find user by telegramId
        const user = await User.findOne({ telegramId: telegramId });
        
        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'Nᴏ Aᴄᴄᴏᴜɴᴛ Fᴏᴜɴᴅ Wɪᴛʜ Tʜɪꜱ Tᴇʟᴇɢʀᴀᴍ Iᴅ'
            });
        }
        
        if (user.isBlocked) {
            return res.status(200).json({
                success: false,
                message: 'Yᴏᴜʀ Aᴄᴄᴏᴜɴᴛ Hᴀꜱ Bᴇᴇɴ Bʟᴏᴄᴋᴇᴅ'
            });
        }
        
        // Generate JWT Token
        const token = jwt.sign(
            { userId: user._id, isAdmin: user.isAdmin },
            JWT_SECRET,
            { expiresIn: '90d' }
        );
        
        console.log('✅ Aᴜᴛᴏ Lᴏɢɪɴ Sᴜᴄᴄᴇꜱꜱꜰᴜʟ Fᴏʀ:', user.fullName);
        
        res.status(200).json({
            success: true,
            token: token,
            user: {
                id: user._id,
                fullName: user.fullName,
                mobile: user.mobile,
                walletId: user.walletId,
                balance: user.balance || 0,
                isAdmin: user.isAdmin,
                pin_set: user.pin_set,
                isNewUser: user.isNewUser || false,
                createdAt: user.createdAt
            }
        });
        
    } catch (error) {
        console.error('❌ Tᴇʟᴇɢʀᴀᴍ Aᴜᴛᴏ Lᴏɢɪɴ Eʀʀᴏʀ:', error);
        res.status(200).json({
            success: false,
            message: 'Aᴜᴛᴏ Lᴏɢɪɴ Fᴀɪʟᴇᴅ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.'
        });
    }
});

// ==================== GET USER BY MOBILE ====================
router.get('/user-by-mobile/:mobile', async (req, res) => {
    try {
        const { mobile } = req.params;
        if (!mobile) {
            return res.status(200).json({
                success: false,
                message: 'Mobile number is required'
            });
        }
        
        const user = await User.findOne({ mobile: mobile });
        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'User not found'
            });
        }
        
        return res.status(200).json({
            success: true,
            telegramId: user.telegramId,
            fullName: user.fullName,
            mobile: user.mobile,
            walletId: user.walletId
        });
    } catch (error) {
        console.error('❌ Get User By Mobile Error:', error);
        return res.status(200).json({
            success: false,
            message: 'Server Error'
        });
    }
});
        
module.exports = router;
