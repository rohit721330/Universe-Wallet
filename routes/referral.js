// FILE: routes/referral.js
const router = require('express').Router({ mergeParams: true });
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const Referral = require('../models/Referral');
const Admin = require('../models/Admin');

const JWT_SECRET = process.env.JWT_SECRET;

// ============================================
// GET GLOBAL REFERRAL SETTINGS
// ============================================
async function getGlobalReferralSettings() {
    try {
        const admin = await Admin.findOne({
            role: 'super_admin',
            isActive: true,
            isBlocked: false
        }).select('referralSettings').lean();

        if (admin && admin.referralSettings) {
            const s = admin.referralSettings;
            return {
                enabled: s.enabled !== false,
                bonusAmount: s.bonusAmount || 10,
                minDepositAmount: s.minDepositAmount || 50,
                maxReferralsPerUser: s.maxReferralsPerUser || 100
            };
        }
    } catch (err) {
        console.error('getGlobalReferralSettings error:', err.message);
    }
    return { enabled: true, bonusAmount: 10, minDepositAmount: 50, maxReferralsPerUser: 100 };
}

// ============================================
// VERIFY TOKEN
// ============================================
const verifyToken = async (req, res, next) => {
    try {
        let token = null;
        const authHeader = req.headers.authorization || req.headers.Authorization;
        if (authHeader) {
            const parts = authHeader.split(' ');
            token = parts.length === 2 ? parts[1] : parts[0];
        }
        if (!token && req.headers['x-auth-token']) token = req.headers['x-auth-token'];
        if (!token && req.query && req.query.token) token = req.query.token;

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
// HELPERS
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
    throw new Error('Unable to generate unique code');
}

function buildReferralLink(code) {
    const baseUrl = process.env.APP_BASE_URL || 'https://universe-wallet.vercel.app';
    return `${baseUrl}/?ref=${code}`;
}

async function ensureUserHasReferralCode(user) {
    if (user.referralCode && user.referralCode.length >= 6) return user.referralCode;
    const newCode = await generateUniqueReferralCode();
    try {
        const updated = await User.findByIdAndUpdate(
            user._id,
            { $set: { referralCode: newCode } },
            { new: true, select: 'referralCode' }
        );
        if (updated && updated.referralCode) {
            user.referralCode = updated.referralCode;
            return updated.referralCode;
        }
    } catch (err) {
        console.error('ensureUserHasReferralCode failed:', err.message);
    }
    return null;
}

// ============================================
// GET / — Main referral info
// ============================================
router.get(['/', ''], verifyToken, async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .select('fullName mobile walletId referralCode referralCount referralPendingCount referralEarnings profilePicture');

        if (!user) return res.status(200).json({ success: false, message: 'User not found' });

        const settings = await getGlobalReferralSettings();

        if (settings.enabled) {
            if (!user.referralCode || user.referralCode.length < 6) {
                const generated = await ensureUserHasReferralCode(user);
                if (generated) user.referralCode = generated;
            }
        }

        const stats = await Referral.getStatsForUser(user._id);
        const monthCount = await Referral.getMonthlyCount(user._id);

        return res.status(200).json({
            success: true,
            referralCode: user.referralCode || null,
            referralLink: user.referralCode ? buildReferralLink(user.referralCode) : null,
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
                enabled: settings.enabled,
                bonusAmount: settings.bonusAmount,
                minDepositAmount: settings.minDepositAmount,
                maxReferralsPerUser: settings.maxReferralsPerUser
            }
        });
    } catch (error) {
        console.error('GET /referral error:', error.message);
        return res.status(200).json({ success: false, message: 'Failed to fetch referral info' });
    }
});

// ============================================
// GET /list — FIXED: use global bonus amount
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

        // ✅ Get current global settings
        const settings = await getGlobalReferralSettings();

        const list = referrals.map(r => {
            const u = r.referredUserId || {};
            return {
                _id: r._id,
                name: u.fullName || 'User',
                mobile: u.mobile ? ('••••' + u.mobile.slice(-4)) : '',
                profilePicture: u.profilePicture || null,
                joinedAt: u.createdAt || r.createdAt,
                status: r.status,
                // ✅ Use current global bonus amount (not the old saved value)
                bonusAmount: settings.bonusAmount,
                minDepositRequired: settings.minDepositAmount || r.minDepositRequired || 50,
                depositCompleted: r.depositCompleted,
                depositAmount: r.depositAmount
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
        console.error('GET /list error:', error.message);
        return res.status(200).json({ success: false, message: 'Failed to fetch referrals' });
    }
});

// ============================================
// POST /check-code — Public
// ============================================
router.post('/check-code', async (req, res) => {
    try {
        const settings = await getGlobalReferralSettings();
        if (!settings.enabled) {
            return res.status(200).json({
                success: true,
                valid: false,
                message: 'Referral program is currently disabled'
            });
        }

        const { code } = req.body;
        if (!code || typeof code !== 'string') {
            return res.status(200).json({ success: false, valid: false, message: 'Code is required' });
        }

        const cleaned = code.trim().toUpperCase();
        const user = await User.findOne({ referralCode: cleaned, isDeleted: false })
            .select('fullName mobile profilePicture')
            .lean();

        if (!user) return res.status(200).json({ success: true, valid: false, message: 'Invalid referral code' });

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
            },
            minDepositAmount: settings.minDepositAmount,
            bonusAmount: settings.bonusAmount
        });
    } catch (error) {
        console.error('check-code error:', error.message);
        return res.status(200).json({ success: false, valid: false, message: 'Server error' });
    }
});

module.exports = router;
