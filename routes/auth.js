// FILE: routes/auth.js
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Otp = require('../models/Otp');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
require('dotenv').config();

// =========================================================
// RATE LIMITERS
// =========================================================
const otpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: 'Too Many OTP Requests. Please Try Again Later.' }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    message: { success: false, message: 'Too Many Login Attempts. Please Try Again Later.' }
});

// =========================================================
// ENV CONFIGURATION
// =========================================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID;
const JWT_SECRET = process.env.JWT_SECRET;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASS = process.env.EMAIL_PASS;

if (!BOT_TOKEN) console.error('❌ Bot Token Is Not Set In Environment Variables.');
if (!ADMIN_TG_ID) console.error('❌ Admin TG Id Is Not Set In Environment Variables.');
if (!JWT_SECRET) console.error('❌ JWT Secret Is Not Set In Environment Variables.');

// =========================================================
// VERIFY TOKEN (Middleware)
// =========================================================
const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(200).json({ success: false, message: 'No Token Provided' });
        }
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(200).json({ success: false, message: 'User Not Found' });
        }

        // ✅ Deleted user check
        if (user.isDeleted) {
            return res.status(200).json({
                success: false,
                message: 'This account has been deleted. Please contact support.'
            });
        }

        // ✅ Blocked user check
        if (user.isBlocked) {
            return res.status(200).json({
                success: false,
                message: 'Your account has been blocked. Please contact support.'
            });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Unknown Error:', error);
        if (error.name === 'JsonWebTokenError') {
            return res.status(200).json({ success: false, message: 'Invalid Token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(200).json({ success: false, message: 'Token Expired' });
        }
        return res.status(200).json({ success: false, message: 'Auth Error. Please Try Again.' });
    }
};

// =========================================================
// HELPER: Send Telegram Message
// =========================================================
async function sendTelegramMessage(chatId, message) {
    if (!BOT_TOKEN) {
        console.error('❌ Cannot Send Telegram Message. Bot Token Not Set.');
        return { success: false, error: 'BOT_TOKEN not configured' };
    }
    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        console.log('📤 Sending Telegram Message To Chat:', chatId);
        const response = await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        }, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' }
        });
        if (response.data && response.data.ok) {
            console.log('✅ Telegram Message Sent To Chat:', chatId);
            return { success: true };
        } else {
            console.error('❌ Telegram API Response:', response.data?.description || 'Unknown Error');
            return { success: false, error: response.data?.description || 'Unknown Error' };
        }
    } catch (error) {
        console.error('❌ Failed To Send Telegram Message:', error.message);
        if (error.response) console.error('Telegram API Response:', error.response.data);
        if (error.code === 'ECONNABORTED') return { success: false, error: 'Telegram API Time Out' };
        return { success: false, error: error.message };
    }
}

// =========================================================
// HELPER: Send OTP via Email
// =========================================================
async function sendOtpViaEmail(email, otp, name, purpose = 'Verification') {
    try {
        const nodemailer = require('nodemailer');
        const dateTime = getCurrentDateTime();
        if (!EMAIL_USER || !EMAIL_PASS) {
            console.error('❌ Email credentials not configured');
            return { success: false, error: 'Email service not configured' };
        }
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            port: 465,
            secure: true,
            auth: {
                user: EMAIL_USER,
                pass: EMAIL_PASS
            },
            connectionTimeout: 15000,
            greetingTimeout: 15000,
            socketTimeout: 20000,
            pool: true,
            maxConnections: 1,
            maxMessages: 50,
            tls: { rejectUnauthorized: false }
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

        const mailOptions = {
            from: `"UNIVERSAL WALLET" <${EMAIL_USER}>`,
            to: email,
            subject: '🔐 Your OTP for Universal Wallet',
            html: html,
            text: `Dear ${name || 'User'},\n\nYour OTP for ${purpose} is: ${otp}\n\nValidity: 5 minutes\n\nNever share this OTP.`
        };
        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Email sent:', info.messageId);
        return { success: true };
    } catch (error) {
        console.error('❌ Email send error:', error);
        return { success: false, error: error.message };
    }
}

// =========================================================
// HELPERS: Generators & Utilities
// =========================================================
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

function getCurrentDateTime() {
    const now = new Date();
    const options = {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    };
    return now.toLocaleString('en-IN', options);
}

// ✅ FIX: deprecated req.connection হটানো হয়েছে
function getClientIp(req) {
    return req.headers['x-forwarded-for'] ||
           req.socket?.remoteAddress ||
           req.connection?.remoteAddress ||
           req.ip ||
           'Unknown';
}

