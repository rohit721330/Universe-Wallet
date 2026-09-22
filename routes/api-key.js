// FILE: routes/api-key.js
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const crypto = require('crypto');

// CONSTANTS
const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG = process.env.ADMIN_TG_ID;

// ==================== GENERATE RANDOM API KEY ====================
function generateRandomApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    while (key.length < 10) {
        const byte = crypto.randomBytes(1)[0];
        if (byte < 252) key += chars[byte % chars.length];
    }
    return key;
}

// ==================== GENERATE UNIQUE API KEY (DB-checked) ====================
async function generateUniqueApiKey(maxAttempts = 15) {
    for (let i = 0; i < maxAttempts; i++) {
        const candidate = generateRandomApiKey();
        const exists = await User.findOne({ apiKey: candidate }).select('_id').lean();
        if (!exists) return candidate;
    }
    throw new Error('Unable to generate unique API key after multiple attempts');
}

// ==================== Send Telegram Message ====================
async function sendTelegramMessage(chatId, message) {
    return new Promise((resolve) => {
        if (!BOT_TOKEN || !chatId) return resolve({ success: false });

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

        request.on('error', (error) => resolve({ success: false, error: error.message }));
        request.write(data);
        request.end();
    });
}

async function notifyAdmin(message) {
    try {
        await sendTelegramMessage(ADMIN_TG, message);
    } catch (error) {
        console.error('Failed to send admin notification:', error);
    }
}

// ==================== Get Current DateTime (IST) ====================
function getCurrentDateTime() {
    const now = new Date();
    return now.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

// ==================== Escape HTML ====================
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ==================== VERIFY TOKEN MIDDLEWARE ====================
async function verifyToken(req, res, next) {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ success: false, message: 'No Token Provided' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);

        if (!user) {
            return res.status(401).json({ success: false, message: 'User Not Found' });
        }

        if (user.isDeleted === true) {
            return res.status(401).json({ success: false, message: 'Account Deleted' });
        }

        if (user.isBlocked === true) {
            return res.status(403).json({ success: false, message: 'Account Blocked' });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('Token verification error:', error);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ success: false, message: 'Invalid Token. Please Login Again.' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Token Expired. Please Login Again.' });
        }
        return res.status(500).json({ success: false, message: 'Authentication Error' });
    }
}

// ============================================
// GET API KEY
// ============================================
router.get('/', verifyToken, async (req, res) => {
    try {
        // ✅ Fresh fetch
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // যদি API key না থাকে, নতুন generate করুন
        if (!user.apiKey) {
            const newKey = await generateUniqueApiKey();
            user.apiKey = newKey;
            user.apiKeyActive = true;
            user.apiKeyCreatedAt = new Date();
            user.apiKeyUpdatedAt = new Date();
            await user.save();

            return res.json({
                success: true,
                apiKey: user.apiKey,
                apiKeyActive: true,
                message: 'API Key Generated Successfully'
            });
        }

        res.json({
            success: true,
            apiKey: user.apiKey,
            apiKeyActive: user.apiKeyActive !== false,   // ✅ consistent logic
            apiKeyCreatedAt: user.apiKeyCreatedAt || null,
            apiKeyUpdatedAt: user.apiKeyUpdatedAt || null
        });
    } catch (error) {
        console.error('Get API key error:', error);
        res.status(500).json({ success: false, message: 'Failed To Fetch API Key: ' + error.message });
    }
});

// ============================================
// REGENERATE API KEY
// ============================================
router.post('/regenerate', verifyToken, async (req, res) => {
    try {
        // ✅ Fresh fetch
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const dateTime = getCurrentDateTime();
        const newKey = await generateUniqueApiKey();
        const oldKey = user.apiKey;

        user.apiKey = newKey;
        user.apiKeyActive = true;
        user.apiKeyCreatedAt = new Date();
        user.apiKeyUpdatedAt = new Date();
        await user.save();

        // ✅ Verify save
        const verified = await User.findById(user._id).select('apiKey apiKeyActive');
        console.log('Regenerate result:', {
            userId: user._id,
            oldKey,
            newKey,
            saved: verified.apiKey,
            active: verified.apiKeyActive
        });

        // Notify user
        if (user.telegramId) {
            const message =
`🔄 <b>API Key Regenerated</b>

👤 Dear <b>${escapeHtml(user.fullName)}</b>, Your API Key Has Been Regenerated Successfully.

🔑 <b>Old Key:</b> <code>${oldKey || 'N/A'}</code>
🆕 <b>New Key:</b> <code>${newKey}</code>
💼 <b>Wallet Id:</b> ${user.walletId}
🕒 <b>Time:</b> ${dateTime}

⚠️ Keep This New Key Secret. Do Not Share It With Anyone.`;

            await sendTelegramMessage(user.telegramId, message);
        }

        // Notify admin
        const adminMessage =
`🔄 <b>API Key Regenerated</b>

👤 <b>User:</b> ${user.fullName}
📱 <b>Mobile:</b> ${user.mobile}
💼 <b>Wallet Id:</b> ${user.walletId}
🔑 <b>Old Key:</b> <code>${oldKey || 'N/A'}</code>
🆕 <b>New Key:</b> <code>${newKey}</code>
🕒 <b>Time:</b> ${dateTime}`;

        await notifyAdmin(adminMessage);

        res.json({
            success: true,
            message: 'API Key Regenerated Successfully',
            apiKey: newKey,
            apiKeyActive: true
        });
    } catch (error) {
        console.error('Regenerate API key error:', error);
        res.status(500).json({ success: false, message: 'Failed To Regenerate API Key: ' + error.message });
    }
});

