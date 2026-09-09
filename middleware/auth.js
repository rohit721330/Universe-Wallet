// FILE: middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'k9xjtwX5rP2mQ8vR4sT7wY3uA1fD6gH9jK2lZ5nM';

const auth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        console.log('🔍 Auth Header:', authHeader);

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('❌ No Bearer token found');
            return res.status(401).json({ success: false, message: 'Unauthorized. Token Missing' });
        }

        const token = authHeader.split(' ')[1];
        console.log('🔍 Token received:', token.substring(0, 20) + '...');

        const decoded = jwt.verify(token, JWT_SECRET);
        console.log('🔍 Decoded token:', decoded);

        const user = await User.findById(decoded.userId).select('-password');
        if (!user) {
            console.log('❌ User not found for ID:', decoded.userId);
            return res.status(401).json({ success: false, message: 'User Not Found' });
        }

        if (user.isBlocked) {
            return res.status(403).json({ success: false, message: 'Your Account Is Blocked' });
        }

        req.user = user;
        req.userId = user._id;
        console.log('✅ Auth success for user:', user.fullName, 'ID:', req.userId);
        next();
    } catch (error) {
        console.error('❌ Auth Error:', error.name, error.message);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ success: false, message: 'Invalid Token' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Token Expired' });
        }
        res.status(500).json({ success: false, message: error.message || 'Server Error' });
    }
};

module.exports = { auth };