// ✅ FIX: masked email helper (uniform all places)
function maskEmail(email) {
    if (!email || !email.includes('@')) return email || '';
    const [local, domain] = email.split('@');
    if (local.length <= 3) {
        return local[0] + '***@' + domain;
    }
    return local.substring(0, 3) + '***' + local.substring(local.length - 2) + '@' + domain;
}

// =========================================================
// MongoDB OTP Helpers (Vercel-safe)
// =========================================================
async function saveOtp(identifier, type, otp) {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await Otp.findOneAndUpdate(
        { identifier: String(identifier), type },
        { otp, expiresAt },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
}

async function getOtp(identifier, type) {
    const record = await Otp.findOne({ identifier: String(identifier), type });
    if (!record) return null;
    if (record.expiresAt < new Date()) {
        await Otp.deleteOne({ _id: record._id });
        return null;
    }
    return record;
}

async function deleteOtp(identifier, type) {
    await Otp.deleteOne({ identifier: String(identifier), type });
}

// =========================================================
// USER RESPONSE SHAPE (uniform for all routes)
// =========================================================
function buildUserResponse(user) {
    return {
        id: user._id,
        fullName: user.fullName,
        mobile: user.mobile,
        email: user.email,
        walletId: user.walletId,
        apiKey: user.apiKey,
        telegramId: user.telegramId,
        balance: user.balance || 0,
        isAdmin: user.isAdmin || false,
        pin_set: user.pin_set || false,
        isNewUser: user.isNewUser || false,
        createdAt: user.createdAt
    };
}

// =========================================================
// LOGIN WITH PASSWORD (STEP 1)
// =========================================================
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { mobile, password } = req.body;

        if (!mobile || !password) {
            return res.status(200).json({ success: false, message: 'Mobile & Password Required' });
        }

        const user = await User.findOne({ mobile });
        if (!user) {
            return res.status(200).json({ success: false, message: 'User Not Found. Please Check Your Mobile Number.' });
        }

        const isValid = await user.comparePassword(password);
        if (!isValid) {
            return res.status(200).json({ success: false, message: 'Invalid Password. Please Try Again.' });
        }

        if (user.isDeleted) {
            return res.status(200).json({
                success: false,
                message: 'This account has been deleted. Please contact support.'
            });
        }

        if (user.isBlocked) {
            return res.status(200).json({ success: false, message: 'Your Account Has Been Blocked. Please Contact Support.' });
        }

        res.status(200).json({
            success: true,
            user: buildUserResponse(user)
        });
    } catch (error) {
        console.error('❌ Login Error:', error);
        res.status(200).json({ success: false, message: 'Login Failed. Please Check Your Connection And Try Again.' });
    }
});

// =========================================================
// SEND LOGIN OTP (accept mobile OR userId)
// =========================================================
router.post('/send-login-otp', otpLimiter, async (req, res) => {
    try {
        const { mobile, userId, email } = req.body;

        console.log('📧 Login OTP Request:', { mobile, userId, email });

        let user;
        if (mobile) {
            user = await User.findOne({ mobile });
        } else if (userId) {
            user = await User.findById(userId);
        } else {
            return res.status(200).json({ success: false, message: 'Mobile number or User ID is required' });
        }

        if (!user) {
            return res.status(200).json({ success: false, message: 'User not found' });
        }

        if (user.isDeleted) {
            return res.status(200).json({
                success: false,
                message: 'This account has been deleted. Please contact support.'
            });
        }

        if (user.isBlocked) {
            return res.status(200).json({
                success: false,
                message: 'Your account has been blocked. Please contact support.'
            });
        }

        if (!user.email) {
            return res.status(200).json({ success: false, message: 'No email address linked to your account. Please contact support.' });
        }

        const otp = generateOTP();
        const targetEmail = email || user.email;

        await saveOtp(user._id.toString(), 'login', otp);

        console.log(`📧 Login OTP For ${targetEmail}: ${otp}`);

        const result = await sendOtpViaEmail(targetEmail, otp, user.fullName, 'Login');
        if (!result.success) {
            console.error('❌ Failed To Send OTP Via Email:', result.error);
            await deleteOtp(user._id.toString(), 'login');
            return res.status(200).json({ success: false, message: 'Failed to send OTP. Please check your email and try again.' });
        }

        console.log('✅ Login OTP Sent Successfully To:', targetEmail);

        res.status(200).json({
            success: true,
            email: maskEmail(targetEmail),
            message: 'OTP sent successfully to your email'
        });
    } catch (error) {
        console.error('❌ Send Login OTP Error:', error);
        res.status(200).json({ success: false, message: 'Failed to send OTP. Please try again.' });
    }
});

