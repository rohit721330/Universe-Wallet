// FILE: routes/check-status.js

// ============================================
// GET /api/check-status/:mobile
// Mobile number দিয়ে user status check (No Auth Required)
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

        // ===== User খুঁজি =====
        const user = await User.findOne({ mobile: mobile }).select(
            'mobile isBlocked isDeleted isActive deletedAt blockedAt blockReason'
        );

        // ===== User নেই =====
        if (!user) {
            return res.status(404).json({
                success: false,
                allowed: false,
                reason: 'notfound',
                message: 'No account found with this mobile number.'
            });
        }

        // ============================================
        // ✅ STATUS CHECK — Priority Order
        // ============================================

        // ✅ Priority 1: DELETED (সবার আগে check)
        if (user.isDeleted === true || user.deletedAt) {
            return res.status(200).json({
                success: true,
                allowed: false,
                reason: 'deleted',
                message: 'Your account has been deleted. Please contact support.'
            });
        }

        // ✅ Priority 2: BLOCKED
        if (user.isBlocked === true) {
            return res.status(200).json({
                success: true,
                allowed: false,
                reason: 'blocked',
                message: 'Your account has been blocked by administrator.',
                blockedAt: user.blockedAt || null,
                blockReason: user.blockReason || null
            });
        }

        // ✅ Priority 3: DEACTIVATED
        if (user.isActive === false) {
            return res.status(200).json({
                success: true,
                allowed: false,
                reason: 'inactive',
                message: 'Your account has been deactivated. Please contact support.'
            });
        }

        // ===== All Good =====
        return res.status(200).json({
            success: true,
            allowed: true,
            reason: null,
            message: 'Account is active.'
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
