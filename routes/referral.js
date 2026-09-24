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
// ENV VALIDATION
// =========================================================
console.log('════════════════════════════════════════════════════════');
console.log('🔵 [referral.js] MODULE LOADED at', new Date().toISOString());
console.log('🔵 [referral.js] JWT_SECRET set:', !!JWT_SECRET);
console.log('════════════════════════════════════════════════════════');

// ============================================
// HELPERS
// ============================================
function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sendTelegramMessage(chatId, message) {
    if (!BOT_TOKEN || !chatId) return { success: false };
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
// VERIFY TOKEN
// =========================================================
const verifyToken = async (req, res, next) => {
    console.log(`🔵 [verifyToken] ${req.method} ${req.originalUrl || req.url}`);
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(200).json({ success: false, message: 'No Token Provided' });

        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);

        if (!user) return res.status(200).json({ success: false, message: 'User Not Found' });
        if (user.isDeleted) return res.status(200).json({ success: false, message: 'This account has been deleted. Please contact support.' });
        if (user.isBlocked) return res.status(200).json({ success: false, message: 'Your account has been blocked. Please contact support.' });

        console.log(`✅ [verifyToken] Passed. User: ${user.mobile}`);
        req.user = user;
        next();
    } catch (error) {
        console.error(`❌ [verifyToken] Error:`, error.message);
        if (error.name === 'JsonWebTokenError') return res.status(200).json({ success: false, message: 'Invalid Token' });
        if (error.name === 'TokenExpiredError') return res.status(200).json({ success: false, message: 'Token Expired' });
        return res.status(200).json({ success: false, message: 'Auth Error. Please Try Again.' });
    }
};

// ============================================
// GENERATE UNIQUE REFERRAL CODE (10-char crypto-secure)
// ============================================
async function generateUniqueReferralCode(maxAttempts = 20) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let code = '';
        while (code.length < 10) {
            const byte = crypto.randomBytes(1)[0];
            if (byte < 252) code += chars[byte % chars.length];
        }
        const exists = await Referral.codeExists(code);
        if (!exists) return code;
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

// =========================================================
// ✅ ENSURE USER HAS ACTIVE CODE — Referral model
// =========================================================
async function ensureUserHasReferralCode(user) {
    console.log(`🔵 [ensureUserHasReferralCode] User: ${user.mobile}`);

    // ✅ Check Referral collection
    let activeCode = await Referral.getActiveCode(user._id);

    if (activeCode && activeCode.referralCode) {
        console.log(`✅ [ensureUserHasReferralCode] Active code exists: ${activeCode.referralCode}`);

        // Sync User.referralCode (mirror)
        if (user.referralCode !== activeCode.referralCode) {
            user.referralCode = activeCode.referralCode;
            user.referralCodeCustom = activeCode.isCustom;
            await user.save();
            console.log(`✅ [ensureUserHasReferralCode] Synced to User model`);
        }
        return activeCode.referralCode;
    }

    // ❌ No active code — generate new
    console.log(`⚠️ [ensureUserHasReferralCode] No active code — generating...`);
    const newCode = await generateUniqueReferralCode();

    const saved = await Referral.createCode(user._id, newCode, false);
    console.log(`✅ [ensureUserHasReferralCode] Created in Referral: ${saved.referralCode}`);

    // Sync to User model
    user.referralCode = saved.referralCode;
    user.referralCodeCustom = false;
    await user.save();

    return saved.referralCode;
}

// ============================================
// GET / — Main referral info
// ============================================
router.get('/', verifyToken, async (req, res) => {
    console.log(`🔵 [GET /referral/] User:`, req.user._id);
    try {
        const user = await User.findById(req.user._id)
            .select('fullName mobile walletId referralCode referralCodeCustom referralCount referralPendingCount referralEarnings referralSettings profilePicture');

        if (!user) return res.status(200).json({ success: false, message: 'User not found' });

        // ✅ Ensure active code exists
        const code = await ensureUserHasReferralCode(user);
        if (!code) {
            return res.status(200).json({ success: false, message: 'Failed to generate referral code. Please retry.' });
        }

        const stats = await Referral.getStatsForUser(user._id);
        const monthCount = await Referral.getMonthlyCount(user._id);

        return res.status(200).json({
            success: true,
            referralCode: code,
            referralCodeCustom: user.referralCodeCustom === true,
            referralLink: buildReferralLink(code),
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
        });
    } catch (error) {
        console.error(`❌ [GET /referral/] Error:`, error.message);
        return res.status(200).json({ success: false, message: 'Failed to fetch referral info' });
    }
});

