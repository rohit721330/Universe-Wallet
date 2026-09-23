// FILE: routes/referral.js
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mongoose = require('mongoose');

const User = require('../models/User');
const Referral = require('../models/Referral');
const Transaction = require('../models/Transaction');

const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG = process.env.ADMIN_TG_ID;

// =========================================================
// ✅ ENV VALIDATION
// =========================================================
console.log('════════════════════════════════════════════════════════');
console.log('🔵 [referral.js] MODULE LOADED at', new Date().toISOString());
console.log('🔵 [referral.js] JWT_SECRET set:', !!JWT_SECRET);
console.log('🔵 [referral.js] BOT_TOKEN set:', !!BOT_TOKEN);
console.log('════════════════════════════════════════════════════════');

if (!JWT_SECRET) console.error('❌ [referral.js] JWT Secret Is Not Set In Environment Variables.');
if (!BOT_TOKEN) console.error('❌ [referral.js] Bot Token Is Not Set In Environment Variables.');

// ============================================
// HELPERS
// ============================================
function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendTelegramMessage(chatId, message) {
    if (!BOT_TOKEN || !chatId) {
        console.log('⚠️ [referral.js] Telegram skip — BOT_TOKEN or chatId missing');
        return { success: false };
    }
    return new Promise((resolve) => {
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

// =========================================================
// ✅ VERIFY TOKEN — with detailed logging
// =========================================================
const verifyToken = async (req, res, next) => {
    const route = req.originalUrl || req.url;
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔵 [verifyToken] ${req.method} ${route}`);
    console.log(`🔵 [verifyToken] Timestamp:`, new Date().toISOString());

    try {
        const token = req.headers.authorization?.split(' ')[1];
        console.log(`🔵 [verifyToken] Token present:`, !!token);
        console.log(`🔵 [verifyToken] Token preview:`, token ? token.slice(0, 20) + '...' : 'MISSING');

        if (!token) {
            console.log(`❌ [verifyToken] No token provided`);
            return res.status(200).json({ success: false, message: 'No Token Provided' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        console.log(`✅ [verifyToken] JWT verified. userId:`, decoded.userId);

        // ✅ Check MongoDB connection before query
        console.log(`🔵 [verifyToken] Mongoose readyState:`, mongoose.connection.readyState);
        console.log(`🔵 [verifyToken] (0=disconnected, 1=connected, 2=connecting, 3=disconnecting)`);

        if (mongoose.connection.readyState !== 1) {
            console.log(`⚠️ [verifyToken] MongoDB NOT connected (readyState=${mongoose.connection.readyState})`);
            // Try to connect via global cache
            const cached = global.mongoose;
            if (cached && cached.promise) {
                console.log(`🔵 [verifyToken] Waiting for cached connection promise...`);
                try {
                    await cached.promise;
                    console.log(`✅ [verifyToken] Cached connection resolved. readyState:`, mongoose.connection.readyState);
                } catch (connErr) {
                    console.error(`❌ [verifyToken] Cached connection failed:`, connErr.message);
                }
            }
        }

        console.log(`🔵 [verifyToken] Querying User.findById...`);
        const user = await User.findById(decoded.userId);

        console.log(`🔵 [verifyToken] User found:`, !!user);
        if (user) {
            console.log(`🔵 [verifyToken] User details:`, {
                id: user._id,
                mobile: user.mobile,
                hasReferralCode: !!user.referralCode,
                referralCode: user.referralCode || 'NONE',
                isBlocked: user.isBlocked,
                isDeleted: user.isDeleted
            });
        }

        if (!user) {
            console.log(`❌ [verifyToken] User not found in DB`);
            return res.status(200).json({ success: false, message: 'User Not Found' });
        }

        if (user.isDeleted) {
            console.log(`❌ [verifyToken] User is deleted`);
            return res.status(200).json({
                success: false,
                message: 'This account has been deleted. Please contact support.'
            });
        }

        if (user.isBlocked) {
            console.log(`❌ [verifyToken] User is blocked`);
            return res.status(200).json({
                success: false,
                message: 'Your account has been blocked. Please contact support.'
            });
        }

        console.log(`✅ [verifyToken] Auth passed. Continuing to route...`);
        req.user = user;
        next();
    } catch (error) {
        console.error(`❌ [verifyToken] Error:`, {
            name: error.name,
            message: error.message,
            hasJwtSecret: !!JWT_SECRET,
            stack: error.stack ? error.stack.split('\n').slice(0, 3).join('\n') : 'NO_STACK'
        });

        if (error.name === 'JsonWebTokenError') {
            return res.status(200).json({ success: false, message: 'Invalid Token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(200).json({ success: false, message: 'Token Expired' });
        }
        return res.status(200).json({ success: false, message: 'Auth Error. Please Try Again.' });
    }
};

// ============================================
// GENERATE UNIQUE REFERRAL CODE
// ============================================
async function generateUniqueReferralCode(maxAttempts = 20) {
    console.log(`🔵 [generateUniqueReferralCode] Starting...`);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let code = '';
        while (code.length < 10) {
            const byte = crypto.randomBytes(1)[0];
            if (byte < 252) code += chars[byte % chars.length];
        }
        const exists = await User.findOne({ referralCode: code }).select('_id').lean();
        if (!exists) {
            console.log(`✅ [generateUniqueReferralCode] Generated: ${code} (attempt ${attempt + 1})`);
            return code;
        }
        console.log(`⚠️ [generateUniqueReferralCode] Collision on ${code}, retrying...`);
    }
    throw new Error('Unable to generate unique referral code after multiple attempts');
}

// ============================================
// VALIDATE CUSTOM CODE
// ============================================
function validateCustomCodeFormat(code) {
    if (!code) return { valid: false, message: 'Code is required' };
    if (typeof code !== 'string') return { valid: false, message: 'Code must be a string' };
    const cleaned = code.trim().toUpperCase();
    if (cleaned.length < 6 || cleaned.length > 15) return { valid: false, message: 'Code must be 6-15 characters long' };
    if (!/^[A-Z0-9]+$/.test(cleaned)) return { valid: false, message: 'Code can only contain letters (A-Z) and numbers (0-9)' };
    const reserved = ['ADMIN', 'SUPPORT', 'SYSTEM', 'WALLET', 'UNIVERSE', 'ROOT', 'NULL', 'UNDEFINED'];
    if (reserved.includes(cleaned)) return { valid: false, message: 'This code is reserved and cannot be used' };
    return { valid: true, code: cleaned };
}

// ============================================
// BUILD REFERRAL LINK
// ============================================
function buildReferralLink(code) {
    const baseUrl = process.env.APP_BASE_URL || 'https://universe-wallet.vercel.app';
    return `${baseUrl}/?ref=${code}`;
}

// ============================================
// ✅ ENSURE USER HAS REFERRAL CODE
// ============================================
async function ensureUserHasReferralCode(user) {
    console.log(`🔵 [ensureUserHasReferralCode] Checking user ${user.mobile}...`);
    console.log(`🔵 [ensureUserHasReferralCode] Current referralCode:`, user.referralCode || 'NONE');

    if (user.referralCode && user.referralCode.length >= 6) {
        console.log(`✅ [ensureUserHasReferralCode] Already has code: ${user.referralCode}`);
        return user.referralCode;
    }

    console.log(`⚠️ [ensureUserHasReferralCode] Missing code — generating...`);
    const newCode = await generateUniqueReferralCode();

    try {
        const updated = await User.findByIdAndUpdate(
            user._id,
            { $set: { referralCode: newCode, referralCodeCustom: false } },
            { new: true, select: 'referralCode referralCodeCustom' }
        );

        if (updated && updated.referralCode) {
            user.referralCode = updated.referralCode;
            user.referralCodeCustom = false;
            console.log(`✅ [ensureUserHasReferralCode] Saved to DB: ${newCode}`);
            return updated.referralCode;
        }
        console.log(`❌ [ensureUserHasReferralCode] findByIdAndUpdate returned no data`);
    } catch (err) {
        console.error('❌ [ensureUserHasReferralCode] Failed:', err.message);
    }

    return null;
}

// ============================================
// GET / — Main referral info
// ============================================
router.get('/', verifyToken, async (req, res) => {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔵 [GET /referral/] Handler started`);
    console.log(`🔵 [GET /referral/] User ID:`, req.user._id);
    console.log(`🔵 [GET /referral/] User mobile:`, req.user.mobile);

    try {
        console.log(`🔵 [GET /referral/] Fetching user from DB...`);
        const user = await User.findById(req.user._id)
            .select('fullName mobile walletId referralCode referralCodeCustom referralCount referralPendingCount referralEarnings referralSettings profilePicture');

        console.log(`🔵 [GET /referral/] User fetched:`, !!user);
        if (user) {
            console.log(`🔵 [GET /referral/] User data:`, {
                fullName: user.fullName,
                mobile: user.mobile,
                walletId: user.walletId,
                hasReferralCode: !!user.referralCode,
                referralCode: user.referralCode || 'NONE',
                referralCodeCustom: user.referralCodeCustom,
                referralCount: user.referralCount,
                referralPendingCount: user.referralPendingCount,
                referralEarnings: user.referralEarnings
            });
        }

        if (!user) {
            console.log(`❌ [GET /referral/] User not found`);
            return res.status(200).json({ success: false, message: 'User not found' });
        }

        // ✅ Auto-generate if missing
        if (!user.referralCode) {
            console.log(`⚠️ [GET /referral/] referralCode missing — calling ensureUserHasReferralCode`);
            const generated = await ensureUserHasReferralCode(user);
            if (!generated) {
                console.log(`❌ [GET /referral/] Failed to auto-generate referral code`);
                return res.status(200).json({ success: false, message: 'Failed to generate referral code. Please retry.' });
            }
            console.log(`✅ [GET /referral/] After auto-generate: ${user.referralCode}`);
        }

        console.log(`🔵 [GET /referral/] Fetching stats from Referral model...`);
        const stats = await Referral.getStatsForUser(user._id);
        const monthCount = await Referral.getMonthlyCount(user._id);

        console.log(`🔵 [GET /referral/] Stats:`, {
            totalReferrals: stats.totalReferrals,
            completed: stats.completedReferrals,
            pending: stats.pendingReferrals,
            earned: stats.totalEarned,
            monthCount
        });

        const response = {
            success: true,
            referralCode: user.referralCode,
            referralCodeCustom: user.referralCodeCustom === true,
            referralLink: buildReferralLink(user.referralCode),
            user: {
                fullName: user.fullName,
                mobile: user.mobile,
                walletId: user.walletId,
                profilePicture: user.profilePicture
            },
            stats: {
                totalReferrals: stats.totalReferrals,
                completedReferrals: stats.completedReferrals,
                pendingReferrals: stats.pendingReferrals,
                failedReferrals: stats.failedReferrals,
                totalEarned: stats.totalEarned,
                totalPendingBonus: stats.totalPendingBonus,
                monthReferrals: monthCount
            },
            settings: {
                enabled: user.referralSettings?.enabled !== false,
                bonusAmount: user.referralSettings?.bonusAmount ?? 10,
                requireFirstTransaction: user.referralSettings?.requireFirstTransaction !== false,
                allowCustomCode: user.referralSettings?.allowCustomCode !== false
            }
        };

        console.log(`✅ [GET /referral/] Sending response:`, {
            referralCode: response.referralCode,
            referralLink: response.referralLink,
            stats: response.stats
        });

        return res.status(200).json(response);
    } catch (error) {
        console.error(`❌ [GET /referral/] Error:`, {
            name: error.name,
            message: error.message,
            stack: error.stack ? error.stack.split('\n').slice(0, 3).join('\n') : 'NO_STACK'
        });
        return res.status(200).json({ success: false, message: 'Failed to fetch referral info' });
    }
});

// ============================================
// GET /stats
// ============================================
router.get('/stats', verifyToken, async (req, res) => {
    console.log(`🔵 [GET /referral/stats] Handler started. User:`, req.user._id);
    try {
        const user = await User.findById(req.user._id).select('referralCode');
        if (!user) {
            console.log(`❌ [GET /referral/stats] User not found`);
            return res.status(200).json({ success: false, message: 'User not found' });
        }

        const stats = await Referral.getStatsForUser(user._id);
        const monthCount = await Referral.getMonthlyCount(user._id);

        console.log(`✅ [GET /referral/stats] Stats:`, stats);
        return res.status(200).json({
            success: true,
            totalReferrals: stats.totalReferrals,
            completedReferrals: stats.completedReferrals,
            pendingReferrals: stats.pendingReferrals,
            failedReferrals: stats.failedReferrals,
            totalEarned: stats.totalEarned,
            totalPendingBonus: stats.totalPendingBonus,
            monthReferrals: monthCount
        });
    } catch (error) {
        console.error(`❌ [GET /referral/stats] Error:`, error.message);
        return res.status(200).json({ success: false, message: 'Failed to fetch stats' });
    }
});

// ============================================
// GET /list
// ============================================
router.get('/list', verifyToken, async (req, res) => {
    console.log(`🔵 [GET /referral/list] Handler started. User:`, req.user._id);
    try {
        const user = req.user;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;
        const status = req.query.status;

        console.log(`🔵 [GET /referral/list] Query params:`, { page, limit, skip, status });

        const query = { referrerId: user._id };
        if (status && ['pending', 'completed', 'failed', 'expired'].includes(status)) query.status = status;

        const referrals = await Referral.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('referredUserId', 'fullName mobile profilePicture createdAt')
            .lean();

        const total = await Referral.countDocuments(query);

        console.log(`🔵 [GET /referral/list] Found ${referrals.length} referrals (total: ${total})`);

        const list = referrals.map(r => {
            const u = r.referredUserId || {};
            return {
                _id: r._id,
                name: u.fullName || 'User',
                mobile: u.mobile ? ('••••' + u.mobile.slice(-4)) : '',
                profilePicture: u.profilePicture || null,
                joinedAt: u.createdAt || r.createdAt,
                status: r.status,
                bonusAmount: r.bonusAmount,
                completedAt: r.completedAt,
                referrerBonusPaid: r.referrerBonusPaid
            };
        });

        return res.status(200).json({
            success: true,
            referrals: list,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(total / limit),
                totalReferrals: total,
                limit
            }
        });
    } catch (error) {
        console.error(`❌ [GET /referral/list] Error:`, error.message);
        return res.status(200).json({ success: false, message: 'Failed to fetch referrals' });
    }
});

