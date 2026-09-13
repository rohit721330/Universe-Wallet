// FILE: routes/check-status.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const mongoose = require('mongoose');  // ✅ এই লাইনটা যোগ করুন

// ============================================
// GET /api/check-status/:mobile
// Mobile number দিয়ে user status check (No Auth Required)
// ============================================
router.get('/:mobile', async (req, res) => {
    try {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');

        // Mobile normalize
        let mobile = String(req.params.mobile || '').trim();
        mobile = mobile.replace(/\D/g, ''); // শুধু digits

        // +91 বা 91 prefix বাদ দিই
        if (mobile.length === 12 && mobile.startsWith('91')) {
            mobile = mobile.slice(2);
        }

        // Validation
        if (!/^[6-9]\d{9}$/.test(mobile)) {
            return res.status(400).json({
                success: false,
                allowed: false,
                reason: 'invalid_mobile',
                message: 'Invalid mobile number. Must be 10 digits starting with 6-9.'
            });
        }

        // MongoDB connection check
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                success: false,
                allowed: false,
                reason: 'db_unavailable',
                message: 'Database temporarily unavailable. Please try again.'
            });
        }

        // User খুঁজি
        const user = await User.findOne({ mobile: mobile }).select(
            'mobile isBlocked isDeleted isActive deletedAt blockedAt blockReason'
        );

        // User নেই
        if (!user) {
            return res.status(404).json({
                success: false,
                allowed: false,
                reason: 'notfound',
                message: 'No account found with this mobile number.'
            });
        }

        // Blocked check
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

        // Deleted check
        if (user.isDeleted === true || user.deletedAt) {
            return res.status(200).json({
                success: true,
                allowed: false,
                reason: 'deleted',
                message: 'Your account has been deleted. Please contact support.'
            });
        }

        // Deactivated check
        if (user.isActive === false) {
            return res.status(200).json({
                success: true,
                allowed: false,
                reason: 'inactive',
                message: 'Your account has been deactivated. Please contact support.'
            });
        }

        // ✅ সব ঠিক
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

// OPTIONS preflight for CORS
router.options('/:mobile', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    res.status(200).end();
});

module.exports = router;
