// FILE: routes/tg.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const crypto = require('crypto');
require('dotenv').config();

// ============================================================
// TELEGRAM - UNIVERSAL WALLET BACKEND ROUTES
// ============================================================

// Telegram Bot Configuration from .env
const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TG_ID;
const JWT_SECRET = process.env.JWT_SECRET;

// ============================================================
// COLOR CONSTANTS FOR CONSOLE LOGS
// ============================================================
const COLORS = {
    GREEN: '\x1b[32m',
    RED: '\x1b[31m',
    BLUE: '\x1b[34m',
    RESET: '\x1b[0m'
};

// ============================================================
// COLORED CONSOLE LOGS
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

// In-Memory OTP Store (Use Redis In Production)
const otpStore = new Map();

// ============================================================
// HELPER: SEND MESSAGE VIA TELEGRAM
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
                        logSuccess(`Telegram Message Sent To ${chatId}`);
                    } else {
                        logError(`Telegram Error: ${result.description}`);
                    }
                    resolve({ success: result.ok, error: result.description });
                } catch (e) {
                    logError(`Parse Error: ${e.message}`);
                    resolve({ success: false, error: e.message });
                }
            });
        });
        
        request.on('error', (error) => {
            logError(`Request Error: ${error.message}`);
            resolve({ success: false, error: error.message });
        });
        
        request.write(data);
        request.end();
    });
}

// ============================================================
// HELPER: VERIFY JWT TOKEN & GET USER
// ============================================================
async function getUserFromToken(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logError('Missing Or Invalid Authorization Header');
        throw new Error('Missing Or Invalid Authorization Header');
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    
    const user = await User.findById(decoded.userId);
    if (!user) {
        logError(`User Not Found: ${decoded.userId}`);
        throw new Error('User Not Found');
    }

    logInfo(`User Authenticated: ${user.fullName || user.mobile}`);
    return user;
}

// ============================================================
// HELPER: GENERATE OTP (6-DIGIT)
// ============================================================
function generateOTP() {
    return crypto.randomInt(100000, 999999).toString();
}

// ============================================================
// HELPER: GET CURRENT TIME IN IST
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
// ROUTE: GET TELEGRAM STATUS
// ============================================================
router.get('/status', async (req, res) => {
    try {
        logInfo('Getting Telegram Status...');
        const user = await getUserFromToken(req);

        logSuccess(`Telegram Status: ${user.telegramId || 'Not Linked'}`);
        res.json({
            success: true,
            telegramId: user.telegramId || null,
            linked: !!user.telegramId,
        });
    } catch (error) {
        logError(`Status Error: ${error.message}`);
        res.status(401).json({
            success: false,
            message: error.message || 'Unauthorized Access',
        });
    }
});

// ============================================================
// ROUTE: SEND OTP TO TELEGRAM
// ============================================================
router.post('/send-otp', async (req, res) => {
    try {
        const { telegramId } = req.body;
        const dateTime = getCurrentDateTime();
        logInfo(`Sending OTP To Telegram Id: ${telegramId}`);

        if (!telegramId || !/^\d{10}$/.test(telegramId)) {
            logError(`Invalid Telegram Id Format: ${telegramId}`);
            return res.status(400).json({
                success: false,
                message: 'Invalid Telegram Id Format — Expected 10 Digits',
            });
        }

        const user = await getUserFromToken(req);

        if (user.telegramId) {
            logError(`Telegram Already Linked For User: ${user._id}`);
            return res.status(400).json({
                success: false,
                message: 'Telegram Already Linked To This Account',
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
                logInfo(`Cleaned Expired OTP For ${telegramId}`);
            }
        }, 5 * 60 * 1000);

        logSuccess(`OTP Generated For ${telegramId}: ${otp}`);

        const otpMessage = 
`OTP Section

Dear ${user.fullName}, Your One Time Password Has Been Generated.

Your OTP: ${otp}
Validity: 5 Minutes
Purpose: Telegram Linking
Date: ${dateTime}

Do Not Share This OTP With Anyone.`;

        const result = await sendTelegramMessage(telegramId, otpMessage);

        if (!result.success) {
            logError(`Failed To Send OTP Via Telegram: ${result.error}`);
            return res.status(500).json({
                success: false,
                message: 'Failed To Send OTP. Please Make Sure You Have Started The Bot And Try Again.'
            });
        }

        logSuccess(`OTP Sent Successfully To ${telegramId}`);

        res.json({
            success: true,
            message: 'OTP Sent Successfully To Your Telegram',
        });
    } catch (error) {
        logError(`Send OTP Error: ${error.message}`);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed To Send OTP — Please Try Again',
        });
    }
});

