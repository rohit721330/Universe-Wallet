// FILE: routes/api-key.js
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// CONSTANTS
const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG = process.env.ADMIN_TG_ID;

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

// Helper: Send notification to admin
async function notifyAdmin(message) {
    try {
        await sendTelegramMessage(ADMIN_TG, message);
        console.log('Admin notification sent successfully');
    } catch (error) {
        console.error('Failed to send admin notification:', error);
    }
}

// Helper: Get current date and time in IST
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

// ==================== GENERATE RANDOM API KEY ====================
function generateRandomApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let key = '';
    for (let i = 0; i < 10; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
}

// ==================== VERIFY TOKEN MIDDLEWARE ====================
async function verifyToken(req, res, next) {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'No Token Provided' 
            });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'User Not Found' 
            });
        }
        
        if (user.isDeleted === true) {
            return res.status(401).json({ 
                success: false, 
                message: 'Account Deleted' 
            });
        }
        
        if (user.isBlocked === true) {
            return res.status(403).json({ 
                success: false, 
                message: 'Account Blocked' 
            });
        }
        
        req.user = user;
        next();
    } catch (error) {
        console.error('Token verification error:', error);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid Token. Please Login Again.' 
            });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Token Expired. Please Login Again.' 
            });
        }
        return res.status(500).json({ 
            success: false, 
            message: 'Authentication Error' 
        });
    }
}

// ============================================
// GET API KEY
// ============================================
router.get('/', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        
        // যদি API key না থাকে, নতুন generate করুন
        if (!user.apiKey) {
            const newKey = generateRandomApiKey();
            const existingUser = await User.findOne({ apiKey: newKey, _id: { $ne: user._id } });
            if (existingUser) {
                const newKey2 = generateRandomApiKey();
                user.apiKey = newKey2;
            } else {
                user.apiKey = newKey;
            }
            
            // ✅ নতুন key generate হলে active করে দিন
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
        
        // ✅ apiKeyActive status return করুন
        res.json({
            success: true,
            apiKey: user.apiKey,
            apiKeyActive: user.apiKeyActive !== false,
            apiKeyCreatedAt: user.apiKeyCreatedAt || null,
            apiKeyUpdatedAt: user.apiKeyUpdatedAt || null
        });
    } catch (error) {
        console.error('Get API key error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed To Fetch API Key: ' + error.message 
        });
    }
});

// ============================================
// REGENERATE API KEY
// ============================================
router.post('/regenerate', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        const dateTime = getCurrentDateTime();
        
        let newKey = generateRandomApiKey();
        let attempts = 0;
        let existingUser = await User.findOne({ apiKey: newKey, _id: { $ne: user._id } });
        
        while (existingUser && attempts < 10) {
            newKey = generateRandomApiKey();
            existingUser = await User.findOne({ apiKey: newKey, _id: { $ne: user._id } });
            attempts++;
        }
        
        if (existingUser) {
            return res.status(400).json({ 
                success: false, 
                message: 'Unable To Generate Unique Key. Please Try Again.' 
            });
        }
        
        const oldKey = user.apiKey;
        user.apiKey = newKey;
        user.apiKeyActive = true;   // ✅ নতুন key সবসময় active
        user.apiKeyCreatedAt = new Date();
        user.apiKeyUpdatedAt = new Date();
        user.updatedAt = Date.now();
        await user.save();
        
        // Send notification to user
        if (user.telegramId) {
            const message = 
`🔄 <b>API Key Regenerated</b>

👤 Dear <b>${user.fullName}</b>, Your API Key Has Been Regenerated Successfully.

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
        res.status(500).json({ 
            success: false, 
            message: 'Failed To Regenerate API Key: ' + error.message 
        });
    }
});

// ============================================
// TOGGLE API KEY STATUS (Enable/Disable)
// ============================================
router.post('/toggle', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        const { active } = req.body;
        const dateTime = getCurrentDateTime();
        
        // ✅ Validate input
        if (typeof active !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'active must be true or false'
            });
        }
        
        if (!user.apiKey) {
            return res.status(400).json({
                success: false,
                message: 'No API Key found. Generate one first.'
            });
        }
        
        // ✅ Toggle
        user.apiKeyActive = active;
        user.apiKeyUpdatedAt = new Date();
        await user.save();
        
        // Send notification to user
        if (user.telegramId) {
            const emoji = active ? '🟢' : '🔴';
            const statusText = active ? 'Enabled' : 'Disabled';
            const message = 
`${emoji} <b>API Key ${statusText}</b>

👤 Dear <b>${user.fullName}</b>, Your API Key Has Been ${statusText}.

🔑 <b>API Key:</b> <code>${user.apiKey}</code>
📊 <b>Status:</b> ${statusText}
💼 <b>Wallet Id:</b> ${user.walletId}
🕒 <b>Time:</b> ${dateTime}

${active ? '✅ You Can Now Use Your API Key For Payments.' : '⚠️ Your API Key Will Not Work Until You Enable It Again.'}`;
            
            await sendTelegramMessage(user.telegramId, message);
        }
        
        res.json({
            success: true,
            message: active ? 'API Key Enabled' : 'API Key Disabled',
            apiKey: user.apiKey,
            apiKeyActive: user.apiKeyActive
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
        const user = req.user;
        
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
            apiKeyActive: user.apiKeyActive !== false,
            apiKeyCreatedAt: user.apiKeyCreatedAt || null,
            apiKeyUpdatedAt: user.apiKeyUpdatedAt || null
        });
    } catch (error) {
        console.error('Get API key status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch API Key status'
        });
    }
});

// ============================================
// VALIDATE API KEY (for external use)
// ============================================
router.get('/validate/:apiKey', async (req, res) => {
    try {
        const { apiKey } = req.params;
        
        // Format check
        if (!apiKey || apiKey.length !== 10 || !/^[A-Z0-9]+$/.test(apiKey)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid API Key Format' 
            });
        }
        
        // ═══ STEP 1: Key exists? ═══
        const user = await User.findOne({ apiKey: apiKey.toUpperCase() })
            .select('fullName walletId mobile balance apiKeyActive isBlocked isDeleted');
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Invalid API Key' 
            });
        }
        
        if (user.isDeleted === true) {
            return res.status(404).json({ 
                success: false, 
                message: 'Invalid API Key' 
            });
        }
        
        // ═══ STEP 2: Key active? ═══
        if (user.apiKeyActive === false) {
            return res.status(403).json({ 
                success: false, 
                message: 'API Key is disabled' 
            });
        }
        
        // ═══ STEP 3: User blocked? ═══
        if (user.isBlocked === true) {
            return res.status(403).json({ 
                success: false, 
                message: 'User account is blocked' 
            });
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
        res.status(500).json({ 
            success: false, 
            message: 'Server Error' 
        });
    }
});

module.exports = router;
