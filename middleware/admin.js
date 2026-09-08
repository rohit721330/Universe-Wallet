// FILE: middleware/admin.js
const User = require('../models/User');
const jwt = require('jsonwebtoken');

/**
 * Admin Authentication Middleware
 * Verifies if the user is an admin
 */
const adminAuth = async (req, res, next) => {
    try {
        // Get token from header
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'No Token Provided. Please Login As Admin.'
            });
        }
        
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-password -pin -__v');
        
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User Not Found. Please Login Again.'
            });
        }
        
        // Check if user is admin
        if (!user.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Admin Access Required. You Do Not Have Permission.'
            });
        }
        
        // Attach admin user to request
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
            return res.status(401).json({
                success: false,
                message: 'Invalid Token. Please Login Again.'
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token Expired. Please Login Again.'
            });
        }
        
        return res.status(500).json({
            success: false,
            message: 'Authentication Failed: ' + error.message
        });
    }
};

/**
 * Optional Admin Auth (Doesn't block if no token)
 */
const optionalAdminAuth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
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
        // Don't block the request
        console.error('Optional Admin Auth Error:', error);
        next();
    }
};

/**
 * Admin Logger Middleware
 * Logs all admin activities
 */
const adminLogger = async (req, res, next) => {
    // Store original send function
    const originalSend = res.send;
    
    // Override send function to log response
    res.send = function(data) {
        // Get admin from request
        const admin = req.admin;
        const method = req.method;
        const path = req.path;
        const timestamp = new Date().toISOString();
        
        // Parse response data
        let responseData;
        try {
            responseData = JSON.parse(data);
        } catch (e) {
            responseData = { status: 'non-json' };
        }
        
        // Log admin activity
        if (admin) {
            console.log(`📋 Admin Activity:
            👤 Admin: ${admin.fullName || 'Unknown'} (${admin.mobile})
            📍 Path: ${method} ${path}
            ⏰ Time: ${timestamp}
            📦 Response: ${responseData.success ? '✅ Success' : '❌ Failed'}
            `);
        }
        
        // Call original send
        originalSend.call(this, data);
    };
    
    next();
};

/**
 * Admin Permission Middleware
 * Checks if admin has specific permissions
 */
const adminPermission = (permission) => {
    return async (req, res, next) => {
        try {
            const admin = req.admin;
            
            if (!admin) {
                return res.status(401).json({
                    success: false,
                    message: 'Admin Not Authenticated'
                });
            }
            
            // Check if admin has specific permission
            const permissions = admin.permissions || ['all'];
            const hasPermission = permissions.includes('all') || permissions.includes(permission);
            
            if (!hasPermission) {
                return res.status(403).json({
                    success: false,
                    message: `You Do Not Have Permission To ${permission}`
                });
            }
            
            next();
        } catch (error) {
            console.error('Permission Error:', error);
            res.status(500).json({
                success: false,
                message: 'Permission Check Failed: ' + error.message
            });
        }
    };
};

/**
 * Save Admin Session Middleware
 * Saves admin session details
 */
const saveAdminSession = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const admin = await User.findById(decoded.userId);
            
            if (admin && admin.isAdmin) {
                // Update last login time
                admin.lastLogin = new Date();
                admin.lastActivity = new Date();
                admin.sessionToken = token;
                await admin.save();
                
                // Store admin in session (if using session)
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
        // Don't block the request if session save fails
        console.error('Session Save Error:', error);
        next();
    }
};

/**
 * Admin Activity Tracker Middleware
 * Tracks admin actions for audit
 */