// =========================================================
// LOGIN WITH OTP
// =========================================================
router.post('/login-with-otp', loginLimiter, async (req, res) => {
    try {
        const { mobile, otp } = req.body;
        const clientIp = getClientIp(req);
        const dateTime = getCurrentDateTime();

        console.log('🔍 Login With OTP Request:', { mobile, otp });

        if (!mobile || !otp) {
            return res.status(200).json({ success: false, message: 'Mobile number and OTP are required' });
        }

        const user = await User.findOne({ mobile });
        if (!user) {
            return res.status(200).json({ success: false, message: 'User not found' });
        }

        if (user.isDeleted) {
            return res.status(200).json({
                success: false,
                message: 'This account has been deleted. Please contact support.'
            });
        }

        // ✅ FIX: block check BEFORE OTP verify (security)
        if (user.isBlocked) {
            return res.status(200).json({ success: false, message: 'Your account has been blocked. Please contact support.' });
        }

        const storedData = await getOtp(user._id.toString(), 'login');
        if (!storedData) {
            return res.status(200).json({ success: false, message: 'No OTP found. Please request a new OTP.' });
        }

        if (storedData.otp !== otp) {
            return res.status(200).json({ success: false, message: 'Invalid OTP. Please enter the correct 6-digit code.' });
        }

        // Consume OTP
        await deleteOtp(user._id.toString(), 'login');

        const token = jwt.sign(
            { userId: user._id, isAdmin: user.isAdmin },
            JWT_SECRET,
            { expiresIn: '90d' }
        );

        if (user.telegramId && BOT_TOKEN) {
            const loginMessage =
`<b>─────────────────</b>
<b>🚨 New Login Detected!</b>
<b>─────────────────</b>

<b>👤 Dear ${user.fullName},</b> A new login was detected on your account.

<b>📱 Mobile:</b> ${user.mobile}
<b>📧 Email:</b> ${user.email || 'Not provided'}
<b>🔰 Purpose:</b> OTP Login
<b>🌐 IP:</b> ${clientIp}
<b>⏰ Time:</b> ${dateTime}

───────────────────────
⚠️ If this wasn't you, change your password immediately or contact support team!
───────────────────────`;
            sendTelegramMessage(user.telegramId, loginMessage).catch(err => console.error('❌ Failed to send login alert:', err));
        }

        res.status(200).json({
            success: true,
            token,
            user: buildUserResponse(user)
        });
    } catch (error) {
        console.error('❌ Login With OTP Error:', error);
        res.status(200).json({ success: false, message: 'OTP verification failed. Please try again.' });
    }
});

// =========================================================
// VERIFY LOGIN OTP (Legacy)
// =========================================================
router.post('/verify-login-otp', loginLimiter, async (req, res) => {
    try {
        const { userId, otp, mobile } = req.body;
        const clientIp = getClientIp(req);
        const dateTime = getCurrentDateTime();

        let user;
        if (mobile) user = await User.findOne({ mobile });
        else if (userId) user = await User.findById(userId);
        else return res.status(200).json({ success: false, message: 'User ID or Mobile is required' });

        if (!user) return res.status(200).json({ success: false, message: 'User not found' });

        if (user.isDeleted) {
            return res.status(200).json({
                success: false,
                message: 'This account has been deleted. Please contact support.'
            });
        }

        if (user.isBlocked) {
            return res.status(200).json({ success: false, message: 'Account blocked. Please contact support.' });
        }

        const storedData = await getOtp(user._id.toString(), 'login');
        if (!storedData) return res.status(200).json({ success: false, message: 'No OTP found. Please request a new OTP.' });
        if (storedData.otp !== otp) return res.status(200).json({ success: false, message: 'Invalid OTP.' });

        await deleteOtp(user._id.toString(), 'login');

        const token = jwt.sign({ userId: user._id, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '90d' });

        if (user.telegramId && BOT_TOKEN) {
            const loginMessage =
`<b>🚨 New Login Detected!</b>

<b>👤 ${user.fullName}</b>
<b>📱 ${user.mobile}</b>
<b>🌐 IP:</b> ${clientIp}
<b>⏰ ${dateTime}</b>

⚠️ If this wasn't you, contact support!`;
            sendTelegramMessage(user.telegramId, loginMessage).catch(() => {});
        }

        res.status(200).json({
            success: true,
            token,
            user: buildUserResponse(user)
        });
    } catch (error) {
        console.error('❌ Verify Login OTP Error:', error);
        res.status(200).json({ success: false, message: 'OTP verification failed. Please try again.' });
    }
});

