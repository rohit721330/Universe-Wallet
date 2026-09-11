// FILE: routes/auth.js
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const nodemailer = require('nodemailer');
require('dotenv').config();

// ===== INITIALIZE GLOBAL STORES =====
if (!global.loginOtpStore) global.loginOtpStore = new Map();
if (!global.regOtpStore) global.regOtpStore = new Map();
if (!global.resetOtpStore) global.resetOtpStore = new Map();
if (!global.regTelegramOtpStore) global.regTelegramOtpStore = new Map();

// ===== RATE LIMITERS =====
const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, message: 'Too many OTP requests. Please try again later.' }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { success: false, message: 'Too many login attempts. Please try again later.' }
});

// ===== ENV =====
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID;
const JWT_SECRET = process.env.JWT_SECRET;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

if (!BOT_TOKEN) console.error('❌ Bot token is not set.');
if (!ADMIN_TG_ID) console.error('❌ Admin TG ID is not set.');
if (!JWT_SECRET) console.error('❌ JWT secret is not set.');
if (!EMAIL_USER || !EMAIL_PASS) console.error('❌ Email credentials are not set.');

// ===== CONSTANTS =====
const OTP_VALIDITY_MS = 5 * 60 * 1000;
const OTP_COOLDOWN_MS = 3 * 60 * 1000;
const TELEGRAM_VERIFY_VALIDITY_MS = 30 * 60 * 1000;

// ============================================
// EMAIL TRANSPORTER — FAST & TIMEOUT-SAFE
// ============================================
const emailTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    connectionTimeout: 5000,      // 5s (fast fail)
    greetingTimeout: 5000,        // 5s
    socketTimeout: 8000,          // 8s
    rateDelta: 1000,
    rateLimit: 5,
    auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
    },
    tls: {
        rejectUnauthorized: false,
        minVersion: 'TLSv1.2'
    }
});

