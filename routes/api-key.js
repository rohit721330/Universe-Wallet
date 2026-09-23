// FILE: routes/api-key.js
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG = process.env.ADMIN_TG_ID;

// ==================== KEY GENERATION ====================
function generateRandomApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    while (key.length < 10) {
        const byte = crypto.randomBytes(1)[0];
        if (byte < 252) key += chars[byte % chars.length];
    }
    return key;
}

async function generateUniqueApiKey(maxAttempts = 15) {
    for (let i = 0; i < maxAttempts; i++) {
        const candidate = generateRandomApiKey();
        const exists = await User.findOne({ apiKey: candidate }).select('_id').lean();
        if (!exists) return candidate;
    }
    throw new Error('Unable to generate unique API key after multiple attempts');
}

// ==================== TELEGRAM ====================
async function sendTelegramMessage(chatId, message) {
    return new Promise((resolve) => {
        if (!BOT_TOKEN || !chatId) return resolve({ success: false });
        const https = require('https');
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const data = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' });
        const request = https.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                try { resolve({ success: JSON.parse(responseData).ok }); }
                catch (e) { resolve({ success: false }); }
            });
        });
        request.on('error', () => resolve({ success: false }));
        request.write(data);
        request.end();
    });
}

async function notifyAdmin(message) {
    try { await sendTelegramMessage(ADMIN_TG, message); }
    catch (error) { console.error('Admin notify failed:', error); }
}

// ==================== HELPERS ====================
function getCurrentDateTime() {
    return new Date().toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ==================== AUTH MIDDLEWARE ====================
async function verifyToken(req, res, next) {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ success: false, message: 'No Token Provided' });

        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);

        if (!user) return res.status(401).json({ success: false, message: 'User Not Found' });
        if (user.isDeleted) return res.status(401).json({ success: false, message: 'Account Deleted' });
        if (user.isBlocked) return res.status(403).json({ success: false, message: 'Account Blocked' });

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') return res.status(401).json({ success: false, message: 'Invalid Token' });
        if (error.name === 'TokenExpiredError') return res.status(401).json({ success: false, message: 'Token Expired' });
        return res.status(500).json({ success: false, message: 'Auth Error' });
    }
}

// ============================================
// GET API KEY — Atomic, কখনো auto-regenerate নয়
// ============================================
router.get('/', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('apiKey apiKeyActive apiKeyCreatedAt apiKeyUpdatedAt');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        // ✅ API key আছে — শুধু return করুন, কোনো generate নয়
        if (user.apiKey && user.apiKey.length === 10) {
            return res.json({
                success: true,
                apiKey: user.apiKey,
                apiKeyActive: user.apiKeyActive !== false,
                apiKeyCreatedAt: user.apiKeyCreatedAt || null,
                apiKeyUpdatedAt: user.apiKeyUpdatedAt || null
            });
        }

        // ✅ API key নেই — atomic upsert (শুধু প্রথমবার)
        const newKey = await generateUniqueApiKey();
        const updated = await User.findOneAndUpdate(
            {
                _id: user._id,
                $or: [
                    { apiKey: { $exists: false } },
                    { apiKey: null },
                    { apiKey: '' }
                ]
            },
            {
                $set: {
                    apiKey: newKey,
                    apiKeyActive: true,
                    apiKeyCreatedAt: new Date(),
                    apiKeyUpdatedAt: new Date()
                }
            },
            { new: true, select: 'apiKey apiKeyActive apiKeyCreatedAt apiKeyUpdatedAt' }
        );

        // Race condition — অন্য request আগেই generate করেছে
        if (!updated) {
            const fresh = await User.findById(user._id)
                .select('apiKey apiKeyActive apiKeyCreatedAt apiKeyUpdatedAt');
            return res.json({
                success: true,
                apiKey: fresh.apiKey,
                apiKeyActive: fresh.apiKeyActive !== false,
                apiKeyCreatedAt: fresh.apiKeyCreatedAt || null,
                apiKeyUpdatedAt: fresh.apiKeyUpdatedAt || null
            });
        }

        return res.json({
            success: true,
            apiKey: updated.apiKey,
            apiKeyActive: true,
            apiKeyCreatedAt: updated.apiKeyCreatedAt,
            apiKeyUpdatedAt: updated.apiKeyUpdatedAt,
            message: 'API Key Generated Successfully'
        });
    } catch (error) {
        console.error('Get API key error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch API Key' });
    }
});