// ============================================
// POST /custom-code
// ============================================
router.post('/custom-code', verifyToken, async (req, res) => {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔵 [POST /referral/custom-code] Handler started`);
    console.log(`🔵 [POST /referral/custom-code] User:`, req.user._id);
    console.log(`🔵 [POST /referral/custom-code] Body:`, req.body);

    try {
        const { code } = req.body;
        console.log(`🔵 [custom-code] Step 1: Received code:`, code);

        const user = await User.findById(req.user._id);
        console.log(`🔵 [custom-code] Step 2: User fetched:`, !!user);

        if (!user) return res.status(200).json({ success: false, message: 'User not found' });

        console.log(`🔵 [custom-code] Step 3: User referralCode:`, user.referralCode || 'NONE');
        console.log(`🔵 [custom-code] Step 4: allowCustomCode:`, user.referralSettings?.allowCustomCode);

        if (user.referralSettings?.allowCustomCode === false) {
            console.log(`❌ [custom-code] Custom codes disabled`);
            return res.status(200).json({ success: false, message: 'Custom referral codes are disabled for your account' });
        }

        const validation = validateCustomCodeFormat(code);
        console.log(`🔵 [custom-code] Step 5: Validation:`, validation);

        if (!validation.valid) return res.status(200).json({ success: false, message: validation.message });

        const customCode = validation.code;
        console.log(`🔵 [custom-code] Step 6: Cleaned code:`, customCode);

        // Check existing
        const existing = await User.findOne({ referralCode: customCode, _id: { $ne: user._id } }).select('_id').lean();
        console.log(`🔵 [custom-code] Step 7: Existing user with this code:`, existing);

        if (existing) return res.status(200).json({ success: false, message: 'This code is already taken. Please try another one.' });

        if (user.referralCode === customCode) {
            console.log(`⚠️ [custom-code] Same as current code`);
            return res.status(200).json({ success: false, message: 'This is already your referral code' });
        }

        const oldCode = user.referralCode || null;
        console.log(`🔵 [custom-code] Step 8: Old code was:`, oldCode);

        // Update user
        user.referralCode = customCode;
        user.referralCodeCustom = true;

        console.log(`🔵 [custom-code] Step 9: Saving user...`);
        try {
            await user.save();
            console.log(`✅ [custom-code] Step 10: User saved successfully`);
        } catch (saveErr) {
            console.error(`❌ [custom-code] User save error:`, {
                name: saveErr.name,
                code: saveErr.code,
                message: saveErr.message,
                keyPattern: saveErr.keyPattern,
                keyValue: saveErr.keyValue
            });

            if (saveErr.code === 11000) {
                return res.status(200).json({
                    success: false,
                    message: 'This code is already taken. Please try another one.'
                });
            }
            return res.status(200).json({
                success: false,
                message: 'Failed to save custom code: ' + saveErr.message
            });
        }

        // Verify
        const verified = await User.findById(user._id).select('referralCode referralCodeCustom');
        console.log(`🔵 [custom-code] Step 11: Verified from DB:`, {
            referralCode: verified ? verified.referralCode : 'NULL',
            referralCodeCustom: verified ? verified.referralCodeCustom : 'NULL',
            matches: verified && verified.referralCode === customCode
        });

        if (!verified || verified.referralCode !== customCode) {
            return res.status(200).json({ success: false, message: 'Save verification failed. Please retry.' });
        }

        // Telegram notification
        if (user.telegramId) {
            const msg =
`🎯 <b>Referral Code Updated</b>

Dear <b>${escapeHtml(user.fullName)}</b>, Your Custom Referral Code Has Been Set.

🔑 <b>Old Code:</b> <code>${oldCode || 'N/A'}</code>
✨ <b>New Code:</b> <code>${customCode}</code>
💼 <b>Wallet Id:</b> ${user.walletId}
🕒 <b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

Share your new code and start earning rewards! 🎁`;
            sendTelegramMessage(user.telegramId, msg).catch(() => {});
        }

        console.log(`✅ [custom-code] SUCCESS. Returning:`, {
            referralCode: customCode,
            referralLink: buildReferralLink(customCode)
        });

        return res.status(200).json({
            success: true,
            message: 'Custom referral code set successfully',
            referralCode: customCode,
            referralCodeCustom: true,
            referralLink: buildReferralLink(customCode)
        });
    } catch (error) {
        console.error(`❌ [POST /referral/custom-code] FATAL Error:`, {
            name: error.name,
            message: error.message,
            stack: error.stack ? error.stack.split('\n').slice(0, 5).join('\n') : 'NO_STACK'
        });
        return res.status(200).json({ success: false, message: 'Failed to set custom code' });
    }
});

// ============================================
// POST /regenerate-code
// ============================================
router.post('/regenerate-code', verifyToken, async (req, res) => {
    console.log(`🔵 [POST /referral/regenerate-code] User:`, req.user._id);
    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });

        const oldCode = user.referralCode || null;
        const newCode = await generateUniqueReferralCode();

        user.referralCode = newCode;
        user.referralCodeCustom = false;
        await user.save();

        const verified = await User.findById(user._id).select('referralCode');
        if (!verified || verified.referralCode !== newCode) {
            return res.status(200).json({ success: false, message: 'Save verification failed' });
        }

        console.log(`✅ [regenerate-code] Old: ${oldCode} → New: ${newCode}`);
        return res.status(200).json({
            success: true,
            message: 'Referral code regenerated successfully',
            referralCode: newCode,
            referralCodeCustom: false,
            referralLink: buildReferralLink(newCode)
        });
    } catch (error) {
        console.error(`❌ [regenerate-code] Error:`, error.message);
        return res.status(200).json({ success: false, message: 'Failed to regenerate code' });
    }
});

// ============================================
// POST /check-code (public)
// ============================================
router.post('/check-code', async (req, res) => {
    console.log(`🔵 [POST /referral/check-code] Body:`, req.body);
    try {
        const { code } = req.body;
        if (!code || typeof code !== 'string') {
            return res.status(200).json({ success: false, valid: false, message: 'Code is required' });
        }

        const cleaned = code.trim().toUpperCase();
        const user = await User.findOne({ referralCode: cleaned })
            .select('fullName mobile profilePicture referralSettings')
            .lean();

        if (!user) {
            console.log(`❌ [check-code] Not found: ${cleaned}`);
            return res.status(200).json({ success: true, valid: false, message: 'Invalid referral code' });
        }

        console.log(`✅ [check-code] Valid: ${cleaned} → ${user.fullName}`);
        const nameParts = (user.fullName || 'User').split(' ');
        const displayName = nameParts[0] + (nameParts[1] ? ' ' + nameParts[1].charAt(0) + '.' : '');

        return res.status(200).json({
            success: true,
            valid: true,
            message: 'Valid referral code',
            referrer: {
                name: displayName,
                mobile: user.mobile ? ('••••' + user.mobile.slice(-4)) : '',
                profilePicture: user.profilePicture
            }
        });
    } catch (error) {
        console.error(`❌ [check-code] Error:`, error.message);
        return res.status(200).json({ success: false, valid: false, message: 'Server error' });
    }
});

// ============================================
// GET /settings
// ============================================
router.get('/settings', verifyToken, async (req, res) => {
    console.log(`🔵 [GET /referral/settings] User:`, req.user._id);
    try {
        const user = await User.findById(req.user._id).select('referralSettings referralCode referralCodeCustom');
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });
        return res.status(200).json({
            success: true,
            settings: {
                enabled: user.referralSettings?.enabled !== false,
                bonusAmount: user.referralSettings?.bonusAmount ?? 10,
                requireFirstTransaction: user.referralSettings?.requireFirstTransaction !== false,
                allowCustomCode: user.referralSettings?.allowCustomCode !== false
            },
            referralCode: user.referralCode,
            referralCodeCustom: user.referralCodeCustom === true
        });
    } catch (error) {
        console.error(`❌ [settings] Error:`, error.message);
        return res.status(200).json({ success: false, message: 'Failed to fetch settings' });
    }
});

// ============================================
// POST /apply
// ============================================
router.post('/apply', async (req, res) => {
    console.log(`🔵 [POST /referral/apply] Body:`, req.body);
    try {
        const { code, newUserId } = req.body;
        if (!code || !newUserId) return res.status(200).json({ success: false, message: 'Code and newUserId are required' });

        const cleaned = code.trim().toUpperCase();
        const referrer = await User.findOne({ referralCode: cleaned })
            .select('_id fullName referralSettings')
            .lean();

        if (!referrer) return res.status(200).json({ success: false, message: 'Invalid referral code' });

        const newUser = await User.findById(newUserId);
        if (!newUser) return res.status(200).json({ success: false, message: 'New user not found' });
        if (referrer._id.toString() === newUser._id.toString()) return res.status(200).json({ success: false, message: 'You cannot refer yourself' });
        if (newUser.referredBy) return res.status(200).json({ success: false, message: 'User already referred' });

        const existing = await Referral.findOne({ referrerId: referrer._id, referredUserId: newUser._id }).lean();
        if (existing) return res.status(200).json({ success: false, message: 'Referral already exists' });

        const bonusAmount = referrer.referralSettings?.bonusAmount ?? 10;
        const referral = new Referral({
            referrerId: referrer._id,
            referredUserId: newUser._id,
            referralCode: cleaned,
            status: 'pending',
            bonusAmount,
            metadata: { appliedAt: new Date(), newUserMobile: newUser.mobile }
        });
        await referral.save();

        await User.updateOne({ _id: referrer._id }, { $inc: { referralPendingCount: 1 } });
        await User.updateOne(
            { _id: newUser._id },
            { $set: { referredBy: referrer._id, referredByCode: cleaned } }
        );

        console.log(`✅ [apply] Referral created: ${cleaned} → ${newUser.mobile}`);
        return res.status(200).json({
            success: true,
            message: 'Referral code applied successfully',
            referralId: referral._id,
            referrer: { fullName: referrer.fullName },
            bonusAmount,
            status: 'pending'
        });
    } catch (error) {
        console.error(`❌ [apply] Error:`, error.message);
        return res.status(200).json({ success: false, message: 'Failed to apply referral' });
    }
});

// ============================================
// POST /complete
// ============================================
router.post('/complete', async (req, res) => {
    console.log(`🔵 [POST /referral/complete] Body:`, req.body);
    try {
        const { newUserId } = req.body;
        if (!newUserId) return res.status(200).json({ success: false, message: 'newUserId is required' });

        const newUser = await User.findById(newUserId);
        if (!newUser) return res.status(200).json({ success: false, message: 'User not found' });
        if (!newUser.referredBy) return res.status(200).json({ success: false, message: 'User was not referred' });

        const referral = await Referral.findOne({
            referrerId: newUser.referredBy,
            referredUserId: newUser._id,
            status: 'pending'
        });

        if (!referral) return res.status(200).json({ success: false, message: 'No pending referral found' });

        const referrer = await User.findById(referral.referrerId);
        if (!referrer) return res.status(200).json({ success: false, message: 'Referrer not found' });

        const bonusAmount = referral.bonusAmount || 10;
        const now = new Date();

        referral.status = 'completed';
        referral.completedAt = now;
        referral.referrerBonusPaid = true;
        referral.referredBonusPaid = true;
        referral.referrerBonusPaidAt = now;
        referral.referredBonusPaidAt = now;
        await referral.save();

        await User.updateOne(
            { _id: referrer._id },
            {
                $inc: {
                    balance: bonusAmount,
                    referralCount: 1,
                    referralPendingCount: -1,
                    referralEarnings: bonusAmount
                }
            }
        );

        await User.updateOne({ _id: newUser._id }, { $inc: { balance: bonusAmount } });

        const txnId = 'REF' + crypto.randomBytes(8).toString('hex').toUpperCase();
        await Transaction.create([
            {
                user_id: referrer._id,
                sender_id: referrer._id,
                receiver_id: referrer._id,
                amount: bonusAmount,
                type: 'gift',
                status: 'success',
                remark: `Referral bonus from ${newUser.fullName || 'user'}`,
                description: `Referral bonus`,
                tx_id: txnId + '-REF',
                tx_time: now,
                metadata: { transactionType: 'referral_bonus_received', referredUserId: newUser._id, bonusType: 'referrer' }
            },
            {
                user_id: newUser._id,
                sender_id: newUser._id,
                receiver_id: newUser._id,
                amount: bonusAmount,
                type: 'gift',
                status: 'success',
                remark: `Welcome bonus from referral`,
                description: `Referral welcome bonus`,
                tx_id: txnId + '-WEL',
                tx_time: now,
                metadata: { transactionType: 'referral_welcome_bonus', referrerId: referrer._id, bonusType: 'referred' }
            }
        ]);

        console.log(`✅ [complete] Referral completed: ${referral._id}`);
        return res.status(200).json({
            success: true,
            message: 'Referral completed and bonuses paid',
            referralId: referral._id,
            bonusAmount
        });
    } catch (error) {
        console.error(`❌ [complete] Error:`, error.message);
        return res.status(200).json({ success: false, message: 'Failed to complete referral' });
    }
});

// ============================================
// GET /leaderboard
// ============================================
router.get('/leaderboard', verifyToken, async (req, res) => {
    console.log(`🔵 [GET /referral/leaderboard] User:`, req.user._id);
    try {
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
        const top = await User.find({ referralCount: { $gt: 0 }, isBlocked: false, isDeleted: false })
            .sort({ referralCount: -1, referralEarnings: -1 })
            .limit(limit)
            .select('fullName walletId profilePicture referralCount referralEarnings')
            .lean();

        const leaderboard = top.map((u, idx) => {
            const nameParts = (u.fullName || 'User').split(' ');
            const displayName = nameParts[0] + (nameParts[1] ? ' ' + nameParts[1].charAt(0) + '.' : '');
            return {
                rank: idx + 1,
                name: displayName,
                profilePicture: u.profilePicture,
                referralCount: u.referralCount,
                totalEarned: u.referralEarnings
            };
        });

        console.log(`✅ [leaderboard] Found ${leaderboard.length} entries`);
        return res.status(200).json({ success: true, leaderboard });
    } catch (error) {
        console.error(`❌ [leaderboard] Error:`, error.message);
        return res.status(200).json({ success: false, message: 'Failed to fetch leaderboard' });
    }
});

// ============================================
// EXPORTS
// ============================================
module.exports = router;
module.exports.generateUniqueReferralCode = generateUniqueReferralCode;
module.exports.validateCustomCodeFormat = validateCustomCodeFormat;
module.exports.buildReferralLink = buildReferralLink;