// =========================================================
// SEND REGISTRATION EMAIL OTP
// =========================================================
router.post('/send-registration-otp', otpLimiter, async (req, res) => {
    try {
        const { email, name } = req.body;

        console.log('📧 Registration Email OTP Request:', { email, name });

        if (!email) {
            return res.status(200).json({ success: false, message: 'Email is required' });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(200).json({ success: false, message: 'Please enter a valid email address.' });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // ✅ Duplicate check (deleted-aware)
        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            if (existingUser.isDeleted) {
                return res.status(200).json({
                    success: false,
                    message: 'This email belongs to a deleted account. Please contact support.'
                });
            }
            return res.status(200).json({ success: false, message: 'This email is already registered. Please login.' });
        }

        const otp = generateOTP();
        await saveOtp(normalizedEmail, 'register_email', otp);

        console.log(`📧 Registration Email OTP For ${normalizedEmail}: ${otp}`);

        const result = await sendOtpViaEmail(normalizedEmail, otp, name, 'Registration');
        if (!result.success) {
            console.error('❌ Failed To Send Registration Email OTP:', result.error);
            await deleteOtp(normalizedEmail, 'register_email');
            return res.status(200).json({ success: false, message: 'Failed to send OTP. Please check your email and try again.' });
        }

        console.log('✅ Registration Email OTP Sent Successfully To:', normalizedEmail);

        res.status(200).json({
            success: true,
            email: maskEmail(normalizedEmail),
            message: 'OTP sent successfully to your email'
        });
    } catch (error) {
        console.error('❌ Send Registration Email OTP Error:', error);
        res.status(200).json({ success: false, message: 'Failed to send OTP. Please try again.' });
    }
});

// =========================================================
// SEND TELEGRAM OTP
// =========================================================
router.post('/send-telegram-otp', otpLimiter, async (req, res) => {
    try {
        const { telegramId, tg_id, name } = req.body;
        const dateTime = getCurrentDateTime();
        const tgId = telegramId || tg_id;

        console.log('📝 Telegram OTP Request:', { telegramId: tgId, name });

        if (!tgId) {
            return res.status(200).json({ success: false, message: 'Telegram ID is required. Please enter your Telegram ID.' });
        }

        if (!/^\d{6,15}$/.test(tgId.toString())) {
            return res.status(200).json({ success: false, message: 'Please enter a valid Telegram numeric ID (6-15 digits).' });
        }

        // ✅ Duplicate check (deleted-aware)
        const existingUser = await User.findOne({ telegramId: tgId });
        if (existingUser) {
            if (existingUser.isDeleted) {
                return res.status(200).json({
                    success: false,
                    message: 'This Telegram ID belongs to a deleted account. Please contact support.'
                });
            }
            return res.status(200).json({ success: false, message: 'This Telegram ID is already registered. Please use a different ID or login.' });
        }

        if (!BOT_TOKEN) {
            return res.status(200).json({ success: false, message: 'OTP service is not configured. Please contact support.' });
        }

        const otp = generateOTP();
        await saveOtp(tgId.toString(), 'register_telegram', otp);

        console.log(`📱 Telegram OTP For ${tgId}: ${otp}`);

        const otpMessage =
`<b>─────────────</b>
<b>🔐 OTP Section</b>
<b>─────────────</b>

<b>👤 Dear ${name || 'User'},</b> Your one time password has been generated.

<b>📲 Your OTP:</b> <code>${otp}</code>
<b>⏳ Validity:</b> 5 Minutes
<b>🎯 Purpose:</b> Registration
<b>⏰ Time:</b> ${dateTime}

───────────────────────
🔒 Do not share this OTP with anyone.
───────────────────────`;

        const result = await sendTelegramMessage(tgId, otpMessage);

        if (!result.success) {
            console.error('❌ Failed to send OTP via Telegram:', result.error);
            await deleteOtp(tgId.toString(), 'register_telegram');

            if (result.error === 'Telegram API Time Out' || result.error.includes('ECONN')) {
                return res.status(200).json({ success: false, message: 'Telegram service is unavailable. Please try again in a few moments.' });
            }
            return res.status(200).json({ success: false, message: 'Failed to send OTP. Please make sure you have started the bot and try again.' });
        }

        console.log('✅ Telegram OTP Sent Successfully To:', tgId);

        res.status(200).json({ success: true, message: 'OTP sent successfully to your Telegram' });
    } catch (error) {
        console.error('❌ Send Telegram OTP Error:', error);
        res.status(200).json({ success: false, message: 'Failed to send OTP. Please check your connection and try again.' });
    }
});

