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
    message: { success: false, message: 'Too many OTP requests. Please try again later.' }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: 'Too many login attempts. Please try again later.' }
});

// Telegram Bot Configuration
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID;
const JWT_SECRET = process.env.JWT_SECRET;

// Validate required environment variables
if (!BOT_TOKEN) {
    console.error('❌ Bot token is not set in environment variables.');
}
if (!ADMIN_TG_ID) {
    console.error('❌ Admin TG ID is not set in environment variables.');
}
if (!JWT_SECRET) {
    console.error('❌ JWT secret is not set in environment variables.');
}

// ==================== VERIFY TOKEN (Middleware) ====================
const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(200).json({ 
                success: false, 
                message: 'No token provided' 
            });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (!user) {
            return res.status(200).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        
        req.user = user;
        next();
    } catch (error) {
        console.error('Auth error:', error);
        if (error.name === 'JsonWebTokenError') {
            return res.status(200).json({ 
                success: false, 
                message: 'Invalid token' 
            });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(200).json({ 
                success: false, 
                message: 'Token expired' 
            });
        }
        return res.status(200).json({ 
            success: false, 
            message: 'Auth error. Please try again.' 
        });
    }
};

// ==================== HELPER FUNCTIONS ====================
// Helper: Send message via Telegram
async function sendTelegramMessage(chatId, message) {
    if (!BOT_TOKEN) {
        console.error('Cannot send Telegram message. Bot token not set.');
        return { success: false, error: 'BOT_TOKEN not configured' };
    }

    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        console.log('Sending Telegram message to chat:', chatId);
        
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
            console.log('Telegram message sent successfully to chat:', chatId);
            return { success: true };
        } else {
            console.error('Telegram API response:', response.data?.description || 'Unknown error');
            return { success: false, error: response.data?.description || 'Unknown error' };
        }
    } catch (error) {
        console.error('Failed to send Telegram message:', error.message);
        if (error.response) {
            console.error('Telegram API response:', error.response.data);
        }
        if (error.code === 'ECONNABORTED') {
            return { success: false, error: 'Telegram API timeout' };
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
        
        console.log('Verify OTP request:', { mobile, telegramId, otp });
        
        if (!otp) {
            return res.status(200).json({ 
                success: false,
                message: 'OTP is required'
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
                    message: 'No account found with this mobile number'
                });
            }
            storedData = global.resetOtpStore?.get(mobile);
            identifier = mobile;
        } else if (telegramId) {
            user = await User.findOne({ telegramId });
            if (!user) {
                return res.status(200).json({ 
                    success: false,
                    message: 'No account found with this Telegram ID'
                });
            }
            storedData = global.resetOtpStore?.get(telegramId);
            identifier = telegramId;
        } else {
            return res.status(200).json({ 
                success: false,
                message: 'Mobile or Telegram ID is required'
            });
        }
        
        if (!storedData) {
            return res.status(200).json({ 
                success: false,
                message: 'No OTP found. Please request a new OTP'
            });
        }
        
        if (storedData.otp !== otp) {
            return res.status(200).json({ 
                success: false,
                message: 'Invalid OTP. Please enter the correct 6-digit code'
            });
        }
        
        if (Date.now() > storedData.expires) {
            global.resetOtpStore.delete(identifier);
            return res.status(200).json({ 
                success: false,
                message: 'OTP expired. Please request a new OTP'
            });
        }
        
        res.status(200).json({ 
            success: true, 
            verified: true,
            message: 'OTP verified successfully'
        });
        
    } catch (error) {
        console.error('Verify OTP error:', error);
        res.status(200).json({ 
            success: false,
            message: 'Server error. Please try again'
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
                message: 'Mobile & password required'
            });
        }
        
        const user = await User.findOne({ mobile });
        if (!user) {
            return res.status(200).json({ 
                success: false,
                message: 'User not found. Please check your mobile number.'
            });
        }
        
        const isValid = await user.comparePassword(password);
        
        if (!isValid) {
            return res.status(200).json({ 
                success: false,
                message: 'Invalid password. Please try again.'
            });
        }
        
        if (user.isBlocked) {
            return res.status(200).json({ 
                success: false,
                message: 'Your account has been blocked. Please contact support.'
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
`🚨 New Login Detected

Dear ${user.fullName}, a new login was detected on your account.

Mobile: ${user.mobile}
Purpose: Password Login
IP: ${clientIp}
Time: ${dateTime}

If this wasn't you, please change your password immediately or contact support.`;
            
            sendTelegramMessage(user.telegramId, loginMessage).catch(err => {
                console.error('Failed to send login alert:', err);
            });
        }
        
        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id,
                fullName: user.fullName,
                mobile: user.mobile,
                email: user.email,
                walletId: user.walletId,
                balance: user.balance,
                isAdmin: user.isAdmin,
                pin_set: user.pin_set,
                isNewUser: user.isNewUser || false
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(200).json({ 
            success: false,
            message: 'Login failed. Please check your connection and try again.'
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
                message: 'Mobile & OTP required'
            });
        }
        
        const storedData = global.loginOtpStore?.get(mobile);
        if (!storedData) {
            return res.status(200).json({ 
                success: false,
                message: 'No OTP found. Please request a new OTP by clicking "Send OTP".'
            });
        }
        
        if (storedData.otp !== otp) {
            return res.status(200).json({ 
                success: false,
                message: 'Invalid OTP. Please enter the correct 6-digit code.'
            });
        }
        
        if (Date.now() > storedData.expires) {
            global.loginOtpStore.delete(mobile);
            return res.status(200).json({ 
                success: false,
                message: 'OTP expired. Please request a new OTP.'
            });
        }
        
        const user = await User.findOne({ mobile });
        if (!user) {
            return res.status(200).json({ 
                success: false,
                message: 'User not found. Please check your mobile number.'
            });
        }
        
        if (user.isBlocked) {
            return res.status(200).json({ 
                success: false,
                message: 'Your account has been blocked. Please contact support.'
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
`🚨 New Login Detected

Dear ${user.fullName}, a new login was detected on your account.

Mobile: ${user.mobile}
Purpose: OTP Login
IP: ${clientIp}
Time: ${dateTime}

If this wasn't you, please change your password immediately or contact support.`;
            
            sendTelegramMessage(user.telegramId, loginMessage).catch(err => {
                console.error('Failed to send login alert:', err);
            });
        }
        
        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id,
                fullName: user.fullName,
                mobile: user.mobile,
                email: user.email,
                walletId: user.walletId,
                balance: user.balance,
                isAdmin: user.isAdmin,
                pin_set: user.pin_set,
                isNewUser: user.isNewUser || false
            }
        });
    } catch (error) {
        console.error('Login with OTP error:', error);
        res.status(200).json({ 
            success: false,
            message: 'Login with OTP failed. Please try again.'
        });
    }
});

