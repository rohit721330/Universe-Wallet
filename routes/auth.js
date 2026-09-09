const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
require('dotenv').config();

// ===== GLOBAL STORES =====
if (!global.loginOtpStore) { global.loginOtpStore = new Map(); }
if (!global.regOtpStore) { global.regOtpStore = new Map(); }
if (!global.resetOtpStore) { global.resetOtpStore = new Map(); }
if (!global.tgIdStore) { global.tgIdStore = new Map(); }

// ===== RATE LIMITERS =====
const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Too many OTP requests. Try later.' }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: 'Too many login attempts. Try later.' }
});

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID;
const JWT_SECRET = process.env.JWT_SECRET;

// ===== VERIFY TOKEN =====
const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(200).json({ success: false, message: 'No token' });
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });
        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(200).json({ success: false, message: 'Invalid token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(200).json({ success: false, message: 'Token expired' });
        }
        return res.status(200).json({ success: false, message: 'Auth error' });
    }
};

// ===== HELPER FUNCTIONS =====
async function sendTelegramMessage(chatId, message) {
    if (!BOT_TOKEN) {
        console.error('❌ BOT_TOKEN not set');
        return { success: false, error: 'BOT_TOKEN not configured' };
    }
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const response = await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        }, { timeout: 15000 });
        if (response.data?.ok) {
            return { success: true };
        }
        return { success: false, error: response.data?.description || 'Unknown error' };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function generateWalletId() {
    const prefix = 'UW';
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

function generateApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 10; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
}

function getClientIp(req) {
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress || req.ip || 'Unknown';
}

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

function cleanExpiredOtps() {
    const now = Date.now();
    const stores = [global.loginOtpStore, global.regOtpStore, global.resetOtpStore, global.tgIdStore];
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
setInterval(cleanExpiredOtps, 5 * 60 * 1000);

// ==============================================================
// ===================== 2-STEP LOGIN ===========================
// ==============================================================

// Step 1: Verify password
router.post('/verify-password', loginLimiter, async (req, res) => {
    try {
        const { mobile, password } = req.body;
        if (!mobile || !password) {
            return res.status(200).json({ success: false, message: 'Mobile & password required' });
        }
        const user = await User.findOne({ mobile });
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });
        const isValid = await user.comparePassword(password);
        if (!isValid) return res.status(200).json({ success: false, message: 'Invalid password' });
        if (user.isBlocked) return res.status(200).json({ success: false, message: 'Account blocked' });
        if (!user.telegramId) return res.status(200).json({ success: false, message: 'Telegram not linked' });
        
        res.status(200).json({
            success: true,
            user: {
                id: user._id,
                fullName: user.fullName,
                mobile: user.mobile,
                tg_id: user.telegramId,
                isAdmin: user.isAdmin,
                pin_set: user.pin_set,
                isNewUser: user.isNewUser || false
            }
        });
    } catch (error) {
        console.error('❌ Verify password error:', error);
        res.status(200).json({ success: false, message: 'Verification failed' });
    }
});

// Step 2: Send OTP
router.post('/send-login-otp', otpLimiter, async (req, res) => {
    try {
        const { userId, tgId } = req.body;
        if (!userId || !tgId) {
            return res.status(200).json({ success: false, message: 'User ID & Telegram ID required' });
        }
        const user = await User.findById(userId);
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });
        if (!BOT_TOKEN) return res.status(200).json({ success: false, message: 'OTP service unavailable' });
        
        const otp = generateOTP();
        const expires = Date.now() + 5 * 60 * 1000;
        global.loginOtpStore.set(userId.toString(), { otp, expires });
        
        const msg = `🔐 LOGIN OTP

Dear ${user.fullName},

Your OTP: <code>${otp}</code>
Valid for: 5 minutes

Do not share this OTP with anyone.`;
        
        const result = await sendTelegramMessage(user.telegramId, msg);
        
        if (!result.success) {
            global.loginOtpStore.delete(userId.toString());
            return res.status(200).json({ success: false, message: 'Failed to send OTP' });
        }
        res.status(200).json({ success: true, message: 'OTP sent to Telegram' });
    } catch (error) {
        console.error('❌ Send OTP error:', error);
        res.status(200).json({ success: false, message: 'Failed to send OTP' });
    }
});