// ============================================
// GET /stats
// ============================================
router.get('/stats', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('referralCode');
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });

        const stats = await Referral.getStatsForUser(user._id);
        const monthCount = await Referral.getMonthlyCount(user._id);

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
        console.error(`❌ [GET /stats] Error:`, error.message);
        return res.status(200).json({ success: false, message: 'Failed to fetch stats' });
    }
});

// ============================================
// GET /list
// ============================================
router.get('/list', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
        const skip = (page - 1) * limit;
        const status = req.query.status;

        const query = { referrerId: user._id };
        if (status && ['pending', 'completed', 'failed', 'expired'].includes(status)) query.status = status;

        const referrals = await Referral.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('referredUserId', 'fullName mobile profilePicture createdAt')
            .lean();

        const total = await Referral.countDocuments(query);

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
        console.error(`❌ [GET /list] Error:`, error.message);
        return res.status(200).json({ success: false, message: 'Failed to fetch referrals' });
    }
});

// ============================================
// ✅ GET /history — Code history
// ============================================
router.get('/history', verifyToken, async (req, res) => {
    console.log(`🔵 [GET /history] User: ${req.user._id}`);
    try {
        const history = await Referral.getUserCodeHistory(req.user._id, 50);

        return res.status(200).json({
            success: true,
            count: history.length,
            history: history.map(h => ({
                code: h.referralCode,
                status: h.codeStatus,
                isCustom: h.isCustom,
                usedCount: h.usedCount,
                createdAt: h.createdAt,
                replacedBy: h.replacedBy,
                replacedAt: h.replacedAt
            }))
        });
    } catch (error) {
        console.error(`❌ [GET /history] Error:`, error.message);
        return res.status(200).json({ success: false, message: 'Failed to fetch history' });
    }
});

// ============================================
// ✅ POST /custom-code — Referral model
// ============================================
router.post('/custom-code', verifyToken, async (req, res) => {
    console.log(`🔵 [POST /custom-code] User: ${req.user._id}, Code: ${req.body.code}`);

    try {
        const { code } = req.body;
        const user = await User.findById(req.user._id);
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });

        if (user.referralSettings?.allowCustomCode === false) {
            return res.status(200).json({ success: false, message: 'Custom referral codes are disabled for your account' });
        }

        const validation = validateCustomCodeFormat(code);
        if (!validation.valid) return res.status(200).json({ success: false, message: validation.message });

        const customCode = validation.code;

        // ✅ Check if code exists in Referral collection (any status)
        const existingCode = await Referral.codeExists(customCode);
        if (existingCode) {
            return res.status(200).json({ success: false, message: 'This code is already taken. Please try another one.' });
        }

        // ✅ Check current active code
        const currentActive = await Referral.getActiveCode(user._id);
        if (currentActive && currentActive.referralCode === customCode) {
            return res.status(200).json({ success: false, message: 'This is already your referral code' });
        }

        const oldCode = currentActive ? currentActive.referralCode : null;
        console.log(`🔵 [custom-code] Old: ${oldCode}, New: ${customCode}`);

        // ✅ Create new code in Referral collection
        const savedCode = await Referral.createCode(user._id, customCode, true);
        console.log(`✅ [custom-code] Referral code created: ${savedCode.referralCode}`);

        // ✅ Sync User model (mirror)
        user.referralCode = savedCode.referralCode;
        user.referralCodeCustom = true;
        await user.save();

        // Verify
        const verified = await User.findById(user._id).select('referralCode referralCodeCustom');
        console.log(`✅ [custom-code] Verified: User.referralCode = ${verified.referralCode}`);

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

        return res.status(200).json({
            success: true,
            message: 'Custom referral code set successfully',
            referralCode: customCode,
            referralCodeCustom: true,
            referralLink: buildReferralLink(customCode)
        });
    } catch (error) {
        console.error(`❌ [custom-code] Error:`, error.message);
        if (error.code === 11000) {
            return res.status(200).json({ success: false, message: 'This code is already taken. Please try another one.' });
        }
        return res.status(200).json({ success: false, message: 'Failed to set custom code' });
    }
});

