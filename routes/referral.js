// FILE: routes/refer.js
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

// ============================================
// HELPERS
// ============================================
function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

// ============================================
// AUTH MIDDLEWARE
// ============================================
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
// GENERATE UNIQUE REFERRAL CODE
// ============================================
async function generateUniqueReferralCode(maxAttempts = 20) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        let code = '';
        while (code.length < 10) {
            const byte = crypto.randomBytes(1)[0];
            if (byte < 252) code += chars[byte % chars.length];
        }
        const exists = await User.findOne({ referralCode: code }).select('_id').lean();
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

// ============================================
// GET / — Main referral info
// ============================================
router.get('/', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('fullName mobile walletId referralCode referralCodeCustom referralCount referralPendingCount referralEarnings referralSettings profilePicture');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (!user.referralCode) {
            try {
                const newCode = await generateUniqueReferralCode();
                const updated = await User.findByIdAndUpdate(
                    user._id,
                    { $set: { referralCode: newCode, referralCodeCustom: false } },
                    { new: true, select: 'referralCode referralCodeCustom' }
                );
                user.referralCode = updated.referralCode;
                user.referralCodeCustom = false;
            } catch (err) {
                return res.status(500).json({ success: false, message: 'Failed to generate referral code. Please retry.' });
            }
        }

        const stats = await Referral.getStatsForUser(user._id);
        const monthCount = await Referral.getMonthlyCount(user._id);

        return res.json({
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
        });
    } catch (error) {
        console.error('Get referral info error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch referral info' });
    }
});

// ============================================
// GET /stats
// ============================================
router.get('/stats', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('referralCode');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        const stats = await Referral.getStatsForUser(user._id);
        const monthCount = await Referral.getMonthlyCount(user._id);
        return res.json({
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
        return res.status(500).json({ success: false, message: 'Failed to fetch stats' });
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

        return res.json({
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
        console.error('Get referral list error:', error);
        return res.status(500).json({ success: false, message: 'Failed to fetch referrals' });
    }
});

// ============================================
// POST /custom-code
// ============================================
router.post('/custom-code', verifyToken, async (req, res) => {
    try {
        const { code } = req.body;
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (user.referralSettings?.allowCustomCode === false) {
            return res.status(403).json({ success: false, message: 'Custom referral codes are disabled for your account' });
        }

        const validation = validateCustomCodeFormat(code);
        if (!validation.valid) return res.status(400).json({ success: false, message: validation.message });

        const customCode = validation.code;

        const existing = await User.findOne({ referralCode: customCode, _id: { $ne: user._id } }).select('_id').lean();
        if (existing) return res.status(409).json({ success: false, message: 'This code is already taken. Please try another one.' });

        if (user.referralCode === customCode) return res.status(400).json({ success: false, message: 'This is already your referral code' });

        const oldCode = user.referralCode;
        const updated = await User.findByIdAndUpdate(
            user._id,
            { $set: { referralCode: customCode, referralCodeCustom: true } },
            { new: true, select: 'referralCode referralCodeCustom' }
        );

        if (updated.referralCode !== customCode) return res.status(500).json({ success: false, message: 'Failed to save custom code' });

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

        return res.json({
            success: true,
            message: 'Custom referral code set successfully',
            referralCode: customCode,
            referralCodeCustom: true,
            referralLink: buildReferralLink(customCode)
        });
    } catch (error) {
        console.error('Set custom code error:', error);
        return res.status(500).json({ success: false, message: 'Failed to set custom code' });
    }
});

// ============================================
// POST /regenerate-code
// ============================================
router.post('/regenerate-code', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const oldCode = user.referralCode;
        const newCode = await generateUniqueReferralCode();

        const updated = await User.findByIdAndUpdate(
            user._id,
            { $set: { referralCode: newCode, referralCodeCustom: false } },
            { new: true, select: 'referralCode referralCodeCustom' }
        );

        if (updated.referralCode !== newCode) return res.status(500).json({ success: false, message: 'Failed to save new code' });

        if (user.telegramId) {
            const msg =
`🔄 <b>Referral Code Regenerated</b>

Dear <b>${escapeHtml(user.fullName)}</b>, Your Referral Code Has Been Regenerated.

🔑 <b>Old Code:</b> <code>${oldCode || 'N/A'}</code>
🆕 <b>New Code:</b> <code>${newCode}</code>
💼 <b>Wallet Id:</b> ${user.walletId}
🕒 <b>Time:</b> ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

⚠️ Your old code will no longer work. Share the new one!`;
            sendTelegramMessage(user.telegramId, msg).catch(() => {});
        }

        return res.json({
            success: true,
            message: 'Referral code regenerated successfully',
            referralCode: newCode,
            referralCodeCustom: false,
            referralLink: buildReferralLink(newCode)
        });
    } catch (error) {
        console.error('Regenerate code error:', error);
        return res.status(500).json({ success: false, message: 'Failed to regenerate code' });
    }
});

