// FILE: routes/pin.js
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
require('dotenv').config();

// ===== INITIALIZE GLOBAL STORES =====
if (!global.pinOtpStore) {
    global.pinOtpStore = new Map();
}

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TG_ID;
const JWT_SECRET = process.env.JWT_SECRET;

// ============================================
// HELPER FUNCTIONS
// ============================================

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
                    resolve({ success: result.ok, error: result.description });
                } catch (e) {
                    resolve({ success: false, error: e.message });
                }
            });
        });
        
        request.on('error', (error) => {
            resolve({ success: false, error: error.message });
        });
        
        request.write(data);
        request.end();
    });
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

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function cleanExpiredOTPs() {
    const now = Date.now();
    for (const [key, value] of global.pinOtpStore.entries()) {
        if (now > value.expires) {
            global.pinOtpStore.delete(key);
        }
    }
}
setInterval(cleanExpiredOTPs, 60000);

// ============================================
// VERIFY TOKEN MIDDLEWARE
// ============================================
const verifyToken = async (req, res, next) => {
    try {
        if (!JWT_SECRET) {
            return res.status(200).json({ success: false, message: 'Server Configuration Error' });
        }

        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(200).json({ success: false, message: 'Authentication Token Is Missing' });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (!user) {
            return res.status(200).json({ success: false, message: 'User Not Found' });
        }
        
        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(200).json({ success: false, message: 'Invalid Token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(200).json({ success: false, message: 'Token Expired' });
        }
        return res.status(200).json({ success: false, message: 'Authentication Error' });
    }
};

// ============================================
// SET PIN — Plain text
// ============================================
router.post('/set-pin', verifyToken, async (req, res) => {
    try {
        const { pin } = req.body;
        const user = req.user;

        if (!user) {
            return res.status(200).json({ success: false, message: 'User Not Authenticated' });
        }

        const dateTime = getCurrentDateTime();

        if (!pin) {
            return res.status(200).json({ success: false, message: 'PIN Is Required' });
        }
        if (pin.length !== 4) {
            return res.status(200).json({ success: false, message: 'PIN Must Be Exactly 4 Digits' });
        }
        if (!/^\d{4}$/.test(pin)) {
            return res.status(200).json({ success: false, message: 'PIN Must Contain Only Numeric Digits' });
        }
        if (user.pin) {
            return res.status(200).json({ success: false, message: 'PIN Is Already Set' });
        }

        const isNewUser = user.isNewUser || false;

        // ✅ Plain text PIN — কোনো hash নেই
        user.pin = pin;
        user.pin_set = true;
        user.isNewUser = false;
        await user.save();

        // Welcome message
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

        // Admin notification
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
        res.status(200).json({ success: false, message: 'Failed To Set PIN: ' + error.message });
    }
});

// ============================================
// VERIFY PIN — Plain text
// ============================================
router.post('/verify-pin', verifyToken, async (req, res) => {
    try {
        const { pin } = req.body;
        const user = req.user;

        if (!user) {
            return res.status(200).json({ success: false, message: 'User Not Authenticated' });
        }

        const dateTime = getCurrentDateTime();

        if (!pin) {
            return res.status(200).json({ success: false, message: 'PIN Is Required' });
        }
        if (pin.length !== 4) {
            return res.status(200).json({ success: false, message: 'PIN Must Be Exactly 4 Digits' });
        }
        if (!/^\d{4}$/.test(pin)) {
            return res.status(200).json({ success: false, message: 'PIN Must Contain Only Numeric Digits' });
        }
        if (!user.pin) {
            return res.status(200).json({ success: false, message: 'PIN Has Not Been Set Yet' });
        }

        // ✅ Plain text comparison
        if (pin !== user.pin) {
            return res.status(200).json({ success: false, message: 'Incorrect PIN' });
        }

        // Login notification
        if (user.telegramId && BOT_TOKEN) {
            const loginMessage = 
`🔐 New Login Detected

Dear ${user.fullName},

A new login was detected on your account.

Mobile: ${user.mobile}
Purpose: PIN Verification
Time: ${dateTime}

If this wasn't you, change your PIN immediately or contact support!`;
            
            sendTelegramMessage(user.telegramId, loginMessage).catch(err => {
                console.error('Failed to send PIN verification alert:', err);
            });
        }

        res.status(200).json({ success: true, message: 'PIN Verified Successfully' });

    } catch (error) {
        console.error('Verify PIN error:', error);
        res.status(200).json({ success: false, message: 'Failed To Verify PIN: ' + error.message });
    }
});

// ============================================
// CHANGE PIN — Plain text
// ============================================
router.post('/change-pin', verifyToken, async (req, res) => {
    try {
        const { current_pin, new_pin } = req.body;
        const user = req.user;

        if (!user) {
            return res.status(200).json({ success: false, message: 'User Not Authenticated' });
        }

        const dateTime = getCurrentDateTime();

        if (!current_pin) {
            return res.status(200).json({ success: false, message: 'Current PIN Is Required' });
        }
        if (!new_pin) {
            return res.status(200).json({ success: false, message: 'New PIN Is Required' });
        }
        if (new_pin.length !== 4) {
            return res.status(200).json({ success: false, message: 'New PIN Must Be Exactly 4 Digits' });
        }
        if (!/^\d{4}$/.test(new_pin)) {
            return res.status(200).json({ success: false, message: 'New PIN Must Contain Only Numeric Digits' });
        }
        if (current_pin === new_pin) {
            return res.status(200).json({ success: false, message: 'New PIN Cannot Be Same As Current PIN' });
        }
        if (!user.pin) {
            return res.status(200).json({ success: false, message: 'PIN Has Not Been Set Yet' });
        }

        // ✅ Plain text comparison
        if (current_pin !== user.pin) {
            return res.status(200).json({ success: false, message: 'Incorrect Current PIN' });
        }

        // ✅ Plain text save
        user.pin = new_pin;
        user.pin_set = true;
        await user.save();

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

        res.status(200).json({ success: true, message: 'PIN Changed Successfully' });

    } catch (error) {
        console.error('Change PIN error:', error);
        res.status(200).json({ success: false, message: 'Failed To Change PIN: ' + error.message });
    }
});

// ============================================
// VERIFY OLD PIN
// ============================================
router.post('/verify-change-pin', verifyToken, async (req, res) => {
    try {
        const { current_pin } = req.body;
        const user = req.user;

        if (!user) {
            return res.status(200).json({ success: false, message: 'User Not Authenticated' });
        }

        if (!current_pin) {
            return res.status(200).json({ success: false, message: 'Current PIN Is Required' });
        }
        if (current_pin.length !== 4) {
            return res.status(200).json({ success: false, message: 'PIN Must Be Exactly 4 Digits' });
        }
        if (!/^\d{4}$/.test(current_pin)) {
            return res.status(200).json({ success: false, message: 'PIN Must Contain Only Numeric Digits' });
        }
        if (!user.pin) {
            return res.status(200).json({ success: false, message: 'PIN Has Not Been Set Yet' });
        }

        // ✅ Plain text comparison
        if (current_pin !== user.pin) {
            return res.status(200).json({ success: false, message: 'Incorrect PIN' });
        }

        res.status(200).json({ success: true, message: 'PIN Verified Successfully' });

    } catch (error) {
        console.error('Verify old PIN error:', error);
        res.status(200).json({ success: false, message: 'Failed To Verify PIN: ' + error.message });
    }
});

// ============================================
// CHECK PIN STATUS
// ============================================
router.get('/check-pin-status', verifyToken, async (req, res) => {
    try {
        const user = req.user;

        if (!user) {
            return res.status(200).json({ success: false, message: 'User Not Authenticated' });
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
        res.status(200).json({ success: false, message: 'Failed To Check PIN Status' });
    }
});

// ============================================
// FORGOT PIN - SEND OTP
// ============================================
router.post('/forgot-pin-send-otp', verifyToken, async (req, res) => {
    try {
        const { tg_id } = req.body;
        const user = req.user;

        if (!user) {
            return res.status(200).json({ success: false, message: 'User Not Authenticated' });
        }

        const dateTime = getCurrentDateTime();

        if (!tg_id) {
            return res.status(200).json({ success: false, message: 'Telegram ID Is Required' });
        }
        if (!user.pin) {
            return res.status(200).json({ success: false, message: 'PIN Has Not Been Set Yet' });
        }
        if (user.telegramId !== tg_id) {
            return res.status(200).json({ success: false, message: 'Telegram ID Does Not Match' });
        }

        const lastOTPTime = user.lastOTPTime || 0;
        const timeSinceLastOTP = Date.now() - lastOTPTime;
        if (timeSinceLastOTP < 120000) {
            const remainingTime = Math.ceil((120000 - timeSinceLastOTP) / 1000);
            return res.status(200).json({
                success: false,
                message: `Please wait ${remainingTime} seconds before requesting another OTP`
            });
        }

        const otp = generateOTP();
        const expires = Date.now() + 5 * 60 * 1000;
        global.pinOtpStore.set(user._id.toString(), { otp, expires });

        user.lastOTPTime = Date.now();
        await user.save();

        setTimeout(() => {
            if (global.pinOtpStore?.get(user._id.toString())?.otp === otp) {
                global.pinOtpStore.delete(user._id.toString());
            }
        }, 5 * 60 * 1000);

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
            return res.status(200).json({ success: false, message: 'Failed To Send OTP' });
        }

        res.status(200).json({ success: true, message: 'OTP Sent Successfully' });

    } catch (error) {
        console.error('Send forgot PIN OTP error:', error);
        res.status(200).json({ success: false, message: 'Failed To Send OTP: ' + error.message });
    }
});

// ============================================
// FORGOT PIN - VERIFY OTP
// ============================================
router.post('/forgot-pin-verify-otp', verifyToken, async (req, res) => {
    try {
        const { otp } = req.body;
        const user = req.user;

        if (!user) {
            return res.status(200).json({ success: false, message: 'User Not Authenticated' });
        }

        if (!otp) {
            return res.status(200).json({ success: false, message: 'OTP Is Required' });
        }
        if (otp.length !== 6) {
            return res.status(200).json({ success: false, message: 'OTP Must Be Exactly 6 Digits' });
        }
        if (!/^\d{6}$/.test(otp)) {
            return res.status(200).json({ success: false, message: 'OTP Must Contain Only Numeric Digits' });
        }

        const storedData = global.pinOtpStore?.get(user._id.toString());
        if (!storedData) {
            return res.status(200).json({ success: false, message: 'No OTP Found. Please Request A New OTP.' });
        }
        if (storedData.otp !== otp) {
            return res.status(200).json({ success: false, message: 'Invalid OTP. Please Try Again.' });
        }
        if (Date.now() > storedData.expires) {
            global.pinOtpStore.delete(user._id.toString());
            return res.status(200).json({ success: false, message: 'OTP Expired. Please Request A New OTP.' });
        }

        global.pinOtpStore.delete(user._id.toString());
        res.status(200).json({ success: true, message: 'OTP Verified Successfully' });

    } catch (error) {
        console.error('Verify forgot PIN OTP error:', error);
        res.status(200).json({ success: false, message: 'Failed To Verify OTP: ' + error.message });
    }
});

// ============================================
// FORGOT PIN - RESET PIN
// ============================================
router.post('/forgot-pin-reset', verifyToken, async (req, res) => {
    try {
        const { new_pin } = req.body;
        const user = req.user;

        if (!user) {
            return res.status(200).json({ success: false, message: 'User Not Authenticated' });
        }

        const dateTime = getCurrentDateTime();

        if (!new_pin) {
            return res.status(200).json({ success: false, message: 'New PIN Is Required' });
        }
        if (new_pin.length !== 4) {
            return res.status(200).json({ success: false, message: 'New PIN Must Be Exactly 4 Digits' });
        }
        if (!/^\d{4}$/.test(new_pin)) {
            return res.status(200).json({ success: false, message: 'New PIN Must Contain Only Numeric Digits' });
        }

        // ✅ Plain text save
        user.pin = new_pin;
        user.pin_set = true;
        await user.save();

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

        res.status(200).json({ success: true, message: 'PIN Reset Successfully' });

    } catch (error) {
        console.error('Reset PIN error:', error);
        res.status(200).json({ success: false, message: 'Failed To Reset PIN: ' + error.message });
    }
});

// ============================================
// REMOVE PIN (Admin Only)
// ============================================
router.delete('/remove-pin', verifyToken, async (req, res) => {
    try {
        const user = req.user;

        if (!user) {
            return res.status(200).json({ success: false, message: 'User Not Authenticated' });
        }
        if (!user.isAdmin) {
            return res.status(200).json({ success: false, message: 'Admin Access Required' });
        }

        user.pin = null;
        user.pin_set = false;
        await user.save();

        res.status(200).json({ success: true, message: 'PIN Removed Successfully' });

    } catch (error) {
        console.error('Remove PIN error:', error);
        res.status(200).json({ success: false, message: 'Failed To Remove PIN: ' + error.message });
    }
});

module.exports = router;