// Step 3: Verify OTP
router.post('/verify-login-otp', loginLimiter, async (req, res) => {
    try {
        const { userId, otp } = req.body;
        if (!userId || !otp) {
            return res.status(200).json({ success: false, message: 'User ID & OTP required' });
        }
        const stored = global.loginOtpStore?.get(userId.toString());
        if (!stored) return res.status(200).json({ success: false, message: 'No OTP found' });
        if (stored.otp !== otp) return res.status(200).json({ success: false, message: 'Invalid OTP' });
        if (Date.now() > stored.expires) {
            global.loginOtpStore.delete(userId.toString());
            return res.status(200).json({ success: false, message: 'OTP expired' });
        }
        const user = await User.findById(userId);
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });
        if (user.isBlocked) return res.status(200).json({ success: false, message: 'Account blocked' });
        
        global.loginOtpStore.delete(userId.toString());
        const token = jwt.sign(
            { userId: user._id, isAdmin: user.isAdmin },
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
                balance: user.balance,
                isAdmin: user.isAdmin,
                pin_set: user.pin_set,
                isNewUser: user.isNewUser || false
            }
        });
    } catch (error) {
        console.error('❌ Verify OTP error:', error);
        res.status(200).json({ success: false, message: 'Verification failed' });
    }
});

// ==============================================================
// ===================== REGISTRATION ===========================
// ==============================================================

// Send OTP for registration
router.post('/send-registration-otp', otpLimiter, async (req, res) => {
    try {
        const { tg_id, name } = req.body;
        if (!tg_id) {
            return res.status(200).json({ success: false, message: 'Telegram ID required' });
        }
        const existing = await User.findOne({ telegramId: tg_id });
        if (existing) {
            return res.status(200).json({ success: false, message: 'Telegram ID already registered' });
        }
        if (!BOT_TOKEN) return res.status(200).json({ success: false, message: 'OTP service unavailable' });
        
        const otp = generateOTP();
        const expires = Date.now() + 5 * 60 * 1000;
        global.regOtpStore.set(tg_id, { otp, expires });
        
        const msg = `🔐 REGISTRATION OTP

Dear ${name || 'User'},

Your OTP: <code>${otp}</code>
Valid for: 5 minutes

Do not share this OTP with anyone.`;
        
        const result = await sendTelegramMessage(tg_id, msg);
        
        if (!result.success) {
            global.regOtpStore.delete(tg_id);
            return res.status(200).json({ success: false, message: 'Failed to send OTP' });
        }
        res.status(200).json({ success: true, message: 'OTP sent to Telegram' });
    } catch (error) {
        console.error('❌ Send reg OTP error:', error);
        res.status(200).json({ success: false, message: 'Failed to send OTP' });
    }
});

// Register new user
router.post('/register', async (req, res) => {
    try {
        const { name, mobile, password, tg_id, otp, pin } = req.body;
        const dateTime = getCurrentDateTime();
        const clientIp = getClientIp(req);
        
        if (!name || !mobile || !password || !tg_id || !otp) {
            return res.status(200).json({ success: false, message: 'All fields required' });
        }
        if (!/^[9|8|7][0-9]{9}$/.test(mobile)) {
            return res.status(200).json({ success: false, message: 'Invalid mobile' });
        }
        if (password.length < 8 || password.length > 15) {
            return res.status(200).json({ success: false, message: 'Password 8-15 chars' });
        }
        if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
            return res.status(200).json({ success: false, message: 'Password needs upper, lower, number' });
        }
        
        const stored = global.regOtpStore?.get(tg_id);
        if (!stored) return res.status(200).json({ success: false, message: 'Request OTP first' });
        if (stored.otp !== otp) return res.status(200).json({ success: false, message: 'Invalid OTP' });
        if (Date.now() > stored.expires) {
            global.regOtpStore.delete(tg_id);
            return res.status(200).json({ success: false, message: 'OTP expired' });
        }
        
        const existing = await User.findOne({ $or: [{ mobile }, { telegramId: tg_id }] });
        if (existing) {
            let msg = 'User exists';
            if (existing.mobile === mobile) msg = 'Mobile already registered';
            else if (existing.telegramId === tg_id) msg = 'Telegram ID already registered';
            return res.status(200).json({ success: false, message: msg });
        }
        
        let walletId = generateWalletId();
        while (await User.findOne({ walletId })) walletId = generateWalletId();
        let apiKey = generateApiKey();
        while (await User.findOne({ apiKey })) apiKey = generateApiKey();
        
        const user = await User.create({
            fullName: name,
            mobile,
            password,
            telegramId: tg_id,
            walletId,
            apiKey,
            balance: 0,
            pin: pin || null,
            pin_set: !!pin,
            isNewUser: true,
            isAdmin: false,
            isBlocked: false
        });
        
        global.regOtpStore.delete(tg_id);
        const token = jwt.sign(
            { userId: user._id, isAdmin: false },
            JWT_SECRET,
            { expiresIn: '90d' }
        );
        
        // Send admin notification
        if (ADMIN_TG_ID && BOT_TOKEN) {
            const adminMsg = `🆕 NEW USER REGISTERED

👤 Name: ${name}
📱 Mobile: ${mobile}
🪪 Telegram ID: ${tg_id}
💳 Wallet ID: ${walletId}
🔑 API Key: ${apiKey}
🌐 IP: ${clientIp}
⏰ Time: ${dateTime}`;
            
            sendTelegramMessage(ADMIN_TG_ID, adminMsg).catch(err => {
                console.error('❌ Failed to send admin notification:', err);
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
                apiKey: user.apiKey,
                balance: user.balance,
                isAdmin: user.isAdmin,
                pin_set: user.pin_set,
                isNewUser: user.isNewUser
            }
        });
    } catch (error) {
        console.error('❌ Registration error:', error);
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            let msg = 'User exists';
            if (field === 'mobile') msg = 'Mobile already registered';
            else if (field === 'telegramId') msg = 'Telegram ID already registered';
            return res.status(200).json({ success: false, message: msg });
        }
        res.status(200).json({ success: false, message: 'Registration failed' });
    }
});