// ==================== SEND OTP FOR LOGIN ====================
router.post('/send-login-otp', otpLimiter, async (req, res) => {
    try {
        const { mobile } = req.body;
        const dateTime = getCurrentDateTime();
        
        console.log('Login OTP request for mobile:', mobile);
        
        if (!mobile || !/^\d{10}$/.test(mobile)) {
            return res.status(200).json({ 
                success: false,
                message: 'Please enter a valid 10-digit mobile number.'
            });
        }
        
        const user = await User.findOne({ mobile });
        if (!user) {
            return res.status(200).json({ 
                success: false,
                message: 'No account found with this mobile number. Please register first.'
            });
        }
        
        if (!user.telegramId) {
            return res.status(200).json({ 
                success: false,
                message: 'Telegram ID not linked to your account. Please link your Telegram ID first.'
            });
        }

        if (!BOT_TOKEN) {
            return res.status(200).json({ 
                success: false,
                message: 'OTP service is not configured. Please contact support.'
            });
        }
        
        const otp = generateOTP();
        const expires = Date.now() + 5 * 60 * 1000;
        global.loginOtpStore.set(mobile, { otp, expires });
        
        console.log(`Login OTP for ${mobile}: ${otp}`);
        
        const otpMessage = 
`🔐 OTP Section

Dear ${user.fullName}, your one time password has been generated.

Your OTP: <code>${otp}</code>
Validity: 5 minutes
Purpose: Login
Time: ${dateTime}

Do not share this OTP with anyone.
If this wasn't you, contact support team.`;
        
        const result = await sendTelegramMessage(user.telegramId, otpMessage);
        
        if (!result.success) {
            console.error('Failed to send OTP via Telegram:', result.error);
            global.loginOtpStore.delete(mobile);
            
            if (result.error === 'Telegram API timeout' || result.error.includes('ECONN')) {
                return res.status(200).json({ 
                    success: false,
                    message: 'Telegram service is unavailable. Please try again in a few moments.'
                });
            }
            
            return res.status(200).json({ 
                success: false,
                message: 'Failed to send OTP. Please make sure you have started the bot and try again.'
            });
        }
        
        console.log('OTP sent successfully to:', user.telegramId);
        
        res.status(200).json({ 
            success: true, 
            message: 'OTP sent successfully to your Telegram'
        });
        
    } catch (error) {
        console.error('Send login OTP error:', error);
        res.status(200).json({ 
            success: false,
            message: 'Failed to send OTP. Please check your connection and try again.'
        });
    }
});

