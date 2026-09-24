// FILE: routes/referral.js
const router = require('express').Router({ mergeParams: true });
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mongoose = require('mongoose');

const User = require('../models/User');
const Referral = require('../models/Referral');
const Transaction = require('../models/Transaction');

const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;

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
                try { resolve({ success: JSON.parse(responseData).ok }); } catch (e) { resolve({ success: false }); }
            });
        });
        request.on('error', () => resolve({ success: false }));
        request.write(data);
        request.end();
    });
}

// ============================================
// VERIFY TOKEN
// ============================================
const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(200).json({ success: false, message: 'No Token Provided' });

        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);

        if (!user) return res.status(200).json({ success: false, message: 'User Not Found' });
        if (user.isDeleted) return res.status(200).json({ success: false, message: 'Account Deleted' });
        if (user.isBlocked) return res.status(200).json({ success: false, message: 'Account Blocked' });

        req.user = user;
        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') return res.status(200).json({ success: false, message: 'Invalid Token' });
        if (error.name === 'TokenExpiredError') return res.status(200).json({ success: false, message: 'Token Expired' });
        return res.status(200).json({ success: false, message: 'Auth Error' });
    }
};

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
    throw new Error('Unable to generate unique referral code');
}

// ============================================
// BUILD REFERRAL LINK
// ============================================
function buildReferralLink(code) {
    const baseUrl = process.env.APP_BASE_URL || 'https://universe-wallet.vercel.app';
    return `${baseUrl}/?ref=${code}`;
}

// ============================================
// ENSURE USER HAS REFERRAL CODE
// ============================================
async function ensureUserHasReferralCode(user) {
    if (user.referralCode && user.referralCode.length >= 6) {
        return user.referralCode;
    }

    console.log(`⚠️ [ensureUserHasReferralCode] Missing code for ${user.mobile} — generating...`);
    const newCode = await generateUniqueReferralCode();

    try {
        const updated = await User.findByIdAndUpdate(
            user._id,
            { $set: { referralCode: newCode } },
            { new: true, select: 'referralCode' }
        );

        if (updated && updated.referralCode) {
            user.referralCode = updated.referralCode;
            console.log(`✅ [ensureUserHasReferralCode] Generated: ${newCode} for ${user.mobile}`);
            return updated.referralCode;
        }
    } catch (err) {
        console.error('❌ [ensureUserHasReferralCode] Failed:', err.message);
    }

    return null;
}

// ============================================
// GET /referral AND /referral/
// ============================================
router.get(['/', ''], verifyToken, async (req, res) => {
    console.log('🔵 [GET /referral] Handler started for user:', req.user._id);
    console.log('🔵 [GET /referral] Original URL:', req.originalUrl);

    try {
        const user = await User.findById(req.user._id)
            .select('fullName mobile walletId referralCode referralCount referralPendingCount referralEarnings referralSettings profilePicture');

        if (!user) {
            console.log('❌ [GET /referral] User not found');
            return res.status(200).json({ success: false, message: 'User not found' });
        }

        console.log('🔵 [GET /referral] User.referralCode from DB:', user.referralCode || 'MISSING');

        if (!user.referralCode || user.referralCode.length < 6) {
            const generated = await ensureUserHasReferralCode(user);
            if (!generated) {
                return res.status(200).json({ success: false, message: 'Failed to generate referral code. Please retry.' });
            }
            user.referralCode = generated;
        }

        const stats = await Referral.getStatsForUser(user._id);
        const monthCount = await Referral.getMonthlyCount(user._id);

        const responseData = {
            success: true,
            referralCode: user.referralCode,
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
                requireFirstTransaction: user.referralSettings?.requireFirstTransaction !== false
            }
        };

        console.log('✅ [GET /referral] Response referralCode:', responseData.referralCode);
        return res.status(200).json(responseData);
    } catch (error) {
        console.error('❌ [GET /referral] Error:', error.message);
        return res.status(200).json({ success: false, message: 'Failed to fetch referral info' });
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

        const referrals = await Referral.find({ referrerId: user._id })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('referredUserId', 'fullName mobile profilePicture createdAt')
            .lean();

        const total = await Referral.countDocuments({ referrerId: user._id });

        const list = referrals.map(r => {
            const u = r.referredUserId || {};
            return {
                _id: r._id,
                name: u.fullName || 'User',
                mobile: u.mobile ? ('••••' + u.mobile.slice(-4)) : '',
                profilePicture: u.profilePicture || null,
                joinedAt: u.createdAt || r.createdAt,
                status: r.status,
                bonusAmount: r.bonusAmount
            };
        });

        return res.status(200).json({
            success: true,
            referrals: list,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(total / limit),
                totalReferrals: total
            }
        });
    } catch (error) {
        console.error('❌ [GET /list] Error:', error.message);
        return res.status(200).json({ success: false, message: 'Failed to fetch referrals' });
    }
});

// ============================================
// POST /check-code — Public
// ============================================
router.post('/check-code', async (req, res) => {
    try {
        const { code } = req.body;
        if (!code || typeof code !== 'string') {
            return res.status(200).json({ success: false, valid: false, message: 'Code is required' });
        }

        const cleaned = code.trim().toUpperCase();
        const user = await User.findOne({ referralCode: cleaned, isDeleted: false })
            .select('fullName mobile profilePicture referralSettings')
            .lean();

        if (!user) return res.status(200).json({ success: true, valid: false, message: 'Invalid referral code' });
        if (user.referralSettings?.enabled === false) return res.status(200).json({ success: true, valid: false, message: 'Referral program is disabled' });

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
        console.error('❌ [check-code] Error:', error.message);
        return res.status(200).json({ success: false, valid: false, message: 'Server error' });
    }
});

// ============================================
// POST /complete
// ============================================
router.post('/complete', async (req, res) => {
    try {
        const { newUserId } = req.body;
        if (!newUserId) return res.status(200).json({ success: false, message: 'newUserId required' });

        const newUser = await User.findById(newUserId);
        if (!newUser) return res.status(200).json({ success: false, message: 'User not found' });
        if (!newUser.referredBy) return res.status(200).json({ success: false, message: 'User not referred' });

        const referral = await Referral.findOne({
            referrerId: newUser.referredBy,
            referredUserId: newUser._id,
            status: 'pending'
        });

        if (!referral) return res.status(200).json({ success: false, message: 'No pending referral' });

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

        return res.status(200).json({
            success: true,
            message: 'Referral completed',
            bonusAmount
        });
    } catch (error) {
        console.error('❌ [complete] Error:', error.message);
        return res.status(200).json({ success: false, message: 'Failed to complete referral' });
    }
});

module.exports = router;