// ============================================
// POST /check-code (public)
// ============================================
router.post('/check-code', async (req, res) => {
    try {
        const { code } = req.body;
        if (!code || typeof code !== 'string') {
            return res.status(400).json({ success: false, valid: false, message: 'Code is required' });
        }

        const cleaned = code.trim().toUpperCase();
        const user = await User.findOne({ referralCode: cleaned })
            .select('fullName mobile profilePicture referralSettings')
            .lean();

        if (!user) return res.json({ success: true, valid: false, message: 'Invalid referral code' });
        if (user.referralSettings?.enabled === false) return res.json({ success: true, valid: false, message: 'This referral program is currently disabled' });

        const nameParts = (user.fullName || 'User').split(' ');
        const displayName = nameParts[0] + (nameParts[1] ? ' ' + nameParts[1].charAt(0) + '.' : '');

        return res.json({
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
        console.error('Check code error:', error);
        return res.status(500).json({ success: false, valid: false, message: 'Server error' });
    }
});

// ============================================
// POST /apply
// ============================================
router.post('/apply', async (req, res) => {
    try {
        const { code, newUserId } = req.body;
        if (!code || !newUserId) return res.status(400).json({ success: false, message: 'Code and newUserId are required' });

        const cleaned = code.trim().toUpperCase();
        const referrer = await User.findOne({ referralCode: cleaned })
            .select('_id fullName referralSettings')
            .lean();

        if (!referrer) return res.status(404).json({ success: false, message: 'Invalid referral code' });
        if (referrer.referralSettings?.enabled === false) return res.status(400).json({ success: false, message: 'Referral program is disabled' });

        const newUser = await User.findById(newUserId);
        if (!newUser) return res.status(404).json({ success: false, message: 'New user not found' });
        if (referrer._id.toString() === newUser._id.toString()) return res.status(400).json({ success: false, message: 'You cannot refer yourself' });
        if (newUser.referredBy) return res.status(400).json({ success: false, message: 'User already referred' });

        const existing = await Referral.findOne({ referrerId: referrer._id, referredUserId: newUser._id }).lean();
        if (existing) return res.status(409).json({ success: false, message: 'Referral already exists' });

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

        return res.json({
            success: true,
            message: 'Referral code applied successfully',
            referralId: referral._id,
            referrer: { fullName: referrer.fullName },
            bonusAmount,
            status: 'pending'
        });
    } catch (error) {
        console.error('Apply referral error:', error);
        return res.status(500).json({ success: false, message: 'Failed to apply referral' });
    }
});

// ============================================
// POST /complete
// ============================================
router.post('/complete', async (req, res) => {
    try {
        const { newUserId } = req.body;
        if (!newUserId) return res.status(400).json({ success: false, message: 'newUserId is required' });

        const newUser = await User.findById(newUserId);
        if (!newUser) return res.status(404).json({ success: false, message: 'User not found' });
        if (!newUser.referredBy) return res.json({ success: false, message: 'User was not referred' });

        const referral = await Referral.findOne({
            referrerId: newUser.referredBy,
            referredUserId: newUser._id,
            status: 'pending'
        });

        if (!referral) return res.json({ success: false, message: 'No pending referral found' });

        const referrer = await User.findById(referral.referrerId);
        if (!referrer) return res.status(404).json({ success: false, message: 'Referrer not found' });

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
                metadata: {
                    transactionType: 'referral_bonus_received',
                    referredUserId: newUser._id,
                    referredUserName: newUser.fullName,
                    bonusType: 'referrer'
                }
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
                metadata: {
                    transactionType: 'referral_welcome_bonus',
                    referrerId: referrer._id,
                    referrerName: referrer.fullName,
                    bonusType: 'referred'
                }
            }
        ]);

        if (referrer.telegramId) {
            const msg =
`🎉 <b>Referral Bonus Earned!</b>

Dear <b>${escapeHtml(referrer.fullName)}</b>, You've Earned A Referral Bonus!

👤 <b>Referred User:</b> ${escapeHtml(newUser.fullName || 'User')}
💰 <b>Bonus:</b> ₹${bonusAmount}
💼 <b>New Balance:</b> ₹${(referrer.balance + bonusAmount).toFixed(2)}
🕒 <b>Time:</b> ${now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

Keep sharing your referral code to earn more! 🚀`;
            sendTelegramMessage(referrer.telegramId, msg).catch(() => {});
        }

        if (newUser.telegramId) {
            const msg =
`🎁 <b>Welcome Bonus Received!</b>

Dear <b>${escapeHtml(newUser.fullName)}</b>, You've Received A Welcome Bonus!

💰 <b>Bonus:</b> ₹${bonusAmount}
💼 <b>New Balance:</b> ₹${(newUser.balance + bonusAmount).toFixed(2)}
🕒 <b>Time:</b> ${now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}

Thank you for joining Universe Wallet! 🎉`;
            sendTelegramMessage(newUser.telegramId, msg).catch(() => {});
        }

        return res.json({
            success: true,
            message: 'Referral completed and bonuses paid',
            referralId: referral._id,
            bonusAmount,
            referrer: { fullName: referrer.fullName },
            referredUser: { fullName: newUser.fullName }
        });
    } catch (error) {
        console.error('Complete referral error:', error);
        return res.status(500).json({ success: false, message: 'Failed to complete referral' });
    }
});

