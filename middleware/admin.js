// FILE: middleware/admin.js
const User = require('../models/User');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'k9xjtwX5rP2mQ8vR4sT7wY3uA1fD6gH9jK2lZ5nM';

// ============================================
// MAIN ADMIN AUTHENTICATION
// ============================================

const adminAuth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ success: false, message: 'No Token Provided. Please Login As Admin.' });
        }
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-password -pin -__v');
        if (!user) {
            return res.status(401).json({ success: false, message: 'User Not Found. Please Login Again.' });
        }
        if (!user.isAdmin) {
            return res.status(403).json({ success: false, message: 'Admin Access Required. You Do Not Have Permission.' });
        }
        req.admin = user;
        req.adminId = user._id;
        req.adminDetails = {
            id: user._id,
            fullName: user.fullName,
            mobile: user.mobile,
            walletId: user.walletId,
            telegramId: user.telegramId,
            email: user.email,
            isAdmin: user.isAdmin,
            balance: user.balance || 0,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin,
            permissions: user.permissions || ['all']
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
            const user = await User.findById(decoded.userId).select('-password -pin -__v');
            if (user && user.isAdmin) {
                req.admin = user;
                req.adminId = user._id;
                req.adminDetails = {
                    id: user._id,
                    fullName: user.fullName,
                    mobile: user.mobile,
                    walletId: user.walletId,
                    telegramId: user.telegramId,
                    email: user.email,
                    isAdmin: user.isAdmin,
                    balance: user.balance || 0,
                    createdAt: user.createdAt,
                    lastLogin: user.lastLogin,
                    permissions: user.permissions || ['all']
                };
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
            console.log(`📋 Admin Activity: Admin: ${admin.fullName || 'Unknown'} (${admin.mobile}) | Path: ${method} ${path} | Time: ${timestamp} | Response: ${responseData.success ? '✅ Success' : '❌ Failed'}`);
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
            const permissions = admin.permissions || ['all'];
            const hasPermission = permissions.includes('all') || permissions.includes(permission);
            if (!hasPermission) {
                return res.status(403).json({ success: false, message: `You Do Not Have Permission To ${permission}` });
            }
            next();
        } catch (error) {
            console.error('Permission Error:', error);
            res.status(500).json({ success: false, message: 'Permission Check Failed: ' + error.message });
        }
    };
};

// ============================================
// SAVE ADMIN SESSION
// ============================================

const saveAdminSession = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (token) {
            const decoded = jwt.verify(token, JWT_SECRET);
            const admin = await User.findById(decoded.userId);
            if (admin && admin.isAdmin) {
                admin.lastLogin = new Date();
                admin.lastActivity = new Date();
                admin.sessionToken = token;
                await admin.save();
                if (req.session) {
                    req.session.adminId = admin._id;
                    req.session.adminData = {
                        id: admin._id,
                        fullName: admin.fullName,
                        mobile: admin.mobile,
                        isAdmin: admin.isAdmin
                    };
                }
            }
        }
        next();
    } catch (error) {
        console.error('Session Save Error:', error);
        next();
    }
};

// ============================================
// ADMIN ACTIVITY TRACKER
// ============================================

const adminActivityTracker = async (req, res, next) => {
    try {
        const originalEnd = res.end;
        const startTime = Date.now();
        let isLogged = false;
        res.end = function(chunk, encoding) {
            if (!isLogged) {
                const responseTime = Date.now() - startTime;
                const admin = req.admin;
                const statusCode = res.statusCode;
                if (admin && statusCode >= 200 && statusCode < 300) {
                    console.log(`✅ Admin Activity Logged: ${admin.fullName} - ${req.method} ${req.path} (${responseTime}ms)`);
                }
                isLogged = true;
            }
            originalEnd.call(this, chunk, encoding);
        };
        next();
    } catch (error) {
        console.error('Activity Tracker Error:', error);
        next();
    }
};

// ============================================
// ADMIN RATE LIMITER
// ============================================

const adminRateLimiter = (maxRequests = 100, windowMs = 60000) => {
    const requests = new Map();
    setInterval(() => {
        const now = Date.now();
        for (const [key, timestamps] of requests.entries()) {
            const filtered = timestamps.filter(time => time > now - windowMs);
            if (filtered.length === 0) { requests.delete(key); } else { requests.set(key, filtered); }
        }
    }, windowMs);
    return (req, res, next) => {
        const adminId = req.admin?._id?.toString() || req.ip || 'unknown';
        const key = `admin_${adminId}`;
        const now = Date.now();
        const windowStart = now - windowMs;
        let adminRequests = requests.get(key) || [];
        adminRequests = adminRequests.filter(time => time > windowStart);
        if (adminRequests.length >= maxRequests) {
            return res.status(429).json({ success: false, message: `Too Many Requests. Please Wait ${Math.ceil(windowMs / 60000)} Minutes.` });
        }
        adminRequests.push(now);
        requests.set(key, adminRequests);
        next();
    };
};

// ============================================
// GET ADMIN DETAILS
// ============================================

const getAdminDetails = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ success: false, message: 'No Token Provided' });
        }
        const decoded = jwt.verify(token, JWT_SECRET);
        const admin = await User.findById(decoded.userId).select('-password -pin -__v');
        if (!admin) {
            return res.status(404).json({ success: false, message: 'Admin Not Found' });
        }
        if (!admin.isAdmin) {
            return res.status(403).json({ success: false, message: 'Not An Admin User' });
        }
        req.admin = admin;
        req.adminId = admin._id;
        req.adminDetails = {
            id: admin._id,
            fullName: admin.fullName,
            mobile: admin.mobile,
            walletId: admin.walletId,
            telegramId: admin.telegramId,
            email: admin.email,
            isAdmin: admin.isAdmin,
            balance: admin.balance || 0,
            createdAt: admin.createdAt,
            lastLogin: admin.lastLogin,
            permissions: admin.permissions || ['all'],
            profilePicture: admin.profilePicture || null,
            status: admin.status || 'active'
        };
        next();
    } catch (error) {
        console.error('Get Admin Details Error:', error);
        res.status(500).json({ success: false, message: 'Failed To Fetch Admin Details: ' + error.message });
    }
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
        if (req.admin.role !== 'super_admin' && !req.admin.isSuperAdmin) {
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
    saveAdminSession,
    adminActivityTracker,
    adminRateLimiter,
    getAdminDetails,
    superAdminAuth,
    adminAccessLog
};