// ============================================
// EMAIL OTP SENDER
// ============================================
async function sendOtpEmail({ to, name, otp, purpose = 'Verification' }) {
    if (!EMAIL_USER || !EMAIL_PASS) {
        return { success: false, error: 'Email service not configured' };
    }
    if (!to) {
        return { success: false, error: 'Recipient email is required' };
    }

    try {
        const dateTime = new Date().toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'medium',
            timeStyle: 'short'
        });

        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #f0f4f8; margin: 0; padding: 20px; }
        .container { max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,50,100,0.1); }
        .header { background: linear-gradient(135deg, #1a56db, #2563eb); padding: 30px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 22px; letter-spacing: 2px; text-transform: uppercase; }
        .header p { margin: 6px 0 0; font-size: 12px; letter-spacing: 2px; opacity: 0.9; }
        .body { padding: 30px; color: #1a2a4a; }
        .greeting { font-size: 16px; font-weight: 600; margin-bottom: 10px; }
        .message { font-size: 14px; color: #5a7a9a; line-height: 1.6; margin-bottom: 24px; }
        .otp-box { background: #f0f7ff; border: 2px dashed #1a56db; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0; }
        .otp-label { font-size: 12px; color: #5a7a9a; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 8px; }
        .otp-code { font-size: 36px; font-weight: 900; color: #1a56db; letter-spacing: 8px; font-family: 'Courier New', monospace; }
        .details { background: #fafcff; border-left: 4px solid #1a56db; border-radius: 8px; padding: 14px 18px; margin: 20px 0; }
        .details-row { font-size: 13px; color: #1a3a6b; padding: 3px 0; }
        .details-row strong { color: #5a7a9a; display: inline-block; width: 90px; }
        .warning { background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #92400e; margin-top: 20px; }
        .footer { background: #f0f4f8; padding: 20px; text-align: center; font-size: 11px; color: #5a7a9a; letter-spacing: 1px; }
        .footer strong { color: #1a56db; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔐 Universal Wallet</h1>
            <p>DIGITAL WALLET • SECURE • FAST</p>
        </div>
        <div class="body">
            <div class="greeting">Dear ${name || 'User'},</div>
            <div class="message">
                Your One-Time Password (OTP) has been generated for <strong>${purpose}</strong>. Please use the code below to continue.
            </div>
            <div class="otp-box">
                <div class="otp-label">Your OTP Code</div>
                <div class="otp-code">${otp}</div>
            </div>
            <div class="details">
                <div class="details-row"><strong>Validity:</strong> 5 minutes</div>
                <div class="details-row"><strong>Purpose:</strong> ${purpose}</div>
                <div class="details-row"><strong>Time:</strong> ${dateTime}</div>
            </div>
            <div class="warning">
                ⚠️ <strong>Never share this OTP</strong> with anyone. Our team will never ask for your OTP.
            </div>
        </div>
        <div class="footer">
            ⚡ POWERED BY <strong>UNIVERSAL WALLET</strong> ⚡
        </div>
    </div>
</body>
</html>`;

        const info = await emailTransporter.sendMail({
            from: `"UNIVERSAL WALLET" <${EMAIL_USER}>`,
            to: to,
            subject: `🔐 Your OTP for ${purpose} - Universal Wallet`,
            html: html,
            text: `Dear ${name || 'User'},\n\nYour OTP for ${purpose} is: ${otp}\n\nValidity: 5 minutes\n\nNever share this OTP.`
        });

        console.log('✅ Email sent:', info.messageId, '→', to);
        return { success: true };
    } catch (error) {
        console.error('❌ Failed to send email:', error.message);
        return { success: false, error: error.message };
    }
}

// ============================================
// HELPERS
// ============================================
async function sendTelegramMessage(chatId, message) {
    if (!BOT_TOKEN) return { success: false, error: 'BOT_TOKEN not configured' };
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const response = await axios.post(url, {
            chat_id: chatId, text: message, parse_mode: 'HTML'
        }, { timeout: 15000, headers: { 'Content-Type': 'application/json' } });
        if (response.data && response.data.ok) return { success: true };
        return { success: false, error: response.data?.description || 'Unknown' };
    } catch (error) {
        if (error.code === 'ECONNABORTED') return { success: false, error: 'Telegram API timeout' };
        return { success: false, error: error.message };
    }
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getCurrentDateTime() {
    return new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
}

function getClientIp(req) {
    return req.headers['x-forwarded-for'] || req.connection.remoteAddress ||
           req.socket.remoteAddress || req.ip || 'Unknown';
}

// ============================================
// EMAIL MASKING
// ============================================
function maskEmail(email) {
    if (!email || !email.includes('@')) return email || '';
    const [local, domain] = email.split('@');
    const len = local.length;
    if (len <= 6) {
        const first = local.substring(0, Math.min(2, len));
        const last = len > 3 ? local.substring(len - 2) : '';
        return first + '***' + last + '@' + domain;
    }
    const firstThree = local.substring(0, 3);
    const lastThree = local.substring(len - 3);
    const stars = '*'.repeat(len - 6);
    return `${firstThree}${stars}${lastThree}@${domain}`;
}

// ============================================
// COOLDOWN HELPER
// ============================================
function checkCooldown(store, key) {
    const data = store.get(key);
    if (data && data.lastSent) {
        const elapsed = Date.now() - data.lastSent;
        if (elapsed < OTP_COOLDOWN_MS) {
            const remaining = Math.ceil((OTP_COOLDOWN_MS - elapsed) / 1000);
            const min = Math.floor(remaining / 60);
            const sec = remaining % 60;
            return {
                blocked: true,
                remaining,
                message: `Please wait ${min}:${sec.toString().padStart(2, '0')} before requesting a new OTP.`
            };
        }
    }
    return { blocked: false };
}

function cleanExpiredOtps() {
    const now = Date.now();
    const stores = [
        global.loginOtpStore,
        global.regOtpStore,
        global.resetOtpStore,
        global.regTelegramOtpStore
    ];
    stores.forEach(store => {
        if (store) {
            for (const [key, value] of store.entries()) {
                const expiresDone = value.expires && value.expires < now;
                const cooldownDone = !value.lastSent || (now - value.lastSent) > OTP_COOLDOWN_MS;
                if (expiresDone && cooldownDone) store.delete(key);
            }
        }
    });
}
setInterval(cleanExpiredOtps, 5 * 60 * 1000);

// ============================================
// VERIFY TOKEN MIDDLEWARE
// ============================================
const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(200).json({ success: false, message: 'No token provided' });
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });
        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') return res.status(200).json({ success: false, message: 'Invalid token' });
        if (error.name === 'TokenExpiredError') return res.status(200).json({ success: false, message: 'Token expired' });
        return res.status(200).json({ success: false, message: 'Auth error. Please try again.' });
    }
};

// ============================================
// SEND OTP FOR LOGIN — FIXED (await)
// ============================================
router.post('/send-login-otp', otpLimiter, async (req, res) => {
    try {
        const { mobile } = req.body;
        console.log('Login OTP request for mobile:', mobile);

        if (!mobile || !/^\d{10}$/.test(mobile)) {
            return res.status(200).json({ success: false, message: 'Please enter a valid 10-digit mobile number.' });
        }

        const user = await User.findOne({ mobile });
        if (!user) {
            return res.status(200).json({ success: false, message: 'No account found with this mobile number.' });
        }
        if (!user.email) {
            return res.status(200).json({ success: false, message: 'Email not linked to your account.' });
        }
        if (!EMAIL_USER || !EMAIL_PASS) {
            return res.status(200).json({ success: false, message: 'Email service is not configured.' });
        }

        const cd = checkCooldown(global.loginOtpStore, mobile);
        if (cd.blocked) {
            return res.status(200).json({
                success: false,
                message: cd.message,
                cooldown: cd.remaining
            });
        }

        const otp = generateOTP();
        const expires = Date.now() + OTP_VALIDITY_MS;
        global.loginOtpStore.set(mobile, { otp, expires, lastSent: Date.now() });
        console.log(`🔐 Login OTP for ${mobile}: ${otp}`);

        // ✅ AWAIT email sending — real success/error
        const result = await sendOtpEmail({
            to: user.email, name: user.fullName, otp, purpose: 'Login'
        });

        if (!result.success) {
            console.error('Email send failed for login OTP:', result.error);
            global.loginOtpStore.delete(mobile);
            return res.status(200).json({
                success: false,
                message: 'Failed to send OTP to email. Please try again later.'
            });
        }

        res.status(200).json({
            success: true,
            message: 'OTP sent to your email',
            email: maskEmail(user.email),
            cooldown: Math.floor(OTP_COOLDOWN_MS / 1000)
        });
    } catch (error) {
        console.error('Send login OTP error:', error);
        res.status(200).json({ success: false, message: 'Failed to send OTP. Please try again.' });
    }
});

// ============================================
// LOGIN WITH OTP
// ============================================
router.post('/login-with-otp', loginLimiter, async (req, res) => {
    try {
        const { mobile, otp } = req.body;
        const clientIp = getClientIp(req);
        const dateTime = getCurrentDateTime();

        if (!mobile || !otp) {
            return res.status(200).json({ success: false, message: 'Mobile & OTP required' });
        }

        const storedData = global.loginOtpStore?.get(mobile);
        if (!storedData) {
            return res.status(200).json({ success: false, message: 'No OTP found. Please request a new OTP.' });
        }
        if (storedData.otp !== otp) {
            return res.status(200).json({ success: false, message: 'Invalid OTP. Please enter the correct 6-digit code.' });
        }
        if (Date.now() > storedData.expires) {
            global.loginOtpStore.delete(mobile);
            return res.status(200).json({ success: false, message: 'OTP expired. Please request a new OTP.' });
        }

        const user = await User.findOne({ mobile });
        if (!user) return res.status(200).json({ success: false, message: 'User not found.' });
        if (user.isBlocked) return res.status(200).json({ success: false, message: 'Your account has been blocked.' });

        global.loginOtpStore.delete(mobile);

        const token = jwt.sign({ userId: user._id, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '90d' });

        if (user.telegramId && BOT_TOKEN) {
            const loginMessage = `🚨 New Login Detected\n\nDear ${user.fullName}, a new login was detected.\n\nMobile: ${user.mobile}\nPurpose: OTP Login\nIP: ${clientIp}\nTime: ${dateTime}\n\nIf this wasn't you, please contact support.`;
            sendTelegramMessage(user.telegramId, loginMessage).catch(() => {});
        }

        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id, fullName: user.fullName, mobile: user.mobile,
                email: user.email, walletId: user.walletId, balance: user.balance,
                isAdmin: user.isAdmin, pin_set: user.pin_set,
                isNewUser: user.isNewUser || false
            }
        });
    } catch (error) {
        console.error('Login with OTP error:', error);
        res.status(200).json({ success: false, message: 'Login with OTP failed. Please try again.' });
    }
});

// ============================================
// SEND OTP FOR REGISTRATION (EMAIL) — FIXED (await)
// ============================================
router.post('/send-registration-otp', otpLimiter, async (req, res) => {
    try {
        const { email, name } = req.body;
        console.log('Registration email OTP request:', { email, name });

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(200).json({ success: false, message: 'Please provide a valid email address.' });
        }

        const lowerEmail = email.toLowerCase();

        const existingUser = await User.findOne({ email: lowerEmail });
        if (existingUser) {
            return res.status(200).json({ success: false, message: 'This email is already registered. Please login.' });
        }

        if (!EMAIL_USER || !EMAIL_PASS) {
            return res.status(200).json({ success: false, message: 'Email service is not configured.' });
        }

        const cd = checkCooldown(global.regOtpStore, lowerEmail);
        if (cd.blocked) {
            return res.status(200).json({
                success: false,
                message: cd.message,
                cooldown: cd.remaining
            });
        }

        const otp = generateOTP();
        const expires = Date.now() + OTP_VALIDITY_MS;
        global.regOtpStore.set(lowerEmail, { otp, expires, lastSent: Date.now() });
        console.log(`🔐 Registration Email OTP for ${email}: ${otp}`);

        // ✅ AWAIT email sending — real success/error
        const result = await sendOtpEmail({
            to: email, name: name || 'User', otp, purpose: 'Registration'
        });

        if (!result.success) {
            console.error('Email send failed for registration OTP:', result.error);
            global.regOtpStore.delete(lowerEmail);
            return res.status(200).json({
                success: false,
                message: 'Failed to send OTP to email. Please check the email address or try again later.'
            });
        }

        res.status(200).json({
            success: true,
            message: 'OTP sent to your email',
            email: maskEmail(email),
            cooldown: Math.floor(OTP_COOLDOWN_MS / 1000)
        });
    } catch (error) {
        console.error('Send registration OTP error:', error);
        res.status(200).json({ success: false, message: 'Failed to send OTP. Please try again.' });
    }
});

// ============================================
// SEND OTP FOR TELEGRAM VERIFICATION
// ============================================
router.post('/send-telegram-otp', otpLimiter, async (req, res) => {
    try {
        const { telegramId, name } = req.body;
        console.log('Telegram OTP request:', { telegramId, name });

        if (!telegramId || !/^\d{6,15}$/.test(String(telegramId))) {
            return res.status(200).json({
                success: false,
                message: 'Please enter a valid Telegram numeric ID (6-15 digits).'
            });
        }

        if (!BOT_TOKEN) {
            return res.status(200).json({
                success: false,
                message: 'Telegram service is not configured.'
            });
        }

        const tgKey = String(telegramId);

        const existingTgUser = await User.findOne({ telegramId: tgKey });
        if (existingTgUser) {
            return res.status(200).json({
                success: false,
                message: 'This Telegram ID is already registered. Please login.'
            });
        }

        const cd = checkCooldown(global.regTelegramOtpStore, tgKey);
        if (cd.blocked) {
            return res.status(200).json({
                success: false,
                message: cd.message,
                cooldown: cd.remaining
            });
        }

        const otp = generateOTP();
        const expires = Date.now() + OTP_VALIDITY_MS;

        global.regTelegramOtpStore.set(tgKey, {
            otp, expires, lastSent: Date.now(), verified: false
        });

        console.log(`🔐 Telegram Registration OTP for ${tgKey}: ${otp}`);

        const message =
`🔐 <b>Universal Wallet — Registration OTP</b>

Dear <b>${name || 'User'}</b>,

Your OTP for <b>Registration Verification</b>:

<code>${otp}</code>

⏱️ Valid for <b>5 minutes</b>
⚠️ Never share this OTP with anyone.`;

        const result = await sendTelegramMessage(tgKey, message);

        if (!result.success) {
            global.regTelegramOtpStore.delete(tgKey);
            return res.status(200).json({
                success: false,
                message: 'Failed to send Telegram OTP. Please start our bot first, then retry.'
            });
        }

        res.status(200).json({
            success: true,
            message: 'OTP sent to your Telegram',
            cooldown: Math.floor(OTP_COOLDOWN_MS / 1000)
        });
    } catch (error) {
        console.error('Send telegram OTP error:', error);
        res.status(200).json({ success: false, message: 'Failed to send Telegram OTP.' });
    }
});

// ============================================
// VERIFY TELEGRAM OTP
// ============================================
router.post('/verify-telegram-otp', async (req, res) => {
    try {
        const { telegramId, otp } = req.body;

        if (!telegramId || !otp) {
            return res.status(200).json({ success: false, message: 'Telegram ID and OTP required.' });
        }

        const tgKey = String(telegramId);
        const stored = global.regTelegramOtpStore?.get(tgKey);

        if (!stored) {
            return res.status(200).json({ success: false, message: 'No OTP found. Please request a new one.' });
        }
        if (stored.otp !== otp) {
            return res.status(200).json({ success: false, message: 'Invalid OTP. Please check and try again.' });
        }
        if (Date.now() > stored.expires) {
            global.regTelegramOtpStore.delete(tgKey);
            return res.status(200).json({ success: false, message: 'OTP expired. Please request a new OTP.' });
        }

        stored.verified = true;
        stored.verifiedAt = Date.now();
        global.regTelegramOtpStore.set(tgKey, stored);

        res.status(200).json({ success: true, message: 'Telegram verified successfully.' });
    } catch (error) {
        console.error('Verify telegram OTP error:', error);
        res.status(200).json({ success: false, message: 'Verification failed.' });
    }
});

// ============================================
// REGISTER NEW USER
// ============================================
router.post('/register', async (req, res) => {
    try {
        const { name, mobile, email, password, otp, telegramId } = req.body;
        const dateTime = getCurrentDateTime();
        const clientIp = getClientIp(req);

        console.log('Registration request:', { name, mobile, email, telegramId, otp: otp ? 'Provided' : 'Missing' });

        if (!name || !mobile || !email || !password || !otp || !telegramId) {
            const missing = [];
            if (!name) missing.push('Name');
            if (!mobile) missing.push('Mobile');
            if (!email) missing.push('Email');
            if (!password) missing.push('Password');
            if (!otp) missing.push('Email OTP');
            if (!telegramId) missing.push('Telegram ID');
            return res.status(200).json({ success: false, message: `Missing fields: ${missing.join(', ')}` });
        }

        if (!/^[9|8|7][0-9]{9}$/.test(mobile)) {
            return res.status(200).json({ success: false, message: 'Invalid mobile number. Must start with 9, 8, or 7.' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(200).json({ success: false, message: 'Invalid email address.' });
        }
        if (password.length < 8 || password.length > 15) {
            return res.status(200).json({ success: false, message: 'Password must be 8-15 characters long.' });
        }
        if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
            return res.status(200).json({ success: false, message: 'Password must contain uppercase, lowercase, and number.' });
        }
        if (!/^\d{6,15}$/.test(String(telegramId))) {
            return res.status(200).json({ success: false, message: 'Invalid Telegram ID. Must be 6-15 digits.' });
        }

        const lowerEmail = email.toLowerCase();
        const tgKey = String(telegramId);

        const emailStored = global.regOtpStore?.get(lowerEmail);
        if (!emailStored) {
            return res.status(200).json({ success: false, message: 'Email OTP not found. Please request a new OTP.' });
        }
        if (emailStored.otp !== otp) {
            return res.status(200).json({ success: false, message: 'Invalid Email OTP.' });
        }
        if (Date.now() > emailStored.expires) {
            global.regOtpStore.delete(lowerEmail);
            return res.status(200).json({ success: false, message: 'Email OTP expired. Please request a new OTP.' });
        }

        const tgStored = global.regTelegramOtpStore?.get(tgKey);
        if (!tgStored) {
            return res.status(200).json({ success: false, message: 'Please verify your Telegram OTP first.' });
        }
        if (!tgStored.verified) {
            return res.status(200).json({ success: false, message: 'Telegram verification is incomplete. Please verify your Telegram OTP.' });
        }
        if (Date.now() - tgStored.verifiedAt > TELEGRAM_VERIFY_VALIDITY_MS) {
            global.regTelegramOtpStore.delete(tgKey);
            return res.status(200).json({ success: false, message: 'Telegram verification expired. Please verify again.' });
        }

        const existingUser = await User.findOne({
            $or: [{ mobile }, { email: lowerEmail }, { telegramId: tgKey }]
        });
        if (existingUser) {
            let errorMsg = 'User already exists';
            if (existingUser.mobile === mobile) errorMsg = 'This mobile number is already registered. Please login.';
            else if (existingUser.email === lowerEmail) errorMsg = 'This email is already registered. Please login.';
            else if (String(existingUser.telegramId) === tgKey) errorMsg = 'This Telegram ID is already registered. Please login.';
            return res.status(200).json({ success: false, message: errorMsg });
        }

        const user = await User.create({
            fullName: name,
            mobile: mobile,
            email: lowerEmail,
            password: password,
            telegramId: tgKey,
            balance: 0,
            pin: null,
            pin_set: false,
            isNewUser: true,
            isAdmin: false,
            isBlocked: false
        });

        global.regOtpStore.delete(lowerEmail);
        global.regTelegramOtpStore.delete(tgKey);

        console.log('✅ User created:', user._id, '| WalletID:', user.walletId, '| TG:', tgKey);

        const token = jwt.sign({ userId: user._id, isAdmin: false }, JWT_SECRET, { expiresIn: '90d' });

        if (ADMIN_TG_ID && BOT_TOKEN) {
            const adminMsg = `🆕 New User Registered\n\nName: ${name}\nMobile: ${mobile}\nEmail: ${email}\nTelegram: ${telegramId}\nWallet ID: ${user.walletId}\nIP: ${clientIp}\nTime: ${dateTime}`;
            sendTelegramMessage(ADMIN_TG_ID, adminMsg).catch(() => {});
        }

        if (BOT_TOKEN) {
            const welcomeMsg =
`🎉 <b>Welcome to Universal Wallet!</b>

Dear <b>${name}</b>,

Your account has been created successfully.

📱 Mobile: <code>${mobile}</code>
💼 Wallet ID: <code>${user.walletId}</code>

Please set your PIN in the app to continue.`;

            sendTelegramMessage(tgKey, welcomeMsg).catch(() => {});
        }

        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id, fullName: user.fullName, mobile: user.mobile,
                email: user.email, walletId: user.walletId, apiKey: user.apiKey,
                telegramId: user.telegramId,
                balance: user.balance, isAdmin: user.isAdmin,
                pin_set: user.pin_set, isNewUser: user.isNewUser
            },
            message: 'Account created! Please set your PIN to continue.'
        });
    } catch (error) {
        console.error('Registration error:', error);
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            let message = 'User already exists';
            if (field === 'mobile') message = 'This mobile number is already registered.';
            else if (field === 'email') message = 'This email is already registered.';
            else if (field === 'telegramId') message = 'This Telegram ID is already registered.';
            else if (field === 'walletId') message = 'Wallet ID conflict. Please try again.';
            else if (field === 'apiKey') message = 'API Key conflict. Please try again.';
            return res.status(200).json({ success: false, message });
        }
        res.status(200).json({ success: false, message: error.message || 'Registration failed.' });
    }
});

// ============================================
// LOGIN WITH PASSWORD
// ============================================
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { mobile, password } = req.body;
        const clientIp = getClientIp(req);
        const dateTime = getCurrentDateTime();

        if (!mobile || !password) {
            return res.status(200).json({ success: false, message: 'Mobile & password required' });
        }

        const user = await User.findOne({ mobile });
        if (!user) return res.status(200).json({ success: false, message: 'User not found. Please check your mobile number.' });

        if (user.password !== password) {
            return res.status(200).json({ success: false, message: 'Invalid password. Please try again.' });
        }
        if (user.isBlocked) {
            return res.status(200).json({ success: false, message: 'Your account has been blocked. Please contact support.' });
        }

        const token = jwt.sign({ userId: user._id, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '90d' });

        if (user.telegramId && BOT_TOKEN) {
            const loginMessage = `🚨 New Login\n\nDear ${user.fullName}, a new login was detected.\n\nMobile: ${user.mobile}\nPurpose: Password Login\nIP: ${clientIp}\nTime: ${dateTime}`;
            sendTelegramMessage(user.telegramId, loginMessage).catch(() => {});
        }

        res.status(200).json({
            success: true, token,
            user: {
                id: user._id, fullName: user.fullName, mobile: user.mobile,
                email: user.email, walletId: user.walletId, balance: user.balance,
                isAdmin: user.isAdmin, pin_set: user.pin_set,
                isNewUser: user.isNewUser || false
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(200).json({ success: false, message: 'Login failed. Please try again.' });
    }
});

// ============================================
// SEND OTP FOR FORGOT PASSWORD — FIXED (await)
// ============================================
router.post('/send-forgot-password-otp', otpLimiter, async (req, res) => {
    try {
        const { mobile, email } = req.body;
        let user = null;
        let identifier = null;

        if (mobile) {
            if (!/^\d{10}$/.test(mobile)) {
                return res.status(200).json({ success: false, message: 'Please enter a valid 10-digit mobile number.' });
            }
            user = await User.findOne({ mobile });
            identifier = mobile;
        } else if (email) {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(200).json({ success: false, message: 'Please enter a valid email address.' });
            }
            user = await User.findOne({ email: email.toLowerCase() });
            identifier = email.toLowerCase();
        } else {
            return res.status(200).json({ success: false, message: 'Mobile or email is required.' });
        }

        if (!user) {
            return res.status(200).json({ success: false, message: 'No account found with this ' + (mobile ? 'mobile number' : 'email') + '.' });
        }
        if (!user.email) {
            return res.status(200).json({ success: false, message: 'Email not linked to your account.' });
        }
        if (!EMAIL_USER || !EMAIL_PASS) {
            return res.status(200).json({ success: false, message: 'Email service is not configured.' });
        }

        const cd = checkCooldown(global.resetOtpStore, identifier);
        if (cd.blocked) {
            return res.status(200).json({ success: false, message: cd.message, cooldown: cd.remaining });
        }

        const otp = generateOTP();
        const expires = Date.now() + OTP_VALIDITY_MS;
        global.resetOtpStore.set(identifier, { otp, expires, lastSent: Date.now() });
        console.log(`🔐 Forgot password OTP for ${identifier}: ${otp}`);

        // ✅ AWAIT email sending
        const result = await sendOtpEmail({
            to: user.email, name: user.fullName, otp, purpose: 'Password Reset'
        });

        if (!result.success) {
            console.error('Email send failed:', result.error);
            global.resetOtpStore.delete(identifier);
            return res.status(200).json({
                success: false,
                message: 'Failed to send OTP to email. Please try again later.'
            });
        }

        res.status(200).json({
            success: true,
            message: 'OTP sent to your email',
            email: maskEmail(user.email),
            cooldown: Math.floor(OTP_COOLDOWN_MS / 1000)
        });
    } catch (error) {
        console.error('Send forgot password OTP error:', error);
        res.status(200).json({ success: false, message: 'Failed to send OTP. Please try again.' });
    }
});

// ============================================
// RESET PASSWORD
// ============================================
router.post('/reset-password', async (req, res) => {
    try {
        const { mobile, email, otp, password } = req.body;
        let identifier = null;
        let user = null;

        if (!otp || !password) {
            return res.status(200).json({ success: false, message: 'OTP and password are required.' });
        }
        if (password.length < 4) {
            return res.status(200).json({ success: false, message: 'Password must be at least 4 characters long.' });
        }

        if (mobile) {
            user = await User.findOne({ mobile });
            identifier = mobile;
        } else if (email) {
            user = await User.findOne({ email: email.toLowerCase() });
            identifier = email.toLowerCase();
        } else {
            return res.status(200).json({ success: false, message: 'Mobile or email is required.' });
        }

        if (!user) return res.status(200).json({ success: false, message: 'User not found.' });

        const storedData = global.resetOtpStore?.get(identifier);
        if (!storedData) return res.status(200).json({ success: false, message: 'No OTP found. Please request a new OTP.' });
        if (storedData.otp !== otp) return res.status(200).json({ success: false, message: 'Invalid OTP.' });
        if (Date.now() > storedData.expires) {
            global.resetOtpStore.delete(identifier);
            return res.status(200).json({ success: false, message: 'OTP expired. Please request a new OTP.' });
        }

        global.resetOtpStore.delete(identifier);
        user.password = password;
        await user.save();

        res.status(200).json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(200).json({ success: false, message: 'Failed to reset password.' });
    }
});

// ============================================
// VERIFY OTP (generic)
// ============================================
router.post('/verify-otp', async (req, res) => {
    try {
        const { mobile, email, otp } = req.body;
        if (!otp) return res.status(200).json({ success: false, message: 'OTP is required' });

        let storedData = null;
        let identifier = null;

        if (mobile) { storedData = global.resetOtpStore?.get(mobile); identifier = mobile; }
        else if (email) { storedData = global.resetOtpStore?.get(email.toLowerCase()); identifier = email.toLowerCase(); }
        else return res.status(200).json({ success: false, message: 'Mobile or email is required' });

        if (!storedData) return res.status(200).json({ success: false, message: 'No OTP found.' });
        if (storedData.otp !== otp) return res.status(200).json({ success: false, message: 'Invalid OTP.' });
        if (Date.now() > storedData.expires) {
            global.resetOtpStore.delete(identifier);
            return res.status(200).json({ success: false, message: 'OTP expired.' });
        }

        res.status(200).json({ success: true, verified: true, message: 'OTP verified successfully' });
    } catch (error) {
        res.status(200).json({ success: false, message: 'Server error.' });
    }
});

// ============================================
// GET CURRENT USER
// ============================================
router.get('/me', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        res.status(200).json({
            success: true,
            user: {
                id: user._id, fullName: user.fullName, mobile: user.mobile,
                email: user.email, walletId: user.walletId, apiKey: user.apiKey,
                telegramId: user.telegramId, balance: user.balance,
                pin_set: user.pin_set, isNewUser: user.isNewUser || false,
                isAdmin: user.isAdmin, createdAt: user.createdAt,
                profilePicture: user.profilePicture || null
            }
        });
    } catch (error) {
        res.status(200).json({ success: false, message: 'Failed to fetch user data.' });
    }
});