// ============================================
// GET /settings
// ============================================
router.get('/settings', verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('referralSettings referralCode referralCodeCustom');
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        return res.json({
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
        return res.status(500).json({ success: false, message: 'Failed to fetch settings' });
    }
});

// ============================================
// POST /settings
// ============================================
router.post('/settings', verifyToken, async (req, res) => {
    try {
        const { enabled, bonusAmount, requireFirstTransaction, allowCustomCode } = req.body;
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const updates = {};
        if (typeof enabled === 'boolean') updates['referralSettings.enabled'] = enabled;
        if (typeof bonusAmount === 'number' && bonusAmount >= 0 && bonusAmount <= 1000) updates['referralSettings.bonusAmount'] = bonusAmount;
        if (typeof requireFirstTransaction === 'boolean') updates['referralSettings.requireFirstTransaction'] = requireFirstTransaction;
        if (typeof allowCustomCode === 'boolean') updates['referralSettings.allowCustomCode'] = allowCustomCode;

        if (Object.keys(updates).length === 0) return res.status(400).json({ success: false, message: 'No valid settings to update' });

        const updated = await User.findByIdAndUpdate(user._id, { $set: updates }, { new: true, select: 'referralSettings' });
        return res.json({ success: true, message: 'Settings updated successfully', settings: updated.referralSettings });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to update settings' });
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

        return res.json({ success: true, leaderboard });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to fetch leaderboard' });
    }
});

// ============================================
// EXPORTS
// ============================================
module.exports = router;
module.exports.generateUniqueReferralCode = generateUniqueReferralCode;
module.exports.validateCustomCodeFormat = validateCustomCodeFormat;
module.exports.buildReferralLink = buildReferralLink;
