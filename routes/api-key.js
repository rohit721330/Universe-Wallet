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
                message: 'Nᴏ Tᴏᴋᴇɴ Pʀᴏᴠɪᴅᴇᴅ' 
            });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ' 
            });
        }
        
        req.user = user;
        next();
    } catch (error) {
        console.error('Token verification error:', error);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Iɴᴠᴀʟɪᴅ Tᴏᴋᴇɴ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ Aɢᴀɪɴ.' 
            });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Tᴏᴋᴇɴ Exᴘɪʀᴇᴅ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ Aɢᴀɪɴ.' 
            });
        }
        return res.status(500).json({ 
            success: false, 
            message: 'Aᴜᴛʜᴇɴᴛɪᴄᴀᴛɪᴏɴ Eʀʀᴏʀ' 
        });
    }
}

// ============================================
// GET API KEY
// ============================================
router.get('/', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        
        if (!user.apiKey) {
            const newKey = generateRandomApiKey();
            const existingUser = await User.findOne({ apiKey: newKey, _id: { $ne: user._id } });
            if (existingUser) {
                const newKey2 = generateRandomApiKey();
                user.apiKey = newKey2;
            } else {
                user.apiKey = newKey;
            }
            await user.save();
            
            return res.json({
                success: true,
                apiKey: user.apiKey,
                message: 'Aᴘɪ Kᴇʏ Gᴇɴᴇʀᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ'
            });
        }
        
        res.json({
            success: true,
            apiKey: user.apiKey
        });
    } catch (error) {
        console.error('Get API key error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Aᴘɪ Kᴇʏ: ' + error.message 
        });
    }
});

// ============================================
// REGENERATE API KEY (Only message sent when changed)
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
                message: 'Uɴᴀʙʟᴇ Tᴏ Gᴇɴᴇʀᴀᴛᴇ UɴɪQᴜᴇ Kᴇʏ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.' 
            });
        }
        
        const oldKey = user.apiKey;
        user.apiKey = newKey;
        user.updatedAt = Date.now();
        await user.save();
        
        // Send notification to user only when regenerated
        if (user.telegramId) {
            const message = 
`<b>────────────────</b>
<b>🔄 Aᴘɪ Kᴇʏ Rᴇɢᴇɴᴇʀᴀᴛᴇᴅ</b>
<b>────────────────</b>

<b>👤 Dᴇᴀʀ ${user.fullName},</b> Yᴏᴜʀ Aᴘɪ Kᴇʏ Hᴀꜱ Bᴇᴇɴ Rᴇɢᴇɴᴇʀᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ.

<b>🔑 Oʟᴅ Kᴇʏ:</b> <code>${oldKey || 'N/A'}</code>
<b>🔑 Nᴇᴡ Kᴇʏ:</b> <code>${newKey}</code>
<b>🆔 Wᴀʟʟᴇᴛ Iᴅ:</b> ${user.walletId}
<b>⏰ Tɪᴍᴇ:</b> ${dateTime}

───────────────────────
🔒 Kᴇᴇᴘ Tʜɪꜱ Nᴇᴡ Kᴇʏ Sᴇᴄʀᴇᴛ. Dᴏ Nᴏᴛ Sʜᴀʀᴇ Iᴛ Wɪᴛʜ Aɴʏᴏɴᴇ.
───────────────────────`;
            
            await sendTelegramMessage(user.telegramId, message);
        }
        
        // Notify admin
        const adminMessage = 
`<b>─────────────────</b>
<b>🔄 Aᴘɪ Kᴇʏ Rᴇɢᴇɴᴇʀᴀᴛᴇᴅ</b>
<b>─────────────────</b>

<b>👤 Uꜱᴇʀ:</b> ${user.fullName}
<b>📱 Mᴏʙɪʟᴇ:</b> ${user.mobile}
<b>🆔 Wᴀʟʟᴇᴛ Iᴅ:</b> ${user.walletId}
<b>🔑 Oʟᴅ Kᴇʏ:</b> <code>${oldKey || 'N/A'}</code>
<b>🔑 Nᴇᴡ Kᴇʏ:</b> <code>${newKey}</code>
<b>⏰ Tɪᴍᴇ:</b> ${dateTime}
────────────────────`;
        
        await notifyAdmin(adminMessage);
        
        res.json({
            success: true,
            message: 'Aᴘɪ Kᴇʏ Rᴇɢᴇɴᴇʀᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ',
            apiKey: newKey
        });
    } catch (error) {
        console.error('Regenerate API key error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Fᴀɪʟᴇᴅ Tᴏ Rᴇɢᴇɴᴇʀᴀᴛᴇ Aᴘɪ Kᴇʏ: ' + error.message 
        });
    }
});

// ============================================
// VALIDATE API KEY (for external use)
// ============================================
router.get('/validate/:apiKey', async (req, res) => {
    try {
        const { apiKey } = req.params;
        
        if (!apiKey || apiKey.length !== 10 || !/^[A-Z0-9]+$/.test(apiKey)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Iɴᴠᴀʟɪᴅ Aᴘɪ Kᴇʏ Fᴏʀᴍᴀᴛ' 
            });
        }
        
        const user = await User.findOne({ apiKey }).select('fullName walletId mobile balance');
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'Iɴᴠᴀʟɪᴅ Aᴘɪ Kᴇʏ' 
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
            message: 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ' 
        });
    }
});

module.exports = router;