const adminActivityTracker = async (req, res, next) => {
    try {
        // Store original end function
        const originalEnd = res.end;
        const startTime = Date.now();
        let isLogged = false;
        
        // Override end function
        res.end = function(chunk, encoding) {
            if (!isLogged) {
                const responseTime = Date.now() - startTime;
                const admin = req.admin;
                const statusCode = res.statusCode;
                
                // Log admin activity
                if (admin && statusCode >= 200 && statusCode < 300) {
                    const activityLog = {
                        adminId: admin._id,
                        adminName: admin.fullName,
                        adminMobile: admin.mobile,
                        method: req.method,
                        path: req.path,
                        query: req.query,
                        body: req.body,
                        statusCode: statusCode,
                        responseTime: responseTime + 'ms',
                        timestamp: new Date()
                    };
                    
                    // You can save this to a separate collection for audit
                    console.log(`✅ Admin Activity Logged: ${admin.fullName} - ${req.method} ${req.path} (${responseTime}ms)`);
                    
                    // Optional: Save to database
                    // await AdminLog.create(activityLog);
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

/**
 * Admin Rate Limiter Middleware
 * Limits admin API requests
 */
const adminRateLimiter = (maxRequests = 100, windowMs = 60000) => {
    const requests = new Map();
    
    // Cleanup old entries periodically
    setInterval(() => {
        const now = Date.now();
        for (const [key, timestamps] of requests.entries()) {
            const filtered = timestamps.filter(time => time > now - windowMs);
            if (filtered.length === 0) {
                requests.delete(key);
            } else {
                requests.set(key, filtered);
            }
        }
    }, windowMs);
    
    return (req, res, next) => {
        const adminId = req.admin?._id?.toString() || req.ip || 'unknown';
        const key = `admin_${adminId}`;
        const now = Date.now();
        const windowStart = now - windowMs;
        
        // Get existing requests
        let adminRequests = requests.get(key) || [];
        
        // Filter requests within window
        adminRequests = adminRequests.filter(time => time > windowStart);
        
        // Check limit
        if (adminRequests.length >= maxRequests) {
            return res.status(429).json({
                success: false,
                message: `Too Many Requests. Please Wait ${Math.ceil(windowMs / 60000)} Minutes.`
            });
        }
        
        // Add current request
        adminRequests.push(now);
        requests.set(key, adminRequests);
        
        next();
    };
};

/**
 * Get Admin Details Middleware
 * Fetches and attaches admin details
 */
const getAdminDetails = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'No Token Provided'
            });
        }
        
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const admin = await User.findById(decoded.userId)
            .select('-password -pin -__v');
        
        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Admin Not Found'
            });
        }
        
        if (!admin.isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Not An Admin User'
            });
        }
        
        // Attach admin details
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
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch Admin Details: ' + error.message
        });
    }
};

/**
 * Super Admin Check Middleware
 * Only allows super admins
 */
const superAdminAuth = async (req, res, next) => {
    try {
        // First run admin auth
        await adminAuth(req, res, () => {});
        
        if (!req.admin) {
            return res.status(401).json({
                success: false,
                message: 'Authentication Required'
            });
        }
        
        // Check if super admin
        if (req.admin.role !== 'super_admin' && !req.admin.isSuperAdmin) {
            return res.status(403).json({
                success: false,
                message: 'Super Admin Access Required'
            });
        }
        
        next();
    } catch (error) {
        console.error('Super Admin Auth Error:', error);
        res.status(500).json({
            success: false,
            message: 'Super Admin Authentication Failed: ' + error.message
        });
    }
};

/**
 * Admin Access Log Middleware
 * Logs all admin access attempts
 */
const adminAccessLog = async (req, res, next) => {
    const startTime = Date.now();
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';
    
    // Store original end
    const originalEnd = res.end;
    
    res.end = function(chunk, encoding) {
        const responseTime = Date.now() - startTime;
        const admin = req.admin;
        const status = res.statusCode;
        
        // Log access attempt
        console.log(`🔐 Admin Access:
        📍 IP: ${ip}
        👤 User: ${admin ? admin.fullName || 'Unknown' : 'Not Authenticated'}
        🔗 Path: ${req.method} ${req.path}
        📊 Status: ${status}
        ⏱️ Time: ${responseTime}ms
        📱 User-Agent: ${userAgent}
        `);
        
        // Optional: Save to database
        // await AdminAccessLog.create({
        //     adminId: admin?._id,
        //     ip: ip,
        //     path: req.path,
        //     method: req.method,
        //     status: status,
        //     responseTime: responseTime,
        //     userAgent: userAgent,
        //     timestamp: new Date()
        // });
        
        originalEnd.call(this, chunk, encoding);
    };
    
    next();
};

// Export all middlewares
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