// ==============================================================
// =============== TELEGRAM ID AUTO FETCH ======================
// ==============================================================

// Store Telegram ID
router.post('/store-telegram-id', async (req, res) => {
    try {
        const { tgId, sessionId } = req.body;
        if (!tgId || !sessionId) {
            return res.status(200).json({ success: false, message: 'Telegram ID & session required' });
        }
        const expires = Date.now() + 10 * 60 * 1000;
        global.tgIdStore.set(sessionId, { tgId, expires });
        res.status(200).json({ success: true, message: 'Telegram ID stored' });
    } catch (error) {
        console.error('❌ Store TG ID error:', error);
        res.status(200).json({ success: false, message: 'Failed to store' });
    }
});

// Get stored Telegram ID
router.get('/get-telegram-id/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        if (!sessionId) {
            return res.status(200).json({ success: false, message: 'Session required' });
        }
        const stored = global.tgIdStore?.get(sessionId);
        if (!stored) {
            return res.status(200).json({ success: false, message: 'No ID found' });
        }
        if (Date.now() > stored.expires) {
            global.tgIdStore.delete(sessionId);
            return res.status(200).json({ success: false, message: 'ID expired' });
        }
        res.status(200).json({ success: true, tg_id: stored.tgId });
    } catch (error) {
        console.error('❌ Get TG ID error:', error);
        res.status(200).json({ success: false, message: 'Failed to get ID' });
    }
});

// ==============================================================
// ===================== LEGACY LOGIN ===========================
// ==============================================================

router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { mobile, password } = req.body;
        if (!mobile || !password) {
            return res.status(200).json({ success: false, message: 'Mobile & password required' });
        }
        const user = await User.findOne({ mobile });
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });
        const isValid = await user.comparePassword(password);
        if (!isValid) return res.status(200).json({ success: false, message: 'Invalid password' });
        if (user.isBlocked) return res.status(200).json({ success: false, message: 'Account blocked' });
        
        const token = jwt.sign(
            { userId: user._id, isAdmin: user.isAdmin },
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
                balance: user.balance,
                isAdmin: user.isAdmin,
                pin_set: user.pin_set,
                isNewUser: user.isNewUser || false
            }
        });
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(200).json({ success: false, message: 'Login failed' });
    }
});

// ==============================================================
// ===================== FORGOT PASSWORD ========================
// ==============================================================

