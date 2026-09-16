// FILE: routes/check-status.js

// ============================================
// GET /api/check-status/:mobile
// Mobile number দিয়ে user status check (No Auth Required)
// ✅ FIX: active user-কে priority দেওয়া হয়
// ✅ FIX: deleted/blocked user ignore করা হয় — যদি active user থাকে
// ============================================

const express = require('express');
const router = express.Router();
const User = require('../models/User');

router.get('/:mobile', async (req, res) => {
    try {
        // ===== Mobile normalize =====
        let mobile = String(req.params.mobile || '').trim();
        mobile = mobile.replace(/\D/g, ''); // শুধু digits

        // India: +91 বা 91 prefix বাদ দিই
        if (mobile.length === 12 && mobile.startsWith('91')) {
            mobile = mobile.slice(2);
        }

        // ===== Validation =====
        if (!/^[6-9]\d{9}$/.test(mobile)) {
            return res.status(400).json({
                success: false,
                allowed: false,
                reason: 'invalid_mobile',
                message: 'Invalid mobile number format. Must be 10 digits starting with 6-9.'
            });
        }

        // =========================================================
        // ✅ FIX: Step 1 — আগে ACTIVE user খুঁজি
        // (deleted/blocked user ignore করে)
        // =========================================================
        const activeUser = await User.findOne({
            mobile: mobile,
            isDeleted: false,
            isActive: true
        }).select('mobile isBlocked isDeleted isActive');

        if (activeUser) {
            // Active user পাওয়া গেছে — status check
            if (activeUser.isBlocked === true) {
                return res.status(200).json({
                    success: true,
                    allowed: false,
                    reason: 'blocked',
                    message: 'Your account has been blocked by administrator.',
                    canReregister: false
                });
            }

            // সব ঠিক আছে
            return res.status(200).json({
                success: true,
                allowed: true,
                reason: null,
                message: 'Account is active.',
                canReregister: false
            });
        }

        // =========================================================
        // ✅ FIX: Step 2 — Active user নেই, এখন deleted/blocked check করি
        // (এখানে সবচেয়ে recent user খুঁজি)
        // =========================================================
        const anyUser = await User.findOne({ mobile: mobile })
            .sort({ createdAt: -1 })  // ⭐ সবচেয়ে recent user আগে
            .select('mobile isBlocked isDeleted isActive deletedAt blockedAt blockReason');

        if (!anyUser) {
            return res.status(404).json({
                success: false,
                allowed: false,
                reason: 'notfound',
                message: 'No account found with this mobile number.'
            });
        }

        // ✅ Priority 1: DELETED
        if (anyUser.isDeleted === true || anyUser.deletedAt) {
            return res.status(200).json({
                success: true,
                allowed: false,
                reason: 'deleted',
                message: 'Your account has been deleted. You can register again with the same details.',
                canReregister: true,
                deletedAt: anyUser.deletedAt || null
            });
        }

        // ✅ Priority 2: BLOCKED
        if (anyUser.isBlocked === true) {
            return res.status(200).json({
                success: true,
                allowed: false,
                reason: 'blocked',
                message: 'Your account has been blocked by administrator.',
                canReregister: false,
                blockedAt: anyUser.blockedAt || null,
                blockReason: anyUser.blockReason || null
            });
        }

        // ✅ Priority 3: DEACTIVATED
        if (anyUser.isActive === false) {
            return res.status(200).json({
                success: true,
                allowed: false,
                reason: 'inactive',
                message: 'Your account has been deactivated. Please contact support.',
                canReregister: false
            });
        }

        // Fallback (shouldn't reach here)
        return res.status(200).json({
            success: true,
            allowed: true,
            reason: null,
            message: 'Account status unknown.',
            canReregister: false
        });

    } catch (error) {
        console.error('❌ Check status error:', error.message);
        return res.status(500).json({
            success: false,
            allowed: false,
            reason: 'server_error',
            message: 'Server error. Please try again later.'
        });
    }
});

module.exports = router;