// ==================== SEND OTP FOR REGISTRATION ====================
router.post('/send-registration-otp', otpLimiter, async (req, res) => {
    try {
        const { tg_id, name } = req.body;
        const dateTime = getCurrentDateTime();
        
        console.log('Registration OTP request:', { tg_id, name });
        
        if (!tg_id) {
            return res.status(200).json({ 
                success: false,
                message: 'Telegram ID is required. Please enter your Telegram ID.'
            });
        }
        
        const existingUser = await User.findOne({ telegramId: tg_id });
        if (existingUser) {
            return res.status(200).json({ 
                success: false,
                message: 'This Telegram ID is already registered. Please use a different ID or login.'
            });
        }

        if (!BOT_TOKEN) {
            return res.status(200).json({ 
                success: false,
                message: 'OTP service is not configured. Please contact support.'
            });
        }
        
        const otp = generateOTP();
        const expires = Date.now() + 5 * 60 * 1000;
        global.regOtpStore.set(tg_id, { otp, expires });
        
        console.log(`Registration OTP for ${tg_id}: ${otp}`);
        
        const otpMessage = 
`🔐 OTP Section

Dear ${name || 'User'}, your one time password has been generated.

Your OTP: <code>${otp}</code>
Validity: 5 minutes
Purpose: Registration
Time: ${dateTime}

Do not share this OTP with anyone.`;
        
        const result = await sendTelegramMessage(tg_id, otpMessage);
        
        if (!result.success) {
            console.error('Failed to send OTP via Telegram:', result.error);
            global.regOtpStore.delete(tg_id);
            
            if (result.error === 'Telegram API timeout' || result.error.includes('ECONN')) {
                return res.status(200).json({ 
                    success: false,
                    message: 'Telegram service is unavailable. Please try again in a few moments.'
                });
            }
            
            return res.status(200).json({ 
                success: false,
                message: 'Failed to send OTP. Please make sure you have started the bot and try again.'
            });
        }
        
        console.log('Registration OTP sent successfully to:', tg_id);
        
        res.status(200).json({ 
            success: true, 
            message: 'OTP sent successfully to your Telegram'
        });
        
    } catch (error) {
        console.error('Send registration OTP error:', error);
        res.status(200).json({ 
            success: false,
            message: 'Failed to send OTP. Please check your connection and try again.'
        });
    }
});