// =========================================================
// VERIFY TELEGRAM OTP
// (OTP কনজিউম করা হয় না — /register এ consume হয়)
// =========================================================
router.post('/verify-telegram-otp', async (req, res) => {
    try {
        const { telegramId, otp } = req.body;

        console.log('🔍 Verify Telegram OTP Request:', { telegramId, otp });

        if (!telegramId || !otp) {
            return res.status(200).json({ success: false, message: 'Telegram ID and OTP are required' });
        }

        const storedData = await getOtp(telegramId.toString(), 'register_telegram');

        if (!storedData) {
            return res.status(200).json({ success: false, message: 'No OTP found. Please request a new OTP.' });
        }

        if (storedData.otp !== otp) {
            return res.status(200).json({ success: false, message: 'Invalid OTP. Please enter the correct 6-digit code.' });
        }

        console.log('✅ Telegram OTP Verified For:', telegramId);

        // ⚠️ OTP কনজিউম করা হয় না — /register এ delete হয়
        res.status(200).json({ success: true, message: 'Telegram OTP verified successfully' });
    } catch (error) {
        console.error('❌ Verify Telegram OTP Error:', error);
        res.status(200).json({ success: false, message: 'Telegram OTP verification failed. Please try again.' });
    }
});

// =========================================================
// LEGACY: SEND REGISTRATION OTP (Old flow)
// =========================================================
router.post('/send-reg-otp-legacy', otpLimiter, async (req, res) => {
    try {
        const { tg_id, name } = req.body;
        const dateTime = getCurrentDateTime();

        if (!tg_id) return res.status(200).json({ success: false, message: 'Telegram ID is required.' });

        const existingUser = await User.findOne({ telegramId: tg_id });
        if (existingUser) {
            if (existingUser.isDeleted) {
                return res.status(200).json({
                    success: false,
                    message: 'This Telegram ID belongs to a deleted account. Please contact support.'
                });
            }
            return res.status(200).json({ success: false, message: 'This Telegram ID is already registered.' });
        }

        if (!BOT_TOKEN) return res.status(200).json({ success: false, message: 'OTP service is not configured.' });

        const otp = generateOTP();
        await saveOtp(tg_id.toString(), 'register_telegram', otp);

        const otpMessage =
`<b>─────────────</b>
<b>🔐 OTP Section</b>
<b>─────────────</b>

<b>👤 Dear ${name || 'User'},</b> Your one time password has been generated.

<b>📲 Your OTP:</b> <code>${otp}</code>
<b>⏳ Validity:</b> 5 Minutes
<b>🎯 Purpose:</b> Registration
<b>⏰ Time:</b> ${dateTime}

───────────────────────
🔒 Do not share this OTP with anyone.
───────────────────────`;

        const result = await sendTelegramMessage(tg_id, otpMessage);
        if (!result.success) {
            await deleteOtp(tg_id.toString(), 'register_telegram');
            return res.status(200).json({ success: false, message: 'Failed to send OTP. Please start the bot first.' });
        }

        res.status(200).json({ success: true, message: 'OTP sent successfully to your Telegram' });
    } catch (error) {
        console.error('❌ Send Registration OTP Error:', error);
        res.status(200).json({ success: false, message: 'Failed to send OTP.' });
    }
});

