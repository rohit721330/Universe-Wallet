// FILE: middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'k9xjtwX5rP2mQ8vR4sT7wY3uA1fD6gH9jK2lZ5nM';

const auth = async (req, res, next) => {
    try {
        // ============================================
        // STEP 1: Verify Authorization Header
        // ============================================
        const authHeader = req.headers.authorization;
        console.log('🔍 Auth Header:', authHeader);

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('❌ No Bearer token found');
            return res.status(401).json({
                success: false,
                message: 'Unauthorized. Token Missing'
            });
        }

        // ============================================
        // STEP 2: Extract Token
        // ============================================
        const token = authHeader.split(' ')[1];
        console.log('🔍 Token received:', token.substring(0, 20) + '...');

        // ============================================
        // STEP 3: Verify JWT
        // ============================================
        const decoded = jwt.verify(token, JWT_SECRET);
        console.log('🔍 Decoded token:', decoded);

        // ============================================
        // STEP 4: Find User (Check if deleted)
        // ============================================
        const user = await User.findById(decoded.userId).select('-password');

        if (!user) {
            console.log('❌ User not found for ID:', decoded.userId);
            return res.status(404).json({
                success: false,
                userNotFound: true,
                message: 'User Account Not Found or Deleted'
            });
        }

        // ============================================
        // STEP 5: Check if Account is Blocked
        // ============================================
        if (user.isBlocked) {
            console.log('🚫 Blocked user tried to access:', user._id);
            return res.status(403).json({
                success: false,
                accountBlocked: true,
                message: 'Your Account Has Been Blocked. Please Contact Support.'
            });
        }

        // ============================================
        // STEP 6: Check if Account is Deleted
        // ============================================
        if (user.isDeleted === true || user.deletedAt) {
            console.log('🗑️ Deleted user tried to access:', user._id);
            return res.status(403).json({
                success: false,
                accountDeleted: true,
                message: 'Your Account Has Been Deleted. Please Contact Support.'
            });
        }

        // ============================================
        // STEP 7: Check if Account is Deactivated
        // ============================================
        if (user.isActive === false) {
            console.log('⚠️ Deactivated user tried to access:', user._id);
            return res.status(403).json({
                success: false,
                accountDeactivated: true,
                message: 'Your Account Has Been Deactivated. Please Contact Support.'
            });
        }

        // ============================================
        // STEP 8: Attach User to Request
        // ============================================
        req.user = user;
        req.userId = user._id;
        console.log('✅ Auth success for user:', user.fullName, 'ID:', req.userId);

        next();

    } catch (error) {
        console.error('❌ Auth Error:', error.name, error.message);

        // ============================================
        // STEP 9: Handle JWT Errors
        // ============================================
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid Token. Please Login Again.'
            });
        }

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token Has Expired. Please Login Again.'
            });
        }

        // ============================================
        // STEP 10: Handle Generic Errors
        // ============================================
        res.status(500).json({
            success: false,
            message: error.message || 'Server Error'
        });
    }
};

module.exports = { auth };