// ============================================
// REGENERATE API KEY
// ============================================
router.post('/regenerate', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const dateTime = getCurrentDateTime();
        const newKey = await generateUniqueApiKey();
        const oldKey = user.apiKey;

        // ✅ Atomic update — শুধু apiKey field update করবে
        const updated = await User.findByIdAndUpdate(
            user._id,
            {
                $set: {
                    apiKey: newKey,
                    apiKeyActive: true,
                    apiKeyCreatedAt: new Date(),
                    apiKeyUpdatedAt: new Date()
                }
            },
            { new: true, select: 'apiKey apiKeyActive' }
        );

        if (updated.apiKey !== newKey) {
            return res.status(500).json({ success: false, message: 'Failed to save new API key' });
        }

        // Notify user
        if (user.telegramId) {
            const msg =
`🔄 <b>API Key Regenerated</b>

Dear <b>${escapeHtml(user.fullName)}</b>, Your API Key Has Been Regenerated Successfully.

🔑 <b>Old Key:</b> <code>${oldKey || 'N/A'}</code>
🆕 <b>New Key:</b> <code>${newKey}</code>
💼 <b>Wallet Id:</b> ${user.walletId}
🕒 <b>Time:</b> ${dateTime}

⚠️ Keep This New Key Secret. Do Not Share It With Anyone.`;
            sendTelegramMessage(user.telegramId, msg).catch(() => {});
        }

        // Notify admin
        notifyAdmin(
`🔄 <b>API Key Regenerated</b>

👤 <b>User:</b> ${user.fullName}
📱 <b>Mobile:</b> ${user.mobile}
🔑 <b>Old:</b> <code>${oldKey || 'N/A'}</code>
🆕 <b>New:</b> <code>${newKey}</code>
🕒 ${dateTime}`
        ).catch(() => {});

        res.json({
            success: true,
            message: 'API Key Regenerated Successfully',
            apiKey: newKey,
            apiKeyActive: true
        });
    } catch (error) {
        console.error('Regenerate error:', error);
        res.status(500).json({ success: false, message: 'Failed to regenerate API Key' });
    }
});