// =========================================================
// REGISTER NEW USER
// =========================================================
router.post('/register', async (req, res) => {
    try {
        const { name, mobile, email, password, telegramId, tg_id, otp } = req.body;
        const dateTime = getCurrentDateTime();
        const tgId = telegramId || tg_id;

        console.log('📝 Registration Request:', { name, mobile, email, telegramId: tgId, otp: otp ? 'Provided' : 'Missing' });

        // ---- Required field check ----
        if (!name || !mobile || !email || !password || !tgId || !otp) {
            const missing = [];
            if (!name) missing.push('Name');
            if (!mobile) missing.push('Mobile');
            if (!email) missing.push('Email');
            if (!password) missing.push('Password');
            if (!tgId) missing.push('Telegram ID');
            if (!otp) missing.push('Email OTP');
            return res.status(200).json({ success: false, message: `Missing Fields: ${missing.join(', ')}` });
        }

        // ✅ FIX: mobile regex সঠিক (character class-এ | নয়)
        if (!/^[987][0-9]{9}$/.test(mobile)) {
            return res.status(200).json({ success: false, message: 'Invalid mobile number. Mobile must start with 9, 8, or 7.' });
        }

        // ✅ FIX: Email OTP-এর জন্য regex
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(200).json({ success: false, message: 'Please enter a valid email address.' });
        }

        // ✅ FIX: Password length 8-15 (frontend-এর সাথে consistent)
        if (password.length < 8 || password.length > 15) {
            return res.status(200).json({ success: false, message: 'Password must be 8-15 characters long.' });
        }

        if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
            return res.status(200).json({ success: false, message: 'Password must contain uppercase, lowercase, and number.' });
        }

        // ---- Verify EMAIL OTP ----
        const normalizedEmail = email.toLowerCase().trim();
        const emailStoredData = await getOtp(normalizedEmail, 'register_email');
        console.log('📦 Email OTP Data:', emailStoredData ? 'Found' : 'Not Found');

        if (!emailStoredData) {
            return res.status(200).json({ success: false, message: 'Please request an email OTP first by clicking "Send OTP".' });
        }

        if (emailStoredData.otp !== otp) {
            return res.status(200).json({ success: false, message: 'Invalid Email OTP. Please enter the correct 6-digit code.' });
        }

        // ---- Verify Telegram OTP (should already be verified in step 2 but check) ----
        const tgStoredData = await getOtp(tgId.toString(), 'register_telegram');
        if (!tgStoredData) {
            console.log('⚠️ Telegram OTP missing - assuming already verified or expired');
        }

        // ---- Duplicate check ----
        const existingUser = await User.findOne({ $or: [{ mobile }, { telegramId: tgId }, { email: normalizedEmail }] });
        if (existingUser) {
            if (existingUser.isDeleted) {
                let fieldMsg = 'this information';
                if (existingUser.mobile === mobile) fieldMsg = 'This mobile number';
                else if (existingUser.telegramId === tgId) fieldMsg = 'This Telegram ID';
                else if (existingUser.email === normalizedEmail) fieldMsg = 'This email';
                return res.status(200).json({
                    success: false,
                    message: `${fieldMsg} belongs to a deleted account. Please contact support.`
                });
            }

            let errorMsg = 'User already exists';
            if (existingUser.mobile === mobile && existingUser.telegramId === tgId) {
                errorMsg = 'User already exists with this mobile and Telegram ID. Please login.';
            } else if (existingUser.mobile === mobile) {
                errorMsg = 'This mobile number is already registered. Please login.';
            } else if (existingUser.telegramId === tgId) {
                errorMsg = 'This Telegram ID is already registered. Please login.';
            } else if (existingUser.email === normalizedEmail) {
                errorMsg = 'This email is already registered. Please login.';
            }
            return res.status(200).json({ success: false, message: errorMsg });
        }

        // ---- Generate unique walletId & apiKey ----
        let walletId = generateWalletId();
        while (await User.findOne({ walletId })) walletId = generateWalletId();

        let apiKey = generateApiKey();
        while (await User.findOne({ apiKey })) apiKey = generateApiKey();

        // ---- Create user ----
        const user = await User.create({
            fullName: name,
            mobile: mobile,
            email: normalizedEmail,
            password: password,
            telegramId: tgId,
            walletId: walletId,
            apiKey: apiKey,
            balance: 0,
            pin: null,
            pin_set: false,
            isNewUser: true,
            isAdmin: false,
            isBlocked: false,
            isDeleted: false
        });

        // ---- Clean up OTPs ----
        await deleteOtp(normalizedEmail, 'register_email');
        await deleteOtp(tgId.toString(), 'register_telegram');

        console.log('✅ User Created Successfully:', user._id);

        const token = jwt.sign({ userId: user._id, isAdmin: false }, JWT_SECRET, { expiresIn: '90d' });

        if (user.telegramId && BOT_TOKEN) {
            const welcomeMessage =
`<b>─────────────────</b>
<b>🎉 Welcome to Universal Wallet!</b>
<b>─────────────────</b>

<b>👤 Dear ${user.fullName},</b> Your account has been created successfully!

<b>📱 Mobile:</b> ${user.mobile}
<b>📧 Email:</b> ${user.email || 'Not provided'}
<b>🔑 Wallet ID:</b> ${user.walletId}
<b>⏰ Created:</b> ${dateTime}

───────────────────────
🔒 Please set your PIN to secure your account.
───────────────────────`;
            sendTelegramMessage(user.telegramId, welcomeMessage).catch(() => {});
        }

        res.status(200).json({
            success: true,
            token,
            user: buildUserResponse(user),
            message: 'Account created! Please set your PIN to continue.'
        });
    } catch (error) {
        console.error('❌ Registration Error:', error);

        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            let message = 'User already exists';
            if (field === 'mobile') message = 'This mobile number is already registered.';
            else if (field === 'telegramId') message = 'This Telegram ID is already registered.';
            else if (field === 'email') message = 'This email is already registered.';
            else if (field === 'walletId') message = 'Wallet ID generation conflict. Please try again.';
            return res.status(200).json({ success: false, message });
        }

        res.status(200).json({ success: false, message: 'Registration failed. Please check your details and try again.' });
    }
});

