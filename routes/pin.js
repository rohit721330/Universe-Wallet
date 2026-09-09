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
                message: 'Server Configuration Error'
            });
        }

        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(200).json({
                success: false,
                message: 'Authentication Token Is Missing'
            });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        
        try {
            const user = await User.findById(decoded.userId);
            
            if (!user) {
                return res.status(200).json({
                    success: false,
                    message: 'User Not Found'
                });
            }
            
            req.user = user;
            next();
        } catch (dbError) {
            console.error('Database error in token verification:', dbError);
            return res.status(200).json({
                success: false,
                message: 'Database Error'
            });
        }
    } catch (error) {
        console.error('Token verification error:', error);
        if (error.name === 'JsonWebTokenError') {
            return res.status(200).json({
                success: false,
                message: 'Invalid Token'
            });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(200).json({
                success: false,
                message: 'Token Expired'
            });
        }
        return res.status(200).json({
            success: false,
            message: 'Authentication Error'
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
                message: 'User Not Authenticated'
            });
        }

        const dateTime = getCurrentDateTime();

        // Validate PIN
        if (!pin) {
            return res.status(200).json({
                success: false,
                message: 'PIN Is Required'
            });
        }

        if (pin.length !== 4) {
            return res.status(200).json({
                success: false,
                message: 'PIN Must Be Exactly 4 Digits'
            });
        }

        if (!/^\d{4}$/.test(pin)) {
            return res.status(200).json({
                success: false,
                message: 'PIN Must Contain Only Numeric Digits'
            });
        }

        // Check if PIN already set
        if (user.pin) {
            return res.status(200).json({
                success: false,
                message: 'PIN Is Already Set'
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
`🔐 Welcome to Universal Wallet

Dear ${user.fullName},

Your account has been created successfully!

Mobile: ${user.mobile}
Wallet ID: ${user.walletId}
Balance: ₹${user.balance || 0}
PIN: Set successfully
Time: ${dateTime}

Keep your credentials safe and secure.`;
            
            await sendTelegramMessage(user.telegramId, welcomeMessage);
        }

        // Send Admin Notification for new user only
        if (isNewUser && ADMIN_TELEGRAM_ID && BOT_TOKEN) {
            const adminMessage = 
`🆕 New User Registered

Name: ${user.fullName}
Mobile: ${user.mobile}
Wallet ID: ${user.walletId}
API Key: ${user.apiKey}
PIN: Set successfully
Time: ${dateTime}

Total Users: ${await User.countDocuments()}`;

            await sendTelegramMessage(ADMIN_TELEGRAM_ID, adminMessage);
        }

        res.status(200).json({
            success: true,
            message: isNewUser ? 'PIN Set Successfully! Welcome to Universal Wallet' : 'PIN Set Successfully',
            isNewUser: isNewUser
        });

    } catch (error) {
        console.error('Set PIN error:', error);
        res.status(200).json({
            success: false,
            message: 'Failed To Set PIN'
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
                message: 'User Not Authenticated'
            });
        }

        const dateTime = getCurrentDateTime();

        // Validate PIN
        if (!pin) {
            return res.status(200).json({
                success: false,
                message: 'PIN Is Required'
            });
        }

        if (pin.length !== 4) {
            return res.status(200).json({
                success: false,
                message: 'PIN Must Be Exactly 4 Digits'
            });
        }

        if (!/^\d{4}$/.test(pin)) {
            return res.status(200).json({
                success: false,
                message: 'PIN Must Contain Only Numeric Digits'
            });
        }

        // Check if PIN is set
        if (!user.pin) {
            return res.status(200).json({
                success: false,
                message: 'PIN Has Not Been Set Yet'
            });
        }

        // Verify PIN
        const isValid = await bcrypt.compare(pin, user.pin);
        if (!isValid) {
            return res.status(200).json({
                success: false,
                message: 'Incorrect PIN'
            });
        }

        // Send login notification via Telegram when PIN is verified
        if (user.telegramId && BOT_TOKEN) {
            const loginMessage = 
`🔐 New Login Detected

Dear ${user.fullName},

A new login was detected on your account.

Mobile: ${user.mobile}
Purpose: PIN Verification
Time: ${dateTime}

If this wasn't you, change your PIN immediately or contact support!`;
            
            // Send asynchronously - don't wait for response
            sendTelegramMessage(user.telegramId, loginMessage).catch(err => {
                console.error('❌ Failed to send PIN verification login alert:', err);
            });
        }

        res.status(200).json({
            success: true,
            message: 'PIN Verified Successfully'
        });

    } catch (error) {
        console.error('Verify PIN error:', error);
        res.status(200).json({
            success: false,
            message: 'Failed To Verify PIN'
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
                message: 'User Not Authenticated'
            });
        }

        const dateTime = getCurrentDateTime();

        // Validate current PIN
        if (!current_pin) {
            return res.status(200).json({
                success: false,
                message: 'Current PIN Is Required'
            });
        }

        // Validate new PIN
        if (!new_pin) {
            return res.status(200).json({
                success: false,
                message: 'New PIN Is Required'
            });
        }

        if (new_pin.length !== 4) {
            return res.status(200).json({
                success: false,
                message: 'New PIN Must Be Exactly 4 Digits'
            });
        }

        if (!/^\d{4}$/.test(new_pin)) {
            return res.status(200).json({
                success: false,
                message: 'New PIN Must Contain Only Numeric Digits'
            });
        }

        if (current_pin === new_pin) {
            return res.status(200).json({
                success: false,
                message: 'New PIN Cannot Be Same As Current PIN'
            });
        }

        // Check if PIN is set
        if (!user.pin) {
            return res.status(200).json({
                success: false,
                message: 'PIN Has Not Been Set Yet'
            });
        }

        // Verify current PIN
        const isValid = await bcrypt.compare(current_pin, user.pin);
        if (!isValid) {
            return res.status(200).json({
                success: false,
                message: 'Incorrect Current PIN'
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
`🔄 PIN Changed Successfully

Dear ${user.fullName},

Your PIN has been changed successfully.

PIN Status: Changed
Time: ${dateTime}

If this wasn't you, please contact support immediately.`;
            
            await sendTelegramMessage(user.telegramId, message);
        }

        res.status(200).json({
            success: true,
            message: 'PIN Changed Successfully'
        });

    } catch (error) {
        console.error('Change PIN error:', error);
        res.status(200).json({
            success: false,
            message: 'Failed To Change PIN'
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
                message: 'User Not Authenticated'
            });
        }

        // Validate current PIN
        if (!current_pin) {
            return res.status(200).json({
                success: false,
                message: 'Current PIN Is Required'
            });
        }

        if (current_pin.length !== 4) {
            return res.status(200).json({
                success: false,
                message: 'PIN Must Be Exactly 4 Digits'
            });
        }

        if (!/^\d{4}$/.test(current_pin)) {
            return res.status(200).json({
                success: false,
                message: 'PIN Must Contain Only Numeric Digits'
            });
        }

        // Check if PIN is set
        if (!user.pin) {
            return res.status(200).json({
                success: false,
                message: 'PIN Has Not Been Set Yet'
            });
        }

        // Verify PIN
        const isValid = await bcrypt.compare(current_pin, user.pin);
        if (!isValid) {
            return res.status(200).json({
                success: false,
                message: 'Incorrect PIN'
            });
        }

        res.status(200).json({
            success: true,
            message: 'PIN Verified Successfully'
        });

    } catch (error) {
        console.error('Verify old PIN error:', error);
        res.status(200).json({
            success: false,
            message: 'Failed To Verify PIN'
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
                message: 'User Not Authenticated'
            });
        }

        res.status(200).json({
            success: true,
            hasPin: !!user.pin,
            pinSet: user.pin_set || false,
            isNewUser: user.isNewUser || false,
            message: user.pin ? 'PIN Is Set' : 'PIN Is Not Set'
        });

    } catch (error) {
        console.error('Check PIN status error:', error);
        res.status(200).json({
            success: false,
            message: 'Failed To Check PIN Status'
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
                message: 'User Not Authenticated'
            });
        }

        const dateTime = getCurrentDateTime();

        // Validate Telegram ID
        if (!tg_id) {
            return res.status(200).json({
                success: false,
                message: 'Telegram ID Is Required'
            });
        }

        // Check if PIN is set
        if (!user.pin) {
            return res.status(200).json({
                success: false,
                message: 'PIN Has Not Been Set Yet'
            });
        }

        // Verify Telegram ID matches
        if (user.telegramId !== tg_id) {
            return res.status(200).json({
                success: false,
                message: 'Telegram ID Does Not Match'
            });
        }

        // Check rate limiting (2 minutes between OTP requests)
        const lastOTPTime = user.lastOTPTime || 0;
        const timeSinceLastOTP = Date.now() - lastOTPTime;
        if (timeSinceLastOTP < 120000) {
            const remainingTime = Math.ceil((120000 - timeSinceLastOTP) / 1000);
            return res.status(200).json({
                success: false,
                message: `Please wait ${remainingTime} seconds before requesting another OTP`
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
`🔐 PIN Recovery OTP

Dear ${user.fullName},

Your PIN recovery OTP has been generated.

Your OTP: ${otp}
Validity: 5 minutes
Purpose: PIN Recovery
Time: ${dateTime}

Do not share this OTP with anyone.`;

        const result = await sendTelegramMessage(user.telegramId, otpMessage);

        if (!result.success) {
            console.error('Failed to send OTP via Telegram:', result.error);
            return res.status(200).json({
                success: false,
                message: 'Failed To Send OTP'
            });
        }

        res.status(200).json({
            success: true,
            message: 'OTP Sent Successfully'
        });

    } catch (error) {
        console.error('Send forgot PIN OTP error:', error);
        res.status(200).json({
            success: false,
            message: 'Failed To Send OTP'
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
                message: 'User Not Authenticated'
            });
        }

        // Validate OTP
        if (!otp) {
            return res.status(200).json({
                success: false,
                message: 'OTP Is Required'
            });
        }

        if (otp.length !== 6) {
            return res.status(200).json({
                success: false,
                message: 'OTP Must Be Exactly 6 Digits'
            });
        }

        if (!/^\d{6}$/.test(otp)) {
            return res.status(200).json({
                success: false,
                message: 'OTP Must Contain Only Numeric Digits'
            });
        }

        // Check OTP
        const storedData = global.pinOtpStore?.get(user._id.toString());
        if (!storedData) {
            return res.status(200).json({
                success: false,
                message: 'No OTP Found. Please Request A New OTP.'
            });
        }

        if (storedData.otp !== otp) {
            return res.status(200).json({
                success: false,
                message: 'Invalid OTP. Please Try Again.'
            });
        }

        if (Date.now() > storedData.expires) {
            global.pinOtpStore.delete(user._id.toString());
            return res.status(200).json({
                success: false,
                message: 'OTP Expired. Please Request A New OTP.'
            });
        }

        // Clear OTP from store after verification
        global.pinOtpStore.delete(user._id.toString());

        console.log(`✅ OTP verified for user: ${user.mobile}`);

        res.status(200).json({
            success: true,
            message: 'OTP Verified Successfully'
        });

    } catch (error) {
        console.error('Verify forgot PIN OTP error:', error);
        res.status(200).json({
            success: false,
            message: 'Failed To Verify OTP'
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
                message: 'User Not Authenticated'
            });
        }

        const dateTime = getCurrentDateTime();

        // Validate new PIN
        if (!new_pin) {
            return res.status(200).json({
                success: false,
                message: 'New PIN Is Required'
            });
        }

        if (new_pin.length !== 4) {
            return res.status(200).json({
                success: false,
                message: 'New PIN Must Be Exactly 4 Digits'
            });
        }

        if (!/^\d{4}$/.test(new_pin)) {
            return res.status(200).json({
                success: false,
                message: 'New PIN Must Contain Only Numeric Digits'
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
`✅ PIN Reset Successfully

Dear ${user.fullName},

Your PIN has been reset successfully.

PIN Status: Reset
Time: ${dateTime}

If this wasn't you, please contact support immediately.`;
            
            await sendTelegramMessage(user.telegramId, message);
        }

        res.status(200).json({
            success: true,
            message: 'PIN Reset Successfully'
        });

    } catch (error) {
        console.error('Reset PIN error:', error);
        res.status(200).json({
            success: false,
            message: 'Failed To Reset PIN'
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
                message: 'User Not Authenticated'
            });
        }

        // Check if user is admin
        if (!user.isAdmin) {
            return res.status(200).json({
                success: false,
                message: 'Admin Access Required'
            });
        }

        user.pin = null;
        user.pin_set = false;
        await user.save();

        res.status(200).json({
            success: true,
            message: 'PIN Removed Successfully'
        });

    } catch (error) {
        console.error('Remove PIN error:', error);
        res.status(200).json({
            success: false,
            message: 'Failed To Remove PIN'
        });
    }
});

module.exports = router;