// ============================================
// TOGGLE API KEY STATUS (Enable/Disable)
// ============================================
router.post('/toggle', verifyToken, async (req, res) => {
    try {
        const { active } = req.body;
        const dateTime = getCurrentDateTime();

        // ✅ Validate input
        if (typeof active !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'active must be true or false'
            });
        }

        // ✅ Fresh fetch from DB
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (!user.apiKey) {
            return res.status(400).json({
                success: false,
                message: 'No API Key found. Generate one first.'
            });
        }

        // ✅ Update
        user.apiKeyActive = active;
        user.apiKeyUpdatedAt = new Date();

        try {
            await user.save();
        } catch (saveError) {
            console.error('Save error during toggle:', saveError);
            if (saveError.code === 11000) {
                return res.status(500).json({
                    success: false,
                    message: 'Database index conflict. Please contact support.'
                });
            }
            return res.status(500).json({
                success: false,
                message: 'Failed to save API Key status: ' + saveError.message
            });
        }

        // ✅ Verify save (fresh read)
        const verified = await User.findById(user._id).select('apiKey apiKeyActive apiKeyUpdatedAt');
        console.log('Toggle result:', {
            userId: user._id,
            requested: active,
            savedValue: verified.apiKeyActive,
            updatedAt: verified.apiKeyUpdatedAt
        });

        // ⚠️ CRITICAL CHECK — save হয়েছে কি না
        if (verified.apiKeyActive !== active) {
            console.error('❌ Toggle failed to persist!', {
                expected: active,
                actual: verified.apiKeyActive
            });
            return res.status(500).json({
                success: false,
                message: 'Failed to update API Key status. Please retry.'
            });
        }

        // Notify user
        if (user.telegramId) {
            const emoji = active ? '🟢' : '🔴';
            const statusText = active ? 'Enabled' : 'Disabled';
            const message =
`${emoji} <b>API Key ${statusText}</b>

👤 Dear <b>${escapeHtml(user.fullName)}</b>, Your API Key Has Been ${statusText}.

🔑 <b>API Key:</b> <code>${user.apiKey}</code>
📊 <b>Status:</b> ${statusText}
💼 <b>Wallet Id:</b> ${user.walletId}
🕒 <b>Time:</b> ${dateTime}

${active
    ? '✅ You Can Now Use Your API Key For Payments.'
    : '⚠️ Your API Key Will Not Work Until You Enable It Again.'}`;

            await sendTelegramMessage(user.telegramId, message);
        }

        res.json({
            success: true,
            message: active ? 'API Key Enabled' : 'API Key Disabled',
            apiKey: verified.apiKey,
            apiKeyActive: verified.apiKeyActive   // ✅ DB-verified value
        });
    } catch (error) {
        console.error('Toggle API key error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to toggle API Key: ' + error.message
        });
    }
});

// ============================================
// GET API KEY STATUS
// ============================================
router.get('/status', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('apiKey apiKeyActive apiKeyCreatedAt apiKeyUpdatedAt');
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (!user.apiKey) {
            return res.json({
                success: true,
                hasApiKey: false,
                apiKeyActive: false,
                message: 'No API Key generated yet'
            });
        }

        res.json({
            success: true,
            hasApiKey: true,
            apiKey: user.apiKey,
            apiKeyActive: user.apiKeyActive !== false,   // ✅ consistent
            apiKeyCreatedAt: user.apiKeyCreatedAt || null,
            apiKeyUpdatedAt: user.apiKeyUpdatedAt || null
        });
    } catch (error) {
        console.error('Get API key status error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch API Key status' });
    }
});

// ============================================
// VALIDATE API KEY (external)
// ============================================
router.get('/validate/:apiKey', async (req, res) => {
    try {
        const { apiKey } = req.params;

        if (!apiKey || apiKey.length !== 10 || !/^[A-Z0-9]+$/.test(apiKey)) {
            return res.status(400).json({ success: false, message: 'Invalid API Key Format' });
        }

        const user = await User.findOne({ apiKey: apiKey.toUpperCase() })
            .select('fullName walletId mobile balance apiKeyActive isBlocked isDeleted');

        if (!user || user.isDeleted === true) {
            return res.status(404).json({ success: false, message: 'Invalid API Key' });
        }

        if (user.apiKeyActive === false) {
            return res.status(403).json({ success: false, message: 'API Key is disabled' });
        }

        if (user.isBlocked === true) {
            return res.status(403).json({ success: false, message: 'User account is blocked' });
        }

        res.json({
            success: true,
            user: {
                fullName: user.fullName,
                walletId: user.walletId,
                mobile: user.mobile,
                balance: user.balance
            }
        });
    } catch (error) {
        console.error('Validate API key error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

module.exports = router;