// =========================================================
// FORGOT PASSWORD - Send OTP
// =========================================================
router.post('/send-forgot-password-otp', otpLimiter, async (req, res) => {
    try {
        const { mobile, telegramId } = req.body;
        const dateTime = getCurrentDateTime();
        let user = null;
        let identifier = null;

        console.log('📱 Forgot Password Request:', { mobile, telegramId });

        if (mobile) {
            if (!/^\d{10}$/.test(mobile)) {
                return res.status(200).json({ success: false, message: 'Please enter a valid 10-digit mobile number.' });
            }
            user = await User.findOne({ mobile });
            identifier = mobile;
        } else if (telegramId) {
            if (!/^\d+$/.test(telegramId)) {
                return res.status(200).json({ success: false, message: 'Please enter a valid Telegram ID (numeric).' });
            }
            user = await User.findOne({ telegramId });
            identifier = telegramId;
        } else {
            return res.status(200).json({ success: false, message: 'Mobile or Telegram ID is required.' });
        }

        if (!user) {
            return res.status(200).json({ success: false, message: 'No account found with this ' + (mobile ? 'mobile number' : 'Telegram ID') + '.' });
        }

        if (user.isDeleted) {
            return res.status(200).json({
                success: false,
                message: 'This account has been deleted. Please contact support.'
            });
        }

        if (user.isBlocked) {
            return res.status(200).json({
                success: false,
                message: 'Your account has been blocked. Please contact support.'
            });
        }

        if (!user.telegramId) {
            return res.status(200).json({ success: false, message: 'Telegram ID not linked to your account. Please contact support.' });
        }

        if (!BOT_TOKEN) {
            return res.status(200).json({ success: false, message: 'OTP service is not configured. Please contact support.' });
        }

        const otp = generateOTP();
        await saveOtp(identifier, 'reset', otp);

        console.log(`📱 Forget Password OTP For ${identifier}: ${otp}`);

        const otpMessage =
`<b>─────────────</b>
<b>🔐 OTP Section</b>
<b>─────────────</b>

<b>👤 Dear ${user.fullName},</b> Your one time password has been generated.

<b>📲 Your OTP:</b> <code>${otp}</code>
<b>⏳ Validity:</b> 5 Minutes
<b>🎯 Purpose:</b> Password Reset
<b>⏰ Time:</b> ${dateTime}

───────────────────────
🔒 Do not share this OTP with anyone.
⚠️ If this wasn't you, try to contact with support team!
───────────────────────`;

        const result = await sendTelegramMessage(user.telegramId, otpMessage);

        if (!result.success) {
            console.error('❌ Failed to send OTP via Telegram:', result.error);
            await deleteOtp(identifier, 'reset');

            if (result.error === 'Telegram API Time Out' || result.error.includes('ECONN')) {
                return res.status(200).json({ success: false, message: 'Telegram service is unavailable. Please try again in a few moments.' });
            }
            return res.status(200).json({ success: false, message: 'Failed to send OTP. Please make sure you have started the bot and try again.' });
        }

        console.log('✅ OTP Sent Successfully To:', user.telegramId);
        res.status(200).json({ success: true, message: 'OTP sent successfully to your Telegram' });
    } catch (error) {
        console.error('❌ Send Forgot Password OTP Error:', error);
        res.status(200).json({ success: false, message: 'Failed to send OTP. Please check your connection and try again.' });
    }
});

// =========================================================
// FORGOT PASSWORD - Reset Password
// =========================================================
router.post('/reset-password', async (req, res) => {
    try {
        const { mobile, telegramId, otp, password } = req.body;
        const dateTime = getCurrentDateTime();
        let identifier = null;
        let user = null;

        console.log('🔑 Reset Password Request:', { mobile, telegramId, otp });

        if (!otp || !password) {
            return res.status(200).json({ success: false, message: 'OTP and password are required.' });
        }

        if (password.length < 4) {
            return res.status(200).json({ success: false, message: 'Password must be at least 4 characters long.' });
        }

        if (mobile) {
            user = await User.findOne({ mobile });
            identifier = mobile;
        } else if (telegramId) {
            user = await User.findOne({ telegramId });
            identifier = telegramId;
        } else {
            return res.status(200).json({ success: false, message: 'Mobile or Telegram ID is required.' });
        }

        if (!user) {
            return res.status(200).json({ success: false, message: 'User not found. Please check your details.' });
        }

        if (user.isDeleted) {
            return res.status(200).json({
                success: false,
                message: 'This account has been deleted. Please contact support.'
            });
        }

        const storedData = await getOtp(identifier, 'reset');
        if (!storedData) {
            return res.status(200).json({ success: false, message: 'No OTP found. Please request a new OTP.' });
        }

        if (storedData.otp !== otp) {
            return res.status(200).json({ success: false, message: 'Invalid OTP. Please enter the correct 6-digit code.' });
        }

        await deleteOtp(identifier, 'reset');

        user.password = password;
        await user.save();

        if (user.telegramId && BOT_TOKEN) {
            const confirmMessage =
`<b>─────────────────</b>
<b>✅ Password Reset</b>
<b>─────────────────</b>

<b>👤 Dear ${user.fullName},</b> Your password has just been changed.

<b>⏰ Time:</b> ${dateTime}

───────────────────────
🔒 Please keep it safe.
⚠️ If this wasn't you, change your password immediately or contact support team!
───────────────────────`;
            sendTelegramMessage(user.telegramId, confirmMessage).catch(() => {});
        }

        res.status(200).json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        console.error('❌ Reset Password Error:', error);
        res.status(200).json({ success: false, message: 'Failed to reset password. Please check your connection and try again.' });
    }
});