// ============================================================
// ROUTE: VERIFY OTP & LINK TELEGRAM
// ============================================================
router.post('/verify-otp', async (req, res) => {
    try {
        const { telegramId, otp } = req.body;
        const dateTime = getCurrentDateTime();
        logInfo(`Verifying OTP For Telegram Id: ${telegramId}`);

        if (!telegramId || !otp) {
            logError('Missing Telegram Id Or OTP');
            return res.status(400).json({
                success: false,
                message: 'Missing Telegram Id Or OTP',
            });
        }

        const storedData = otpStore.get(telegramId);
        if (!storedData) {
            logError(`No OTP Found For ${telegramId}`);
            return res.status(400).json({
                success: false,
                message: 'No OTP Found For This Telegram Id — Please Request A New OTP',
            });
        }

        if (Date.now() > storedData.expiresAt) {
            otpStore.delete(telegramId);
            logError(`OTP Expired For ${telegramId}`);
            return res.status(400).json({
                success: false,
                message: 'OTP Expired — Please Request A New OTP',
            });
        }

        if (storedData.otp !== otp) {
            logError(`Incorrect OTP For ${telegramId}: ${otp}`);
            return res.status(400).json({
                success: false,
                message: 'Incorrect OTP — Please Try Again',
            });
        }

        const user = await User.findById(storedData.userId);
        if (!user) {
            logError(`User Not Found: ${storedData.userId}`);
            return res.status(404).json({
                success: false,
                message: 'User Not Found — Please Login Again',
            });
        }

        const existingUser = await User.findOne({ telegramId });
        if (existingUser && existingUser._id.toString() !== user._id.toString()) {
            logError(`Telegram Id Already Linked To Another User: ${telegramId}`);
            return res.status(400).json({
                success: false,
                message: 'This Telegram Account Is Already Linked To Another User',
            });
        }

        user.telegramId = telegramId;
        await user.save();

        otpStore.delete(telegramId);

        logSuccess(`Telegram Linked Successfully For User: ${user.fullName || user._id}`);

        const confirmMessage = 
`Telegram Linked

Dear ${user.fullName}, Your Telegram Account Has Been Successfully Linked.

Telegram Id: ${telegramId}
Date: ${dateTime}

You Can Now Receive Notifications.`;

        await sendTelegramMessage(telegramId, confirmMessage);

        res.json({
            success: true,
            message: 'Telegram Linked Successfully',
            telegramId: user.telegramId,
        });
    } catch (error) {
        logError(`Verify OTP Error: ${error.message}`);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed To Verify OTP — Please Try Again',
        });
    }
});

// ============================================================
// ROUTE: UNLINK TELEGRAM (NO OTP REQUIRED)
// ============================================================
router.post('/unlink', async (req, res) => {
    try {
        logInfo('Unlinking Telegram...');
        const user = await getUserFromToken(req);

        if (!user.telegramId) {
            logError('No Telegram Account To Unlink');
            return res.status(400).json({
                success: false,
                message: 'No Telegram Account To Unlink',
            });
        }

        const telegramId = user.telegramId;
        const dateTime = getCurrentDateTime();

        user.telegramId = null;
        await user.save();

        logSuccess(`Telegram Unlinked For User: ${user.fullName || user._id}`);

        const unlinkMessage = 
`Telegram Unlinked

Dear ${user.fullName}, Your Telegram Account Has Been Disconnected From Universal Wallet.

Telegram Id: ${telegramId}
Date: ${dateTime}

You Will No Longer Receive Alerts On This Account.`;

        await sendTelegramMessage(telegramId, unlinkMessage);

        res.json({
            success: true,
            message: 'Telegram Unlinked Successfully',
        });
    } catch (error) {
        logError(`Unlink Error: ${error.message}`);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed To Unlink Telegram — Please Try Again',
        });
    }
});

// ============================================================
// ROUTE: WEBHOOK FOR TELEGRAM BOT
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

        logInfo(`Received Message From ${chatId}: ${text}`);

        if (text.startsWith('/status')) {
            const user = await User.findOne({ telegramId: chatId.toString() });
            if (user) {
                const statusMessage = 
`Linked Status

Your Telegram Is Currently Linked To Universal Wallet.

User: ${user.fullName}
Wallet Id: ${user.walletId}
Telegram Id: ${chatId}

You Will Receive Real-Time Alerts Here.`;
                
                await sendTelegramMessage(chatId, statusMessage);
                logSuccess(`Status Message Sent To ${chatId} (Linked)`);
            } else {
                const notLinkedMessage = 
`Not Linked

Your Telegram Is Not Currently Linked To Any Universal Wallet Account.

To Link, Please Try To Contact Support Team.`;
                
                await sendTelegramMessage(chatId, notLinkedMessage);
                logInfo(`Status Message Sent To ${chatId} (Not Linked)`);
            }
        }

        res.sendStatus(200);
    } catch (error) {
        logError(`Webhook Error: ${error.message}`);
        res.sendStatus(500);
    }
});

// ============================================================
// ROUTE: SET WEBHOOK
// ============================================================
router.post('/set-webhook', async (req, res) => {
    try {
        if (!BOT_TOKEN) {
            logError('BOT_TOKEN Is Not Configured');
            return res.status(500).json({
                success: false,
                message: 'BOT_TOKEN Is Not Configured',
            });
        }
        const webhookUrl = req.body.url || `${process.env.APP_URL || 'https://universal-wallet.vercel.app'}/api/tg/webhook`;
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webhookUrl}`;
        const response = await axios.get(url);
        logSuccess(`Webhook Set Successfully: ${webhookUrl}`);
        res.json({
            success: true,
            message: 'Webhook Set Successfully',
            data: response.data,
        });
    } catch (error) {
        logError(`Set Webhook Error: ${error.message}`);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed To Set Webhook — Please Try Again',
        });
    }
});

// ============================================================
// ROUTE: CLEANUP EXPIRED OTPS
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
    logInfo(`Cleaned Up ${count} Expired OTPs`);
    res.json({
        success: true,
        message: `Cleaned Up ${count} Expired OTPs`,
        count,
    });
});

module.exports = router;
