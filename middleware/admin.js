// FILE: middleware/admin.js
const Admin = require('../models/Admin');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('FATAL: JWT_SECRET not set in environment!');
    process.exit(1);
}

// ============================================
// MAIN ADMIN AUTHENTICATION (Admin model based)
// ============================================
const adminAuth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ success: false, message: 'No Token Provided. Please Login As Admin.' });
        }
        const decoded = jwt.verify(token, JWT_SECRET);

        if (!decoded.isAdmin || decoded.tokenType !== 'admin_jwt') {
            return res.status(403).json({ success: false, message: 'Admin Access Required. You Do Not Have Permission.' });
        }

        const admin = await Admin.findById(decoded.adminDbId).select('-password -__v');
        if (!admin) {
            return res.status(401).json({ success: false, message: 'Admin Not Found. Please Login Again.' });
        }
        if (admin.isBlocked) {
            return res.status(403).json({ success: false, message: 'Account Blocked.' });
        }
        if (!admin.isActive) {
            return res.status(403).json({ success: false, message: 'Account Inactive.' });
        }

        req.admin = admin;
        req.adminId = admin._id;
        req.user = {
            isAdmin: true,
            adminDbId: admin._id.toString(),
            walletId: admin.walletId,
            fullName: admin.fullName,
            role: admin.role,
            tokenType: 'admin_jwt'
        };
        req.adminDetails = {
            id: admin._id,
            walletId: admin.walletId,
            fullName: admin.fullName,
            mobile: admin.mobile,
            telegramId: admin.telegramId,
            email: admin.email,
            role: admin.role,
            isAdmin: true,
            createdAt: admin.createdAt,
            lastLogin: admin.lastLoginAt,
            lastLoginMethod: admin.lastLoginMethod
        };
        next();
    } catch (error) {
        console.error('Admin Auth Error:', error);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ success: false, message: 'Invalid Token. Please Login Again.' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Token Expired. Please Login Again.' });
        }
        return res.status(500).json({ success: false, message: 'Authentication Failed: ' + error.message });
    }
};

// ============================================
// OPTIONAL ADMIN AUTH
// ============================================
const optionalAdminAuth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (token) {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.isAdmin && decoded.tokenType === 'admin_jwt') {
                const admin = await Admin.findById(decoded.adminDbId).select('-password -__v');
                if (admin && admin.isActive && !admin.isBlocked) {
                    req.admin = admin;
                    req.adminId = admin._id;
                    req.user = {
                        isAdmin: true,
                        adminDbId: admin._id.toString(),
                        walletId: admin.walletId,
                        fullName: admin.fullName,
                        role: admin.role,
                        tokenType: 'admin_jwt'
                    };
                    req.adminDetails = {
                        id: admin._id,
                        walletId: admin.walletId,
                        fullName: admin.fullName,
                        mobile: admin.mobile,
                        telegramId: admin.telegramId,
                        email: admin.email,
                        role: admin.role,
                        isAdmin: true
                    };
                }
            }
        }
        next();
    } catch (error) {
        console.error('Optional Admin Auth Error:', error);
        next();
    }
};

// ============================================
// ADMIN LOGGER
// ============================================
const adminLogger = async (req, res, next) => {
    const originalSend = res.send;
    res.send = function(data) {
        const admin = req.admin;
        const method = req.method;
        const path = req.path;
        const timestamp = new Date().toISOString();
        let responseData;
        try { responseData = JSON.parse(data); } catch (e) { responseData = { status: 'non-json' }; }
        if (admin) {
            console.log(`📋 Admin Activity: Admin: ${admin.fullName || 'Unknown'} (${admin.walletId}) | Path: ${method} ${path} | Time: ${timestamp} | Response: ${responseData.success ? '✅ Success' : '❌ Failed'}`);
        }
        originalSend.call(this, data);
    };
    next();
};

// ============================================
// ADMIN PERMISSION
// ============================================
const adminPermission = (permission) => {
    return async (req, res, next) => {
        try {
            const admin = req.admin;
            if (!admin) {
                return res.status(401).json({ success: false, message: 'Admin Not Authenticated' });
            }
            if (admin.role === 'super_admin') {
                return next();
            }
            return res.status(403).json({ success: false, message: `You Do Not Have Permission To ${permission}` });
        } catch (error) {
            console.error('Permission Error:', error);
            res.status(500).json({ success: false, message: 'Permission Check Failed: ' + error.message });
        }
    };
};

// ============================================
// SUPER ADMIN AUTH
// ============================================
const superAdminAuth = async (req, res, next) => {
    try {
        await adminAuth(req, res, () => {});
        if (!req.admin) {
            return res.status(401).json({ success: false, message: 'Authentication Required' });
        }
        if (req.admin.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Super Admin Access Required' });
        }
        next();
    } catch (error) {
        console.error('Super Admin Auth Error:', error);
        res.status(500).json({ success: false, message: 'Super Admin Authentication Failed: ' + error.message });
    }
};

// ============================================
// ADMIN ACCESS LOG
// ============================================
const adminAccessLog = async (req, res, next) => {
    const startTime = Date.now();
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
        const responseTime = Date.now() - startTime;
        const admin = req.admin;
        const status = res.statusCode;
        console.log(`🔐 Admin Access: IP: ${ip} | User: ${admin ? admin.fullName || 'Unknown' : 'Not Authenticated'} | Path: ${req.method} ${req.path} | Status: ${status} | Time: ${responseTime}ms | User-Agent: ${userAgent}`);
        originalEnd.call(this, chunk, encoding);
    };
    next();
};

// ============================================
// EXPORTS
// ============================================
module.exports = {
    adminAuth,
    optionalAdminAuth,
    adminLogger,
    adminPermission,
    superAdminAuth,
    adminAccessLog
};