// =========================================================
// GET CURRENT USER (Protected)
// =========================================================
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
        console.error('Unknown Error:', error);
        res.status(200).json({ success: false, message: 'Failed to fetch user data. Please try again.' });
    }
});

// =========================================================
// GET USER BY API KEY
// =========================================================
router.get('/user-by-apikey/:apiKey', async (req, res) => {
    try {
        const { apiKey } = req.params;
        if (!apiKey) return res.status(200).json({ success: false, message: 'API Key is required' });

        const user = await User.findOne({ apiKey: apiKey });
        if (!user) return res.status(200).json({ success: false, message: 'User not found with this API Key' });

        if (user.isDeleted) {
            return res.status(200).json({ success: false, message: 'This account has been deleted.' });
        }

        return res.status(200).json({
            success: true,
            mobile: user.mobile,
            fullName: user.fullName,
            walletId: user.walletId,
            balance: user.balance
        });
    } catch (error) {
        console.error('❌ Get User By API Key Error:', error);
        return res.status(200).json({ success: false, message: 'Server error. Please try again.' });
    }
});

// =========================================================
// GET USER BY TELEGRAM ID
// =========================================================
router.get('/user-by-telegram/:tgid', async (req, res) => {
    try {
        const { tgid } = req.params;
        if (!tgid) return res.status(200).json({ success: false, message: 'Telegram ID is required' });

        const user = await User.findOne({ telegramId: tgid });
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });

        if (user.isDeleted) {
            return res.status(200).json({ success: false, message: 'This account has been deleted.' });
        }

        return res.status(200).json({
            success: true,
            mobile: user.mobile,
            fullName: user.fullName,
            walletId: user.walletId,
            balance: user.balance
        });
    } catch (error) {
        console.error('❌ Get User By Telegram Error:', error);
        return res.status(200).json({ success: false, message: 'Server error. Please try again.' });
    }
});

// =========================================================
// VERIFY TOKEN
// =========================================================
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
        console.error('❌ Verify Error:', error);
        res.status(200).json({ success: false, message: 'Server error. Please try again.' });
    }
});

// =========================================================
// TELEGRAM AUTO LOGIN
// =========================================================
router.post('/telegram-login', async (req, res) => {
    try {
        const { telegramId } = req.body;

        if (!telegramId) return res.status(200).json({ success: false, message: 'Telegram ID is required' });

        const user = await User.findOne({ telegramId: telegramId });
        if (!user) return res.status(200).json({ success: false, message: 'No account found with this Telegram ID' });

        if (user.isDeleted) {
            return res.status(200).json({
                success: false,
                message: 'This account has been deleted. Please contact support.'
            });
        }

        if (user.isBlocked) return res.status(200).json({ success: false, message: 'Your account has been blocked' });

        const token = jwt.sign({ userId: user._id, isAdmin: user.isAdmin }, JWT_SECRET, { expiresIn: '90d' });

        res.status(200).json({
            success: true,
            token,
            user: buildUserResponse(user)
        });
    } catch (error) {
        console.error('❌ Telegram Auto Login Error:', error);
        res.status(200).json({ success: false, message: 'Auto login failed. Please try again.' });
    }
});

// =========================================================
// GET USER BY MOBILE
// =========================================================
router.get('/user-by-mobile/:mobile', async (req, res) => {
    try {
        const { mobile } = req.params;
        if (!mobile) return res.status(200).json({ success: false, message: 'Mobile number is required' });

        const user = await User.findOne({ mobile: mobile });
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });

        if (user.isDeleted) {
            return res.status(200).json({ success: false, message: 'This account has been deleted.' });
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
        return res.status(200).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