// ============================================
// ✅ POST /regenerate-code
// ============================================
router.post('/regenerate-code', verifyToken, async (req, res) => {
    console.log(`🔵 [POST /regenerate-code] User: ${req.user._id}`);
    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(200).json({ success: false, message: 'User not found' });

        const currentActive = await Referral.getActiveCode(user._id);
        const oldCode = currentActive ? currentActive.referralCode : null;

        const newCode = await generateUniqueReferralCode();
        const savedCode = await Referral.createCode(user._id, newCode, false);

        user.referralCode = savedCode.referralCode;
        user.referralCodeCustom = false;
        await user.save();

        console.log(`✅ [regenerate-code] ${oldCode} → ${newCode}`);
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
// ✅ POST /check-code (public) — Referral model
// ============================================
router.post('/check-code', async (req, res) => {
    console.log(`🔵 [POST /check-code] Code:`, req.body.code);
    try {
        const { code } = req.body;
        if (!code || typeof code !== 'string') {
            return res.status(200).json({ success: false, valid: false, message: 'Code is required' });
        }

        const cleaned = code.trim().toUpperCase();

        // ✅ Lookup in Referral collection (active code with codeOwner)
        const codeRecord = await Referral.findOne({
            referralCode: cleaned,
            codeStatus: 'active',
            codeOwner: { $exists: true, $ne: null }
        })
        .populate('codeOwner', 'fullName mobile profilePicture referralSettings')
        .lean();

        if (!codeRecord || !codeRecord.codeOwner) {
            return res.status(200).json({ success: true, valid: false, message: 'Invalid referral code' });
        }

        const referrer = codeRecord.codeOwner;
        if (referrer.referralSettings?.enabled === false) {
            return res.status(200).json({ success: true, valid: false, message: 'This referral program is currently disabled' });
        }

        const nameParts = (referrer.fullName || 'User').split(' ');
        const displayName = nameParts[0] + (nameParts[1] ? ' ' + nameParts[1].charAt(0) + '.' : '');

        return res.status(200).json({
            success: true,
            valid: true,
            message: 'Valid referral code',
            referrer: {
                name: displayName,
                mobile: referrer.mobile ? ('••••' + referrer.mobile.slice(-4)) : '',
                profilePicture: referrer.profilePicture
            }
        });
    } catch (error) {
        console.error(`❌ [check-code] Error:`, error.message);
        return res.status(200).json({ success: false, valid: false, message: 'Server error' });
    }
});

// ============================================
// ✅ POST /apply
// ============================================
router.post('/apply', async (req, res) => {
    console.log(`🔵 [POST /apply] Body:`, req.body);
    try {
        const { code, newUserId } = req.body;
        if (!code || !newUserId) return res.status(200).json({ success: false, message: 'Code and newUserId are required' });

        const cleaned = code.trim().toUpperCase();

        // ✅ Lookup code owner in Referral collection
        const codeRecord = await Referral.findOne({
            referralCode: cleaned,
            codeStatus: 'active',
            codeOwner: { $exists: true, $ne: null }
        })
        .populate('codeOwner', '_id fullName referralSettings')
        .lean();

        if (!codeRecord || !codeRecord.codeOwner) {
            return res.status(200).json({ success: false, message: 'Invalid referral code' });
        }

        const referrer = codeRecord.codeOwner;
        if (referrer.referralSettings?.enabled === false) {
            return res.status(200).json({ success: false, message: 'Referral program is disabled' });
        }

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

        // ✅ Increment code usage
        await Referral.incrementUsage(cleaned);

        console.log(`✅ [apply] Referral created. Code: ${cleaned}`);
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
    console.log(`🔵 [POST /complete] Body:`, req.body);
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
// GET /settings
// ============================================
router.get('/settings', verifyToken, async (req, res) => {
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
// GET /leaderboard
// ============================================
router.get('/leaderboard', verifyToken, async (req, res) => {
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