// ============================================
// TOGGLE API KEY STATUS (Enable/Disable)
// ✅ শুধু apiKeyActive field update — apiKey অপরিবর্তিত
// ============================================
router.post('/toggle', verifyToken, async (req, res) => {
    try {
        const { active } = req.body;
        const dateTime = getCurrentDateTime();

        if (typeof active !== 'boolean') {
            return res.status(400).json({ success: false, message: 'active must be true or false' });
        }

        const user = await User.findById(req.user._id).select('apiKey telegramId fullName walletId mobile');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (!user.apiKey) {
            return res.status(400).json({ success: false, message: 'No API Key found. Generate one first.' });
        }

        // ✅ শুধু apiKeyActive field update — apiKey কখনো touch হবে না
        const updated = await User.findByIdAndUpdate(
            user._id,
            {
                $set: {
                    apiKeyActive: active,
                    apiKeyUpdatedAt: new Date()
                }
            },
            { new: true, select: 'apiKey apiKeyActive apiKeyUpdatedAt' }
        );

        // Verify — save সত্যিই persist হয়েছে কি না
        if (updated.apiKeyActive !== active) {
            console.error('❌ Toggle failed to persist:', { expected: active, actual: updated.apiKeyActive });
            return res.status(500).json({ success: false, message: 'Failed to update API Key status' });
        }

        // ✅ একই apiKey ensure করুন
        if (updated.apiKey !== user.apiKey) {
            console.error('❌ apiKey changed during toggle!', {
                before: user.apiKey,
                after: updated.apiKey
            });
            return res.status(500).json({ success: false, message: 'API key integrity error' });
        }

        // Notify user
        if (user.telegramId) {
            const emoji = active ? '🟢' : '🔴';
            const statusText = active ? 'Enabled' : 'Disabled';
            const msg =
`${emoji} <b>API Key ${statusText}</b>

Dear <b>${escapeHtml(user.fullName)}</b>, Your API Key Has Been ${statusText}.

🔑 <b>API Key:</b> <code>${user.apiKey}</code>
📊 <b>Status:</b> ${statusText}
💼 <b>Wallet Id:</b> ${user.walletId}
🕒 <b>Time:</b> ${dateTime}

${active
    ? '✅ You Can Now Use Your API Key For Payments.'
    : '⚠️ Your API Key Will Not Work Until You Enable It Again.'}`;
            sendTelegramMessage(user.telegramId, msg).catch(() => {});
        }

        res.json({
            success: true,
            message: active ? 'API Key Enabled' : 'API Key Disabled',
            apiKey: updated.apiKey,
            apiKeyActive: updated.apiKeyActive
        });
    } catch (error) {
        console.error('Toggle error:', error);
        res.status(500).json({ success: false, message: 'Failed to toggle API Key' });
    }
});

// ============================================
// GET STATUS — with full API usage tracking
// ============================================
router.get('/status', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('apiKey apiKeyActive apiKeyCreatedAt apiKeyUpdatedAt totalApiCalls successfulApiCalls failedApiCalls lastApiUsedAt lastApiSuccessAt');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (!user.apiKey) {
            return res.json({
                success: true,
                hasApiKey: false,
                apiKeyActive: false,
                totalApiCalls: 0,
                successfulApiCalls: 0,
                failedApiCalls: 0,
                lastApiUsedAt: null,
                lastApiSuccessAt: null,
                message: 'No API Key generated yet'
            });
        }

        res.json({
            success: true,
            hasApiKey: true,
            apiKey: user.apiKey,
            apiKeyActive: user.apiKeyActive !== false,
            apiKeyCreatedAt: user.apiKeyCreatedAt || null,
            apiKeyUpdatedAt: user.apiKeyUpdatedAt || null,
            totalApiCalls: user.totalApiCalls || 0,
            successfulApiCalls: user.successfulApiCalls || 0,
            failedApiCalls: user.failedApiCalls || 0,
            lastApiUsedAt: user.lastApiUsedAt || null,
            lastApiSuccessAt: user.lastApiSuccessAt || null
        });
    } catch (error) {
        console.error('Status error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch status' });
    }
});

// ============================================
// VALIDATE API KEY (external)
// ============================================
router.get('/validate/:apiKey', async (req, res) => {
    try {
        const { apiKey } = req.params;
        if (!apiKey || apiKey.length !== 10 || !/^[A-Za-z0-9]+$/.test(apiKey)) {
            return res.status(400).json({ success: false, message: 'Invalid API Key Format' });
        }

        // Case-insensitive lookup
        const trimmedKey = String(apiKey).trim();
        const normalizedKey = trimmedKey.toUpperCase();

        let user = await User.findOne({ apiKey: normalizedKey })
            .select('fullName walletId mobile balance apiKeyActive isBlocked isDeleted');

        if (!user) {
            user = await User.findOne({
                apiKey: { $regex: `^${trimmedKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
            }).select('fullName walletId mobile balance apiKeyActive isBlocked isDeleted');
        }

        if (!user || user.isDeleted) return res.status(404).json({ success: false, message: 'Invalid API Key' });
        if (user.apiKeyActive === false) return res.status(403).json({ success: false, message: 'API Key is disabled' });
        if (user.isBlocked) return res.status(403).json({ success: false, message: 'User account is blocked' });

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