// ==================== REGISTER NEW USER (WITH EMAIL) ====================
router.post('/register', async (req, res) => {
    try {
        const { name, mobile, email, password, tg_id, otp } = req.body;
        const dateTime = getCurrentDateTime();
        const clientIp = getClientIp(req);
        
        console.log('Registration request received:', { 
            name, mobile, email, tg_id, 
            otp: otp ? 'Provided' : 'Missing', 
            password: password ? 'Provided' : 'Missing' 
        });
        
        // ===== Validation =====
        if (!name || !mobile || !email || !password || !tg_id || !otp) {
            const missing = [];
            if (!name) missing.push('Name');
            if (!mobile) missing.push('Mobile');
            if (!email) missing.push('Email');
            if (!password) missing.push('Password');
            if (!tg_id) missing.push('Telegram ID');
            if (!otp) missing.push('OTP');
            
            return res.status(200).json({ 
                success: false,
                message: `Missing fields: ${missing.join(', ')}`
            });
        }
        
        // Mobile validation
        if (!/^[9|8|7][0-9]{9}$/.test(mobile)) {
            return res.status(200).json({ 
                success: false,
                message: 'Invalid mobile number. Mobile must start with 9, 8, or 7.'
            });
        }
        
        // Email validation
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(200).json({ 
                success: false,
                message: 'Invalid email address. Please enter a valid email.'
            });
        }
        
        // Password validation
        if (password.length < 8 || password.length > 15) {
            return res.status(200).json({ 
                success: false,
                message: 'Password must be 8-15 characters long.'
            });
        }
        
        const hasUppercase = /[A-Z]/.test(password);
        const hasLowercase = /[a-z]/.test(password);
        const hasNumber = /[0-9]/.test(password);
        
        if (!hasUppercase || !hasLowercase || !hasNumber) {
            return res.status(200).json({ 
                success: false,
                message: 'Password must contain uppercase, lowercase, and number.'
            });
        }
        
        // ===== OTP verification =====
        const storedData = global.regOtpStore?.get(tg_id);
        console.log('Stored OTP data:', storedData ? 'Found' : 'Not found');
        
        if (!storedData) {
            return res.status(200).json({ 
                success: false,
                message: 'Please request an OTP first by clicking "Send OTP".'
            });
        }
        
        console.log('Comparing OTP:', { 
            provided: otp, 
            stored: storedData.otp,
            matches: storedData.otp === otp,
            expired: Date.now() > storedData.expires
        });
        
        if (storedData.otp !== otp) {
            return res.status(200).json({ 
                success: false,
                message: 'Invalid OTP. Please enter the correct 6-digit code.'
            });
        }
        
        if (Date.now() > storedData.expires) {
            global.regOtpStore.delete(tg_id);
            return res.status(200).json({ 
                success: false,
                message: 'OTP expired. Please request a new OTP.'
            });
        }
        
        // ===== Check for existing user =====
        const existingUser = await User.findOne({ 
            $or: [{ mobile }, { email }, { telegramId: tg_id }] 
        });
        
        if (existingUser) {
            let errorMsg = 'User already exists';
            if (existingUser.mobile === mobile) {
                errorMsg = 'This mobile number is already registered. Please login.';
            } else if (existingUser.email === email) {
                errorMsg = 'This email is already registered. Please login.';
            } else if (existingUser.telegramId === tg_id) {
                errorMsg = 'This Telegram ID is already registered. Please login.';
            }
            return res.status(200).json({ 
                success: false,
                message: errorMsg
            });
        }
        
        // ===== Generate unique walletId & apiKey =====
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
        
        // ===== Create user =====
        const user = await User.create({
            fullName: name,
            mobile: mobile,
            email: email,
            password: password,
            telegramId: tg_id,
            walletId: walletId,
            apiKey: apiKey,
            balance: 0,
            pin: null,
            pin_set: false,
            isNewUser: true,
            isAdmin: false,
            isBlocked: false
        });
        
        global.regOtpStore.delete(tg_id);
        
        console.log('User created successfully:', user._id);
        
        // ===== Generate JWT token =====
        const token = jwt.sign(
            { userId: user._id, isAdmin: false },
            JWT_SECRET,
            { expiresIn: '90d' }
        );
        
        // ===== Notify admin via Telegram =====
        if (ADMIN_TG_ID && BOT_TOKEN) {
            const adminMsg = 
`🆕 New User Registered

Name: ${name}
Mobile: ${mobile}
Email: ${email}
Telegram ID: ${tg_id}
Wallet ID: ${walletId}
API Key: ${apiKey}
IP: ${clientIp}
Time: ${dateTime}`;
            
            sendTelegramMessage(ADMIN_TG_ID, adminMsg).catch(err => {
                console.error('Failed to send admin notification:', err);
            });
        }
        
        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id,
                fullName: user.fullName,
                mobile: user.mobile,
                email: user.email,
                walletId: user.walletId,
                apiKey: user.apiKey,
                balance: user.balance,
                isAdmin: user.isAdmin,
                pin_set: user.pin_set,
                isNewUser: user.isNewUser
            },
            message: 'Account created! Please set your PIN to continue.'
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            let message = 'User already exists';
            if (field === 'mobile') {
                message = 'This mobile number is already registered.';
            } else if (field === 'email') {
                message = 'This email is already registered.';
            } else if (field === 'telegramId') {
                message = 'This Telegram ID is already registered.';
            } else if (field === 'walletId') {
                message = 'Wallet ID generation conflict. Please try again.';
            }
            return res.status(200).json({ 
                success: false,
                message: message
            });
        }
        
        res.status(200).json({ 
            success: false,
            message: error.message || 'Registration failed. Please check your details and try again.'
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
        
        console.log('Forgot password request:', { mobile, telegramId });
        
        if (mobile) {
            if (!/^\d{10}$/.test(mobile)) {
                return res.status(200).json({ 
                    success: false,
                    message: 'Please enter a valid 10-digit mobile number.'
                });
            }
            user = await User.findOne({ mobile });
            identifier = mobile;
        } else if (telegramId) {
            if (!/^\d+$/.test(telegramId)) {
                return res.status(200).json({ 
                    success: false,
                    message: 'Please enter a valid Telegram ID (numeric).'
                });
            }
            user = await User.findOne({ telegramId });
            identifier = telegramId;
        } else {
            return res.status(200).json({ 
                success: false,
                message: 'Mobile or Telegram ID is required.'
            });
        }
        
        if (!user) {
            return res.status(200).json({ 
                success: false,
                message: 'No account found with this ' + (mobile ? 'mobile number' : 'Telegram ID') + '.'
            });
        }
        
        if (!user.telegramId) {
            return res.status(200).json({ 
                success: false,
                message: 'Telegram ID not linked to your account. Please contact support.'
            });
        }

        if (!BOT_TOKEN) {
            return res.status(200).json({ 
                success: false,
                message: 'OTP service is not configured. Please contact support.'
            });
        }
        
        const otp = generateOTP();
        const expires = Date.now() + 5 * 60 * 1000;
        global.resetOtpStore.set(identifier, { otp, expires });
        
        console.log(`Forgot password OTP for ${identifier}: ${otp}`);
        
        const otpMessage = 
`🔐 OTP Section

Dear ${user.fullName}, your one time password has been generated.

Your OTP: <code>${otp}</code>
Validity: 5 minutes
Purpose: Password Reset
Time: ${dateTime}

Do not share this OTP with anyone.
If this wasn't you, try to contact with support team.`;
        
        const result = await sendTelegramMessage(user.telegramId, otpMessage);
        
        if (!result.success) {
            console.error('Failed to send OTP via Telegram:', result.error);
            global.resetOtpStore.delete(identifier);
            
            if (result.error === 'Telegram API timeout' || result.error.includes('ECONN')) {
                return res.status(200).json({ 
                    success: false,
                    message: 'Telegram service is unavailable. Please try again in a few moments.'
                });
            }
            
            return res.status(200).json({ 
                success: false,
                message: 'Failed to send OTP. Please make sure you have started the bot and try again.'
            });
        }
        
        console.log('OTP sent successfully to:', user.telegramId);
        
        res.status(200).json({ 
            success: true, 
            message: 'OTP sent successfully to your Telegram'
        });
        
    } catch (error) {
        console.error('Send forgot password OTP error:', error);
        res.status(200).json({ 
            success: false,
            message: 'Failed to send OTP. Please check your connection and try again.'
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
        
        console.log('Reset password request:', { mobile, telegramId, otp });
        
        if (!otp || !password) {
            return res.status(200).json({ 
                success: false,
                message: 'OTP and password are required.'
            });
        }
        
        if (password.length < 4) {
            return res.status(200).json({ 
                success: false,
                message: 'Password must be at least 4 characters long.'
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
                message: 'Mobile or Telegram ID is required.'
            });
        }
        
        if (!user) {
            return res.status(200).json({ 
                success: false,
                message: 'User not found. Please check your details.'
            });
        }
        
        const storedData = global.resetOtpStore?.get(identifier);
        if (!storedData) {
            return res.status(200).json({ 
                success: false,
                message: 'No OTP found. Please request a new OTP.'
            });
        }
        
        if (storedData.otp !== otp) {
            return res.status(200).json({ 
                success: false,
                message: 'Invalid OTP. Please enter the correct 6-digit code.'
            });
        }
        
        if (Date.now() > storedData.expires) {
            global.resetOtpStore.delete(identifier);
            return res.status(200).json({ 
                success: false,
                message: 'OTP expired. Please request a new OTP.'
            });
        }
        
        global.resetOtpStore.delete(identifier);
        
        user.password = password;
        await user.save();
        
        if (user.telegramId && BOT_TOKEN) {
            const confirmMessage = 
`✅ Password Reset

Dear ${user.fullName}, your password has just been changed.

Time: ${dateTime}

Please keep it safe.
If this wasn't you, change your password immediately or contact support team.`;
            
            sendTelegramMessage(user.telegramId, confirmMessage).catch(err => {
                console.error('Failed to send password reset confirmation:', err);
            });
        }
        
        res.status(200).json({ 
            success: true, 
            message: 'Password reset successfully'
        });
        
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(200).json({ 
            success: false,
            message: 'Failed to reset password. Please check your connection and try again.'
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
                email: user.email,
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
        console.error('Get user error:', error);
        res.status(200).json({ 
            success: false, 
            message: 'Failed to fetch user data. Please try again.'
        });
    }
});

// ============================================
// GET USER BY API KEY
// ============================================
router.get('/user-by-apikey/:apiKey', async (req, res) => {
    try {
        const { apiKey } = req.params;
        console.log('Fetching user by API key:', apiKey);

        if (!apiKey) {
            return res.status(200).json({
                success: false,
                message: 'API key is required'
            });
        }

        const user = await User.findOne({ apiKey: apiKey });

        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'User not found with this API key'
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
        console.error('Get user by API key error:', error);
        return res.status(200).json({
            success: false,
            message: 'Server error. Please try again.'
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
                message: 'Telegram ID is required'
            });
        }
        
        const user = await User.findOne({ telegramId: tgid });
        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'User not found'
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
        console.error('Get user by telegram error:', error);
        return res.status(200).json({
            success: false,
            message: 'Server error. Please try again.'
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
                    email: user.email,
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
        console.error('Verify error:', error);
        res.status(200).json({ 
            success: false,
            message: 'Server error. Please try again.'
        });
    }
});

// ==================== TELEGRAM AUTO LOGIN ====================
router.post('/telegram-login', async (req, res) => {
    try {
        const { telegramId } = req.body;
        
        console.log('Telegram auto login request for:', telegramId);
        
        if (!telegramId) {
            return res.status(200).json({
                success: false,
                message: 'Telegram ID is required'
            });
        }
        
        const user = await User.findOne({ telegramId: telegramId });
        
        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'No account found with this Telegram ID'
            });
        }
        
        if (user.isBlocked) {
            return res.status(200).json({
                success: false,
                message: 'Your account has been blocked'
            });
        }
        
        const token = jwt.sign(
            { userId: user._id, isAdmin: user.isAdmin },
            JWT_SECRET,
            { expiresIn: '90d' }
        );
        
        console.log('Auto login successful for:', user.fullName);
        
        res.status(200).json({
            success: true,
            token: token,
            user: {
                id: user._id,
                fullName: user.fullName,
                mobile: user.mobile,
                email: user.email,
                walletId: user.walletId,
                balance: user.balance || 0,
                isAdmin: user.isAdmin,
                pin_set: user.pin_set,
                isNewUser: user.isNewUser || false,
                createdAt: user.createdAt
            }
        });
        
    } catch (error) {
        console.error('Telegram auto login error:', error);
        res.status(200).json({
            success: false,
            message: 'Auto login failed. Please try again.'
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
        console.error('Get user by mobile error:', error);
        return res.status(200).json({
            success: false,
            message: 'Server error'
        });
    }
});
        
module.exports = router;