// ============================================
// VERIFY TOKEN
// ============================================
router.get('/verify', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        res.status(200).json({
            success: true,
            data: {
                user: {
                    id: user._id, fullName: user.fullName, mobile: user.mobile,
                    email: user.email, walletId: user.walletId, telegramId: user.telegramId,
                    balance: user.balance || 0, pin_set: user.pin_set,
                    isNewUser: user.isNewUser || false, isAdmin: user.isAdmin,
                    createdAt: user.createdAt
                }
            }
        });
    } catch (error) {
        res.status(200).json({ success: false, message: 'Server error.' });
    }
});

// ============================================
// GET USER BY API KEY
// ============================================
router.get('/user-by-apikey/:apiKey', async (req, res) => {
    try {
        const { apiKey } = req.params;
        if (!apiKey) return res.status(200).json({ success: false, message: 'API key is required' });
        const user = await User.findOne({ apiKey });
        if (!user) return res.status(200).json({ success: false, message: 'User not found with this API key' });
        return res.status(200).json({
            success: true, mobile: user.mobile, fullName: user.fullName,
            walletId: user.walletId, balance: user.balance
        });
    } catch (error) {
        return res.status(200).json({ success: false, message: 'Server error.' });
    }
});

// ============================================
// GET USER BY MOBILE
// ============================================
router.get('/user-by-mobile/:mobile', async (req, res) => {
    try {
        const { mobile } = req.params;
        if (!mobile) return res.status(200).json({ success: false, message: 'Mobile is required' });
        const user = await User.findOne({ mobile });
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });
        return res.status(200).json({
            success: true, email: user.email, fullName: user.fullName,
            mobile: user.mobile, walletId: user.walletId
        });
    } catch (error) {
        return res.status(200).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