router.post('/send-forgot-password-otp', otpLimiter, async (req, res) => {
    try {
        const { mobile, telegramId } = req.body;
        let user = null;
        let identifier = null;
        
        if (mobile) {
            user = await User.findOne({ mobile });
            identifier = mobile;
        } else if (telegramId) {
            user = await User.findOne({ telegramId });
            identifier = telegramId;
        } else {
            return res.status(200).json({ success: false, message: 'Mobile or Telegram ID required' });
        }
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });
        if (!user.telegramId) return res.status(200).json({ success: false, message: 'Telegram not linked' });
        if (!BOT_TOKEN) return res.status(200).json({ success: false, message: 'OTP service unavailable' });
        
        const otp = generateOTP();
        const expires = Date.now() + 5 * 60 * 1000;
        global.resetOtpStore.set(identifier, { otp, expires });
        
        const msg = `🔐 PASSWORD RESET OTP

Dear ${user.fullName},

Your OTP: <code>${otp}</code>
Valid for: 5 minutes

Do not share this OTP with anyone.`;
        
        const result = await sendTelegramMessage(user.telegramId, msg);
        
        if (!result.success) {
            global.resetOtpStore.delete(identifier);
            return res.status(200).json({ success: false, message: 'Failed to send OTP' });
        }
        res.status(200).json({ success: true, message: 'OTP sent to Telegram' });
    } catch (error) {
        console.error('❌ Send forgot OTP error:', error);
        res.status(200).json({ success: false, message: 'Failed to send OTP' });
    }
});

router.post('/reset-password', async (req, res) => {
    try {
        const { mobile, telegramId, otp, password } = req.body;
        let identifier = null;
        let user = null;
        if (!otp || !password) {
            return res.status(200).json({ success: false, message: 'OTP & password required' });
        }
        if (password.length < 4) {
            return res.status(200).json({ success: false, message: 'Password min 4 chars' });
        }
        if (mobile) {
            user = await User.findOne({ mobile });
            identifier = mobile;
        } else if (telegramId) {
            user = await User.findOne({ telegramId });
            identifier = telegramId;
        } else {
            return res.status(200).json({ success: false, message: 'Mobile or Telegram ID required' });
        }
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });
        
        const stored = global.resetOtpStore?.get(identifier);
        if (!stored) return res.status(200).json({ success: false, message: 'No OTP found' });
        if (stored.otp !== otp) return res.status(200).json({ success: false, message: 'Invalid OTP' });
        if (Date.now() > stored.expires) {
            global.resetOtpStore.delete(identifier);
            return res.status(200).json({ success: false, message: 'OTP expired' });
        }
        
        global.resetOtpStore.delete(identifier);
        user.password = password;
        await user.save();
        res.status(200).json({ success: true, message: 'Password reset successful' });
    } catch (error) {
        console.error('❌ Reset password error:', error);
        res.status(200).json({ success: false, message: 'Reset failed' });
    }
});

// ==============================================================
// ===================== OTHER ENDPOINTS ========================
// ==============================================================

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
                createdAt: user.createdAt
            }
        });
    } catch (error) {
        console.error('❌ Get user error:', error);
        res.status(200).json({ success: false, message: 'Failed to fetch user' });
    }
});

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
                    isAdmin: user.isAdmin
                }
            }
        });
    } catch (error) {
        console.error('❌ Verify error:', error);
        res.status(200).json({ success: false, message: 'Verification failed' });
    }
});

router.post('/telegram-login', async (req, res) => {
    try {
        const { telegramId } = req.body;
        if (!telegramId) {
            return res.status(200).json({ success: false, message: 'Telegram ID required' });
        }
        const user = await User.findOne({ telegramId });
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });
        if (user.isBlocked) return res.status(200).json({ success: false, message: 'Account blocked' });
        
        const token = jwt.sign(
            { userId: user._id, isAdmin: user.isAdmin },
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
                balance: user.balance || 0,
                isAdmin: user.isAdmin,
                pin_set: user.pin_set,
                isNewUser: user.isNewUser || false
            }
        });
    } catch (error) {
        console.error('❌ Telegram login error:', error);
        res.status(200).json({ success: false, message: 'Login failed' });
    }
});

router.get('/user-by-mobile/:mobile', async (req, res) => {
    try {
        const { mobile } = req.params;
        if (!mobile) return res.status(200).json({ success: false, message: 'Mobile required' });
        const user = await User.findOne({ mobile });
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });
        res.status(200).json({
            success: true,
            telegramId: user.telegramId,
            fullName: user.fullName,
            mobile: user.mobile,
            walletId: user.walletId
        });
    } catch (error) {
        console.error('❌ Get by mobile error:', error);
        res.status(200).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
