// FILE: routes/admin.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Deposit = require('../models/Deposit');
const Withdrawal = require('../models/Withdraw');
const Lifafa = require('../models/Lifafa');
const Gift = require('../models/GiftCode');
const Admin = require('../models/Admin');
const Referral = require('../models/Referral');
require('dotenv').config();

// ============================================
// ENVIRONMENT VARIABLES
// ============================================
const ADMIN_PATTERN = process.env.ADMIN_PATTERN;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID;
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error('FATAL: JWT_SECRET not set in environment!');
    process.exit(1);
}

// ============================================
// LOGGER HELPERS
// ============================================
function logRequest(req, tag) {
    var adminInfo = req.user ? (req.user.walletId || req.user.adminDbId || 'unknown') : 'unauth';
    console.log(`[${new Date().toISOString()}] [${tag}] ${req.method} ${req.originalUrl} | Admin: ${adminInfo} | IP: ${req.ip || 'N/A'}`);
}

function logSuccess(tag, message, data) {
    console.log(`[${new Date().toISOString()}] [${tag}] SUCCESS: ${message}`, data ? JSON.stringify(data) : '');
}

function logError(tag, message, error) {
    console.error(`[${new Date().toISOString()}] [${tag}] ERROR: ${message}`);
    if (error) {
        console.error(`[${tag}] Stack:`, error.stack || error.message || error);
    }
}

function logWarn(tag, message, data) {
    console.warn(`[${new Date().toISOString()}] [${tag}] WARN: ${message}`, data ? JSON.stringify(data) : '');
}

function logInfo(tag, message, data) {
    console.log(`[${new Date().toISOString()}] [${tag}] INFO: ${message}`, data ? JSON.stringify(data) : '');
}

// ============================================
// HELPERS
// ============================================
function getCurrentDateTime() {
    const now = new Date();
    return now.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: true
    });
}

async function sendTelegramMessage(chatId, message) {
    return new Promise((resolve) => {
        const https = require('https');
        if (!BOT_TOKEN) {
            logWarn('TELEGRAM', 'BOT_TOKEN not configured');
            resolve({ success: false });
            return;
        }
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const data = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' });
        const request = https.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                try { resolve({ success: JSON.parse(responseData).ok }); }
                catch (e) { resolve({ success: false }); }
            });
        });
        request.on('error', () => resolve({ success: false }));
        request.write(data);
        request.end();
    });
}

async function notifyAdmin(message) {
    try {
        if (!ADMIN_TG_ID) {
            logWarn('NOTIFY', 'ADMIN_TG_ID not configured');
            return;
        }
        const result = await sendTelegramMessage(ADMIN_TG_ID, message);
        if (result.success) {
            logInfo('NOTIFY', 'Admin notification sent');
        } else {
            logWarn('NOTIFY', 'Admin notification failed');
        }
    } catch (error) {
        logError('NOTIFY', 'Admin notification error', error);
    }
}

// ============================================
// VERIFY ADMIN TOKEN MIDDLEWARE
// ============================================
async function verifyAdminToken(req, res, next) {
    const tag = 'AUTH';
    logRequest(req, tag);
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            logWarn(tag, 'No token provided', { url: req.originalUrl });
            return res.status(401).json({ success: false, message: 'No Token Provided.' });
        }

        const token = authHeader.split(' ')[1];

        try {
            const decoded = jwt.verify(token, JWT_SECRET);

            if (!decoded.isAdmin || decoded.tokenType !== 'admin_jwt') {
                logWarn(tag, 'Access denied - not admin token', { walletId: decoded.walletId });
                return res.status(403).json({ success: false, message: 'Access Denied.' });
            }

            req.user = {
                isAdmin: true,
                adminDbId: decoded.adminDbId,
                walletId: decoded.walletId,
                fullName: decoded.fullName,
                role: decoded.role,
                tokenType: 'admin_jwt'
            };
            logSuccess(tag, 'Token verified', { walletId: decoded.walletId });
            return next();
        } catch (jwtError) {
            if (jwtError.name === 'TokenExpiredError') {
                logWarn(tag, 'Token expired', { error: jwtError.message });
                return res.status(401).json({ success: false, message: 'Token Has Expired.' });
            }
            logWarn(tag, 'Invalid token', { error: jwtError.message });
            return res.status(401).json({ success: false, message: 'Invalid Token.' });
        }
    } catch (error) {
        logError(tag, 'Token verification error', error);
        return res.status(500).json({ success: false, message: 'Auth Error.' });
    }
}

// ============================================
// ADMIN LOGIN - STEP 1: PATTERN
// ============================================
router.post('/login-step1', async (req, res) => {
    const tag = 'LOGIN_STEP1';
    logRequest(req, tag);

    try {
        const { pattern } = req.body;

        if (!pattern) {
            logWarn(tag, 'Pattern missing');
            return res.status(400).json({ success: false, message: 'Pattern required.' });
        }
        if (!/^[0-9]{2,9}$/.test(pattern)) {
            logWarn(tag, 'Invalid pattern format', { pattern });
            return res.status(400).json({ success: false, message: 'Pattern must be 2-9 digits.' });
        }
        if (!ADMIN_PATTERN) {
            logError(tag, 'ADMIN_PATTERN not configured');
            return res.status(500).json({ success: false, message: 'Server misconfiguration.' });
        }

        if (pattern !== ADMIN_PATTERN) {
            logWarn(tag, 'Wrong pattern attempt', { ip: req.ip });
            await notifyAdmin(
`⚠️ <b>Wrong Pattern Attempt</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`🌐 <b>IP:</b> ${req.ip}\n\n` +
`🔒 Security Alert!`
            );
            return res.status(401).json({ success: false, message: 'Incorrect pattern.' });
        }

        const tempToken = jwt.sign(
            { step: 'credentials_pending', patternVerified: true },
            JWT_SECRET,
            { expiresIn: '5m' }
        );

        logSuccess(tag, 'Pattern verified, temp token issued');
        res.json({ success: true, message: 'Pattern verified.', tempToken });
    } catch (error) {
        logError(tag, 'Login step1 error', error);
        res.status(500).json({ success: false, message: 'Login failed.' });
    }
});

// ============================================
// SHARED: Admin credential verification + token issue
// ============================================
async function _processAdminCredentialLogin(req, res, tag, lookupQuery, lookupLabel) {
    logRequest(req, tag);
    try {
        const { tempToken, password } = req.body;

        if (!tempToken || !password) {
            logWarn(tag, 'Missing fields');
            return res.status(400).json({ success: false, message: 'Required fields missing.' });
        }

        // 1. Verify Step-1 temp token
        let decoded;
        try {
            decoded = jwt.verify(tempToken, JWT_SECRET);
        } catch (err) {
            logWarn(tag, 'Temp token invalid', { error: err.message });
            return res.status(401).json({ success: false, message: 'Session expired.' });
        }
        if (decoded.step !== 'credentials_pending' || !decoded.patternVerified) {
            logWarn(tag, 'Invalid session state');
            return res.status(401).json({ success: false, message: 'Invalid session.' });
        }

        // 2. Find admin by the specific identifier
        if (!lookupQuery || Object.keys(lookupQuery).length === 0) {
            logWarn(tag, 'Missing identifier in request body');
            return res.status(400).json({ success: false, message: `${lookupLabel} required.` });
        }

        const admin = await Admin.findOne(lookupQuery);
        if (!admin) {
            logWarn(tag, `Admin not found by ${lookupLabel}`, lookupQuery);
            await notifyAdmin(
`❌ <b>Admin Login Failed</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`📝 <b>Reason:</b> ${lookupLabel} not found\n` +
`🆔 <b>${lookupLabel}:</b> ${JSON.stringify(lookupQuery)}\n\n` +
`🔒 Security Alert!`
            );
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        if (admin.isBlocked) {
            logWarn(tag, 'Admin blocked', { walletId: admin.walletId });
            return res.status(403).json({ success: false, message: 'Account blocked.' });
        }
        if (!admin.isActive) {
            logWarn(tag, 'Admin inactive', { walletId: admin.walletId });
            return res.status(403).json({ success: false, message: 'Account inactive.' });
        }

        // 3. Compare password
        const isMatch = await admin.comparePassword(password);
        if (!isMatch) {
            logWarn(tag, 'Wrong password', { walletId: admin.walletId, via: lookupLabel });
            await notifyAdmin(
`❌ <b>Admin Login Failed</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`📝 <b>Reason:</b> Wrong password\n` +
`🎯 <b>Via:</b> ${lookupLabel}\n` +
`💼 <b>Wallet ID:</b> ${admin.walletId}\n\n` +
`🔒 Security Alert!`
            );
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

        // 4. Update login meta + issue JWT
        admin.lastLoginAt = new Date();
        admin.lastLoginIP = req.ip;
        admin.lastLoginMethod = lookupLabel;
        await admin.save();

        const adminToken = jwt.sign(
            {
                adminDbId: admin._id.toString(),
                walletId: admin.walletId,
                fullName: admin.fullName,
                role: admin.role,
                isAdmin: true,
                tokenType: 'admin_jwt'
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        logSuccess(tag, 'Admin logged in', { walletId: admin.walletId, via: lookupLabel });

        await notifyAdmin(
`✅ <b>Admin Login Successful</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`👤 <b>Name:</b> ${admin.fullName}\n` +
`💼 <b>Wallet ID:</b> ${admin.walletId}\n` +
`📱 <b>Mobile:</b> ${admin.mobile}\n` +
`🎯 <b>Via:</b> ${lookupLabel}\n` +
`🎭 <b>Role:</b> ${admin.role}\n\n` +
`🎉 Welcome back!`
        );

        return res.json({
            success: true,
            message: 'Login successful.',
            token: adminToken,
            isAdmin: true,
            admin: {
                _id: admin._id,
                walletId: admin.walletId,
                fullName: admin.fullName,
                mobile: admin.mobile,
                email: admin.email,
                telegramId: admin.telegramId,
                role: admin.role,
                lastLoginAt: admin.lastLoginAt,
                lastLoginMethod: admin.lastLoginMethod
            }
        });
    } catch (error) {
        logError(tag, 'Login error', error);
        return res.status(500).json({ success: false, message: 'Login failed.' });
    }
}

// ============================================
// STEP 2 — MOBILE LOGIN
// ============================================
router.post('/login-step2', async (req, res) => {
    const { mobile } = req.body || {};
    if (!mobile || !/^[0-9]{10}$/.test(mobile)) {
        return res.status(400).json({ success: false, message: 'Valid 10-digit mobile required.' });
    }
    return _processAdminCredentialLogin(
        req, res, 'LOGIN_STEP2_MOBILE',
        { mobile: mobile.trim() },
        'Mobile'
    );
});

// ============================================
// STEP 3 — TELEGRAM LOGIN
// ============================================
router.post('/login-step3', async (req, res) => {
    const { telegramId } = req.body || {};
    if (!telegramId || String(telegramId).trim() === '') {
        return res.status(400).json({ success: false, message: 'Telegram ID required.' });
    }
    return _processAdminCredentialLogin(
        req, res, 'LOGIN_STEP3_TELEGRAM',
        { telegramId: String(telegramId).trim() },
        'Telegram ID'
    );
});

// ============================================
// STEP 4 — WALLET ID LOGIN
// ============================================
router.post('/login-step4', async (req, res) => {
    const { walletId } = req.body || {};
    if (!walletId || String(walletId).trim() === '') {
        return res.status(400).json({ success: false, message: 'Wallet ID required.' });
    }
    return _processAdminCredentialLogin(
        req, res, 'LOGIN_STEP4_WALLET',
        { walletId: String(walletId).trim().toUpperCase() },
        'Wallet ID'
    );
});

// ============================================
// MY PROFILE
// ============================================
router.get('/my-profile', verifyAdminToken, async (req, res) => {
    const tag = 'MY_PROFILE';
    logRequest(req, tag);
    try {
        const admin = await Admin.findById(req.user.adminDbId).select('-password');
        if (!admin) {
            logWarn(tag, 'Admin not found', { adminDbId: req.user.adminDbId });
            return res.status(404).json({ success: false, message: 'Admin not found.' });
        }
        logSuccess(tag, 'Profile fetched', { walletId: admin.walletId });
        res.json({ success: true, admin });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.put('/update-my-profile', verifyAdminToken, async (req, res) => {
    const tag = 'UPDATE_PROFILE';
    logRequest(req, tag);
    try {
        const { fullName, mobile, email, telegramId } = req.body;
        const admin = await Admin.findById(req.user.adminDbId);
        if (!admin) {
            logWarn(tag, 'Admin not found');
            return res.status(404).json({ success: false, message: 'Admin not found.' });
        }

        if (fullName) admin.fullName = fullName;
        if (mobile) {
            if (!/^[0-9]{10}$/.test(mobile)) {
                logWarn(tag, 'Invalid mobile', { mobile });
                return res.status(400).json({ success: false, message: 'Mobile must be 10 digits.' });
            }
            const exists = await Admin.findOne({ mobile, _id: { $ne: admin._id } });
            if (exists) {
                logWarn(tag, 'Mobile already in use', { mobile });
                return res.status(400).json({ success: false, message: 'Mobile already in use.' });
            }
            admin.mobile = mobile;
        }
        if (email) admin.email = email;
        if (telegramId) {
            const exists = await Admin.findOne({ telegramId, _id: { $ne: admin._id } });
            if (exists) {
                return res.status(400).json({ success: false, message: 'Telegram ID already in use.' });
            }
            admin.telegramId = telegramId;
        }
        admin.updatedBy = admin.walletId;
        await admin.save();

        logSuccess(tag, 'Profile updated', { walletId: admin.walletId });
        res.json({ success: true, message: 'Profile updated.', admin });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.put('/change-my-password', verifyAdminToken, async (req, res) => {
    const tag = 'CHANGE_PASSWORD';
    logRequest(req, tag);
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            logWarn(tag, 'Missing passwords');
            return res.status(400).json({ success: false, message: 'Both passwords required.' });
        }
        if (newPassword.length < 6) {
            logWarn(tag, 'Password too short');
            return res.status(400).json({ success: false, message: 'Min 6 characters.' });
        }

        const admin = await Admin.findById(req.user.adminDbId);
        if (!admin) {
            logWarn(tag, 'Admin not found');
            return res.status(404).json({ success: false, message: 'Admin not found.' });
        }

        const isMatch = await admin.comparePassword(currentPassword);
        if (!isMatch) {
            logWarn(tag, 'Wrong current password', { walletId: admin.walletId });
            return res.status(401).json({ success: false, message: 'Current password incorrect.' });
        }

        admin.password = newPassword;
        admin.updatedBy = admin.walletId;
        await admin.save();

        logSuccess(tag, 'Password changed', { walletId: admin.walletId });
        res.json({ success: true, message: 'Password changed.' });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// ADMIN LIST
// ============================================
router.get('/admins-list', verifyAdminToken, async (req, res) => {
    const tag = 'ADMINS_LIST';
    logRequest(req, tag);
    try {
        if (req.user.role !== 'super_admin') {
            logWarn(tag, 'Access denied - not super admin', { role: req.user.role });
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }
        const admins = await Admin.find().select('-password').sort({ createdAt: -1 });
        logSuccess(tag, `Fetched ${admins.length} admins`);
        res.json({ success: true, admins });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.post('/create-admin-account', verifyAdminToken, async (req, res) => {
    const tag = 'CREATE_ADMIN';
    logRequest(req, tag);
    try {
        if (req.user.role !== 'super_admin') {
            logWarn(tag, 'Access denied');
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }
        const { walletId, password, fullName, mobile, email, telegramId, role } = req.body;
        if (!walletId || !password || !fullName || !mobile) {
            logWarn(tag, 'Required fields missing');
            return res.status(400).json({ success: false, message: 'Wallet ID, Password, Full Name and Mobile required.' });
        }
        if (password.length < 6) {
            logWarn(tag, 'Password too short');
            return res.status(400).json({ success: false, message: 'Password min 6 chars.' });
        }
        if (!/^[0-9]{10}$/.test(mobile)) {
            return res.status(400).json({ success: false, message: 'Mobile must be 10 digits.' });
        }

        const normalizedWalletId = String(walletId).trim().toUpperCase();

        const orConditions = [
            { walletId: normalizedWalletId },
            { mobile }
        ];
        if (telegramId && String(telegramId).trim()) {
            orConditions.push({ telegramId: String(telegramId).trim() });
        }

        const existing = await Admin.findOne({ $or: orConditions });
        if (existing) {
            logWarn(tag, 'Wallet ID / Mobile / Telegram exists');
            return res.status(400).json({ success: false, message: 'Wallet ID / Mobile / Telegram already exists.' });
        }

        const newAdmin = new Admin({
            walletId: normalizedWalletId,
            password,
            fullName,
            mobile,
            email: email || undefined,
            telegramId: (telegramId && String(telegramId).trim()) ? String(telegramId).trim() : undefined,
            role: role || 'admin',
            createdBy: req.user.walletId
        });
        await newAdmin.save();

        logSuccess(tag, 'Admin created', { walletId: newAdmin.walletId });
        await notifyAdmin(
`🆕 <b>New Admin Created</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`👤 <b>Name:</b> ${fullName}\n` +
`💼 <b>Wallet ID:</b> ${newAdmin.walletId}\n` +
`📱 <b>Mobile:</b> ${mobile}\n` +
`📨 <b>Telegram:</b> ${newAdmin.telegramId || 'N/A'}\n` +
`🎭 <b>Role:</b> ${newAdmin.role}\n` +
`✍️ <b>Created By:</b> ${req.user.fullName}\n\n` +
`🎉 Welcome to the team!`
        );

        res.json({
            success: true,
            message: 'Admin created.',
            admin: {
                walletId: newAdmin.walletId,
                fullName: newAdmin.fullName,
                mobile: newAdmin.mobile,
                telegramId: newAdmin.telegramId,
                role: newAdmin.role
            }
        });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.put('/update-admin/:adminDbId', verifyAdminToken, async (req, res) => {
    const tag = 'UPDATE_ADMIN';
    logRequest(req, tag);
    try {
        if (req.user.role !== 'super_admin') {
            logWarn(tag, 'Access denied');
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }
        const { fullName, mobile, email, telegramId, walletId, role, isActive, isBlocked, newPassword } = req.body;
        const admin = await Admin.findById(req.params.adminDbId);
        if (!admin) {
            logWarn(tag, 'Admin not found', { id: req.params.adminDbId });
            return res.status(404).json({ success: false, message: 'Admin not found.' });
        }

        if (fullName) admin.fullName = fullName;

        if (mobile && mobile !== admin.mobile) {
            if (!/^[0-9]{10}$/.test(mobile)) {
                return res.status(400).json({ success: false, message: 'Mobile must be 10 digits.' });
            }
            const dup = await Admin.findOne({ mobile, _id: { $ne: admin._id } });
            if (dup) return res.status(400).json({ success: false, message: 'Mobile already in use.' });
            admin.mobile = mobile;
        }

        if (email !== undefined) admin.email = email || undefined;

        if (telegramId !== undefined) {
            const tId = telegramId ? String(telegramId).trim() : undefined;
            if (tId && tId !== admin.telegramId) {
                const dup = await Admin.findOne({ telegramId: tId, _id: { $ne: admin._id } });
                if (dup) return res.status(400).json({ success: false, message: 'Telegram ID already in use.' });
            }
            admin.telegramId = tId || undefined;
        }

        if (walletId !== undefined) {
            const wId = walletId ? String(walletId).trim().toUpperCase() : undefined;
            if (wId && wId !== admin.walletId) {
                const dup = await Admin.findOne({ walletId: wId, _id: { $ne: admin._id } });
                if (dup) return res.status(400).json({ success: false, message: 'Wallet ID already in use.' });
            }
            if (wId) admin.walletId = wId;
        }

        if (role) admin.role = role;
        if (typeof isActive === 'boolean') admin.isActive = isActive;
        if (typeof isBlocked === 'boolean') admin.isBlocked = isBlocked;
        if (newPassword) admin.password = newPassword;
        admin.updatedBy = req.user.walletId;
        await admin.save();

        logSuccess(tag, 'Admin updated', { walletId: admin.walletId });
        res.json({ success: true, message: 'Admin updated.' });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.delete('/delete-admin/:adminDbId', verifyAdminToken, async (req, res) => {
    const tag = 'DELETE_ADMIN';
    logRequest(req, tag);
    try {
        if (req.user.role !== 'super_admin') {
            logWarn(tag, 'Access denied');
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }
        const admin = await Admin.findById(req.params.adminDbId);
        if (!admin) {
            logWarn(tag, 'Admin not found');
            return res.status(404).json({ success: false, message: 'Admin not found.' });
        }
        if (admin._id.toString() === req.user.adminDbId) {
            logWarn(tag, 'Cannot delete self');
            return res.status(400).json({ success: false, message: 'Cannot delete yourself.' });
        }
        await Admin.findByIdAndDelete(req.params.adminDbId);

        logSuccess(tag, 'Admin deleted', { walletId: admin.walletId });
        await notifyAdmin(
`🗑️ <b>Admin Deleted</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`👤 <b>Name:</b> ${admin.fullName}\n` +
`💼 <b>Wallet ID:</b> ${admin.walletId}\n` +
`📱 <b>Mobile:</b> ${admin.mobile}\n` +
`✍️ <b>Deleted By:</b> ${req.user.fullName}\n\n` +
`⚠️ Account removed from system.`
        );
        res.json({ success: true, message: 'Admin deleted.' });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// DEPOSIT SETTINGS
// ============================================
const DEFAULT_DEPOSIT_SETTINGS = {
    minDeposit: 10,
    maxDeposit: 100000,
    taxPercent: 0,
    taxEnabled: false
};

router.get('/deposit-settings', verifyAdminToken, async (req, res) => {
    const tag = 'DEPOSIT_SETTINGS_GET';
    logRequest(req, tag);
    try {
        const admin = await Admin.findOne({
            role: 'super_admin',
            isActive: true,
            isBlocked: false
        }).select('depositSettings').lean();

        const settings = (admin && admin.depositSettings)
            ? Object.assign({}, DEFAULT_DEPOSIT_SETTINGS, admin.depositSettings)
            : DEFAULT_DEPOSIT_SETTINGS;

        logSuccess(tag, 'Deposit settings fetched', settings);
        res.json({ success: true, settings });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.put('/deposit-settings', verifyAdminToken, async (req, res) => {
    const tag = 'DEPOSIT_SETTINGS_UPDATE';
    logRequest(req, tag);
    try {
        if (req.user.role !== 'super_admin') {
            logWarn(tag, 'Access denied');
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }

        const { minDeposit, maxDeposit, taxPercent, taxEnabled } = req.body;

        if (minDeposit !== undefined && (typeof minDeposit !== 'number' || minDeposit < 1)) {
            return res.status(400).json({ success: false, message: 'Min deposit must be at least 1.' });
        }
        if (maxDeposit !== undefined && (typeof maxDeposit !== 'number' || maxDeposit < 1)) {
            return res.status(400).json({ success: false, message: 'Max deposit must be at least 1.' });
        }
        if (minDeposit !== undefined && maxDeposit !== undefined && minDeposit > maxDeposit) {
            return res.status(400).json({ success: false, message: 'Min cannot exceed Max.' });
        }
        if (taxPercent !== undefined && (typeof taxPercent !== 'number' || taxPercent < 0 || taxPercent > 100)) {
            return res.status(400).json({ success: false, message: 'Tax must be 0-100.' });
        }

        const update = {};
        if (typeof minDeposit === 'number') update['depositSettings.minDeposit'] = minDeposit;
        if (typeof maxDeposit === 'number') update['depositSettings.maxDeposit'] = maxDeposit;
        if (typeof taxPercent === 'number') update['depositSettings.taxPercent'] = taxPercent;
        if (typeof taxEnabled === 'boolean') update['depositSettings.taxEnabled'] = taxEnabled;

        update['depositSettings.updatedAt'] = new Date();
        update['depositSettings.updatedBy'] = req.user.walletId;

        const superAdmin = await Admin.findOne({ role: 'super_admin' });
        if (!superAdmin) {
            logWarn(tag, 'Super admin not found');
            return res.status(404).json({ success: false, message: 'Super admin not found.' });
        }

        await Admin.findByIdAndUpdate(superAdmin._id, { $set: update }, { new: true });

        logSuccess(tag, 'Deposit settings updated', { minDeposit, maxDeposit, taxPercent, taxEnabled });
        await notifyAdmin(
`⚙️ <b>Deposit Settings Updated</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`✍️ <b>By:</b> ${req.user.fullName}\n\n` +
`📥 <b>Min Deposit:</b> ₹${minDeposit !== undefined ? minDeposit : 'unchanged'}\n` +
`📤 <b>Max Deposit:</b> ₹${maxDeposit !== undefined ? maxDeposit : 'unchanged'}\n` +
`💸 <b>Tax:</b> ${taxPercent !== undefined ? taxPercent + '%' : 'unchanged'}\n` +
`🔘 <b>Tax Enabled:</b> ${taxEnabled !== undefined ? (taxEnabled ? 'YES ✅' : 'NO ❌') : 'unchanged'}`
        );

        res.json({ success: true, message: 'Settings updated.' });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// REFERRAL SETTINGS
// ============================================
router.get('/referral-settings', verifyAdminToken, async (req, res) => {
    const tag = 'REFERRAL_SETTINGS_GET';
    logRequest(req, tag);
    try {
        const admin = await Admin.findOne({
            role: 'super_admin',
            isActive: true,
            isBlocked: false
        }).select('referralSettings').lean();

        const defaults = {
            enabled: true,
            bonusAmount: 10,
            minDepositAmount: 50,
            maxReferralsPerUser: 100
        };

        const settings = (admin && admin.referralSettings)
            ? Object.assign({}, defaults, admin.referralSettings)
            : defaults;

        logSuccess(tag, 'Settings fetched', settings);
        res.json({ success: true, settings });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.put('/referral-settings', verifyAdminToken, async (req, res) => {
    const tag = 'REFERRAL_SETTINGS_UPDATE';
    logRequest(req, tag);
    try {
        if (req.user.role !== 'super_admin') {
            logWarn(tag, 'Access denied');
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }

        const { enabled, bonusAmount, minDepositAmount, maxReferralsPerUser } = req.body;
        const update = {};

        if (typeof enabled === 'boolean') update['referralSettings.enabled'] = enabled;
        if (typeof bonusAmount === 'number' && bonusAmount > 0) update['referralSettings.bonusAmount'] = bonusAmount;
        if (typeof minDepositAmount === 'number' && minDepositAmount > 0) update['referralSettings.minDepositAmount'] = minDepositAmount;
        if (typeof maxReferralsPerUser === 'number' && maxReferralsPerUser > 0) update['referralSettings.maxReferralsPerUser'] = maxReferralsPerUser;

        update['referralSettings.updatedAt'] = new Date();
        update['referralSettings.updatedBy'] = req.user.walletId;

        const superAdmin = await Admin.findOne({ role: 'super_admin' });
        if (!superAdmin) {
            logWarn(tag, 'Super admin not found');
            return res.status(404).json({ success: false, message: 'Super admin not found.' });
        }

        await Admin.findByIdAndUpdate(superAdmin._id, { $set: update }, { new: true });

        logSuccess(tag, 'Settings updated', { enabled, bonusAmount, minDepositAmount, maxReferralsPerUser });
        await notifyAdmin(
`⚙️ <b>Referral Settings Updated</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`✍️ <b>By:</b> ${req.user.fullName}\n\n` +
`🔘 <b>Program:</b> ${enabled !== undefined ? (enabled ? 'ENABLED ✅' : 'DISABLED ❌') : 'unchanged'}\n` +
`💰 <b>Bonus:</b> ₹${bonusAmount || 'unchanged'}\n` +
`📥 <b>Min Deposit:</b> ₹${minDepositAmount || 'unchanged'}\n` +
`📊 <b>Max Refs:</b> ${maxReferralsPerUser || 'unchanged'}`
        );

        res.json({ success: true, message: 'Settings updated.' });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// REFERRAL MANAGEMENT
// ============================================
router.get('/referrals', verifyAdminToken, async (req, res) => {
    const tag = 'REFERRALS_LIST';
    logRequest(req, tag);
    try {
        const { status, search, page = 1, limit = 20 } = req.query;
        let query = {};
        if (status && status !== 'all') query.status = status;

        if (search) {
            const users = await User.find({
                $or: [
                    { fullName: { $regex: search, $options: 'i' } },
                    { mobile: { $regex: search, $options: 'i' } },
                    { referralCode: { $regex: search, $options: 'i' } }
                ]
            }).select('_id').lean();
            const userIds = users.map(u => u._id);
            query.$or = [
                { referrerId: { $in: userIds } },
                { referredUserId: { $in: userIds } },
                { referralCode: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const referrals = await Referral.find(query)
            .populate('referrerId', 'fullName mobile walletId referralCode')
            .populate('referredUserId', 'fullName mobile walletId')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const total = await Referral.countDocuments(query);
        const stats = await Referral.aggregate([
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
                    pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
                    failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
                    totalBonusPaid: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ['$status', 'completed'] }, { $eq: ['$referrerBonusPaid', true] }] },
                                '$bonusAmount', 0
                            ]
                        }
                    }
                }
            }
        ]);

        logSuccess(tag, `Fetched ${referrals.length} referrals (total: ${total})`);
        res.json({
            success: true,
            referrals,
            stats: stats[0] || { total: 0, completed: 0, pending: 0, failed: 0, totalBonusPaid: 0 },
            pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.get('/top-referrers', verifyAdminToken, async (req, res) => {
    const tag = 'TOP_REFERRERS';
    logRequest(req, tag);
    try {
        const top = await Referral.aggregate([
            { $match: { status: 'completed' } },
            { $group: { _id: '$referrerId', count: { $sum: 1 }, totalEarned: { $sum: '$bonusAmount' } } },
            { $sort: { count: -1 } },
            { $limit: 20 },
            { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
            { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } }
        ]);

        const leaderboard = top.map(t => ({
            userId: t._id,
            name: t.user ? t.user.fullName : 'Unknown',
            mobile: t.user ? t.user.mobile : '',
            walletId: t.user ? t.user.walletId : '',
            referralCode: t.user ? t.user.referralCode : '',
            count: t.count,
            totalEarned: t.totalEarned
        }));

        logSuccess(tag, `Fetched ${leaderboard.length} top referrers`);
        res.json({ success: true, leaderboard });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.put('/update-referral/:id', verifyAdminToken, async (req, res) => {
    const tag = 'UPDATE_REFERRAL';
    logRequest(req, tag);
    try {
        const { status, notes } = req.body;
        const referral = await Referral.findById(req.params.id);
        if (!referral) {
            logWarn(tag, 'Referral not found', { id: req.params.id });
            return res.status(404).json({ success: false, message: 'Not found.' });
        }
        if (status) referral.status = status;
        if (notes !== undefined) referral.notes = notes;
        if (status === 'completed' && !referral.completedAt) referral.completedAt = new Date();
        await referral.save();

        logSuccess(tag, 'Referral updated', { id: req.params.id, status });
        res.json({ success: true, message: 'Updated.', referral });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.delete('/delete-referral/:id', verifyAdminToken, async (req, res) => {
    const tag = 'DELETE_REFERRAL';
    logRequest(req, tag);
    try {
        if (req.user.role !== 'super_admin') {
            logWarn(tag, 'Access denied');
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }
        const referral = await Referral.findByIdAndDelete(req.params.id);
        if (!referral) {
            logWarn(tag, 'Referral not found');
            return res.status(404).json({ success: false, message: 'Not found.' });
        }
        logSuccess(tag, 'Referral deleted', { id: req.params.id });
        res.json({ success: true, message: 'Deleted.' });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.get('/user-referrals/:userId', verifyAdminToken, async (req, res) => {
    const tag = 'USER_REFERRALS';
    logRequest(req, tag);
    try {
        const userId = req.params.userId;
        const asReferrer = await Referral.find({ referrerId: userId })
            .populate('referredUserId', 'fullName mobile walletId')
            .sort({ createdAt: -1 }).lean();
        const asReferred = await Referral.findOne({ referredUserId: userId })
            .populate('referrerId', 'fullName mobile walletId referralCode').lean();

        logSuccess(tag, 'User referrals fetched', { userId, asReferrerCount: asReferrer.length });
        res.json({ success: true, asReferrer, asReferred });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.post('/force-complete-referral/:id', verifyAdminToken, async (req, res) => {
    const tag = 'FORCE_COMPLETE_REFERRAL';
    logRequest(req, tag);
    try {
        if (req.user.role !== 'super_admin') {
            logWarn(tag, 'Access denied');
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }

        const referral = await Referral.findById(req.params.id);
        if (!referral) {
            logWarn(tag, 'Referral not found');
            return res.status(404).json({ success: false, message: 'Referral not found.' });
        }
        if (referral.status === 'completed') {
            logWarn(tag, 'Already completed');
            return res.status(400).json({ success: false, message: 'Already completed.' });
        }

        const referrer = await User.findById(referral.referrerId);
        if (!referrer) {
            logWarn(tag, 'Referrer not found');
            return res.status(404).json({ success: false, message: 'Referrer not found.' });
        }

        const bonusAmount = req.body.bonusAmount || referral.bonusAmount || 10;
        const now = new Date();

        referral.status = 'completed';
        referral.completedAt = now;
        referral.depositCompleted = true;
        referral.depositCompletedAt = now;
        referral.bonusAmount = bonusAmount;
        referral.referrerBonusPaid = true;
        referral.referrerBonusPaidAt = now;
        referral.notes = (referral.notes || '') + ' [Force-completed by ' + req.user.fullName + ']';
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

        const txnId = 'FORCE_REF_' + Date.now().toString(36).toUpperCase();
        await Transaction.create({
            user_id: referrer._id,
            sender_id: referrer._id,
            receiver_id: referrer._id,
            amount: bonusAmount,
            type: 'gift',
            status: 'success',
            remark: 'Referral bonus (Force-completed by admin)',
            description: 'Admin released referral bonus manually',
            tx_id: txnId,
            tx_time: now,
            metadata: { transactionType: 'referral_bonus_force', forceCompletedBy: req.user.fullName }
        });

        logSuccess(tag, `Bonus Rs ${bonusAmount} credited to ${referrer.fullName}`);
        await notifyAdmin(
`⚡ <b>Referral Force-Completed</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`👤 <b>Referrer:</b> ${referrer.fullName}\n` +
`💰 <b>Bonus Paid:</b> ₹${bonusAmount}\n` +
`✍️ <b>By:</b> ${req.user.fullName}\n\n` +
`✅ Bonus credited manually!`
        );

        if (referrer.telegramId && BOT_TOKEN) {
            try {
                await sendTelegramMessage(referrer.telegramId,
`🎁 <b>Referral Bonus Credited!</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`💰 <b>Amount:</b> ₹${bonusAmount}\n` +
`💵 <b>New Balance:</b> ₹${(referrer.balance + bonusAmount).toFixed(2)}\n` +
`📌 <b>Reason:</b> Manual release by admin\n\n` +
`💜 Thank you for inviting friends!`
                );
            } catch (e) {}
        }

        res.json({
            success: true,
            message: `Rs ${bonusAmount} credited to ${referrer.fullName}.`,
            bonusAmount, referrerName: referrer.fullName
        });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed to complete.' });
    }
});

router.post('/reverse-referral/:id', verifyAdminToken, async (req, res) => {
    const tag = 'REVERSE_REFERRAL';
    logRequest(req, tag);
    try {
        if (req.user.role !== 'super_admin') {
            logWarn(tag, 'Access denied');
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }
        const referral = await Referral.findById(req.params.id);
        if (!referral) {
            logWarn(tag, 'Referral not found');
            return res.status(404).json({ success: false, message: 'Referral not found.' });
        }
        if (referral.status !== 'completed') {
            logWarn(tag, 'Only completed can be reversed', { status: referral.status });
            return res.status(400).json({ success: false, message: 'Only completed can be reversed.' });
        }
        if (!referral.referrerBonusPaid) {
            logWarn(tag, 'Bonus not paid');
            return res.status(400).json({ success: false, message: 'Bonus not paid.' });
        }

        const referrer = await User.findById(referral.referrerId);
        if (!referrer) {
            logWarn(tag, 'Referrer not found');
            return res.status(404).json({ success: false, message: 'Referrer not found.' });
        }

        const bonusAmount = referral.bonusAmount || 10;
        if (referrer.balance < bonusAmount) {
            logWarn(tag, 'Insufficient balance', { balance: referrer.balance, required: bonusAmount });
            return res.status(400).json({ success: false, message: `Insufficient balance.` });
        }

        const now = new Date();
        const reason = req.body.reason || 'Admin reversal';

        referral.status = 'failed';
        referral.referrerBonusPaid = false;
        referral.referrerBonusPaidAt = null;
        referral.notes = (referral.notes || '') + ' [Reversed by ' + req.user.fullName + ': ' + reason + ']';
        await referral.save();

        await User.updateOne(
            { _id: referrer._id },
            {
                $inc: {
                    balance: -bonusAmount,
                    referralCount: -1,
                    referralEarnings: -bonusAmount
                }
            }
        );

        const txnId = 'REV_REF_' + Date.now().toString(36).toUpperCase();
        await Transaction.create({
            user_id: referrer._id,
            sender_id: referrer._id,
            receiver_id: referrer._id,
            amount: bonusAmount,
            type: 'admin_deduct',
            status: 'success',
            remark: 'Referral bonus reversed',
            description: `Reversed by admin: ${reason}`,
            tx_id: txnId,
            tx_time: now,
            metadata: { transactionType: 'referral_bonus_reversed', reason }
        });

        logSuccess(tag, `Rs ${bonusAmount} reversed from ${referrer.fullName}`);
        await notifyAdmin(
`🔄 <b>Referral Reversed</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`👤 <b>Referrer:</b> ${referrer.fullName}\n` +
`💰 <b>Amount Deducted:</b> ₹${bonusAmount}\n` +
`📝 <b>Reason:</b> ${reason}\n` +
`✍️ <b>By:</b> ${req.user.fullName}\n\n` +
`⚠️ Bonus successfully reversed.`
        );

        res.json({
            success: true,
            message: `Rs ${bonusAmount} deducted from ${referrer.fullName}.`,
            deducted: bonusAmount
        });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.post('/bulk-approve-referrals', verifyAdminToken, async (req, res) => {
    const tag = 'BULK_APPROVE_REFERRALS';
    logRequest(req, tag);
    try {
        if (req.user.role !== 'super_admin') {
            logWarn(tag, 'Access denied');
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            logWarn(tag, 'No IDs provided');
            return res.status(400).json({ success: false, message: 'No referral IDs provided.' });
        }

        logInfo(tag, `Processing ${ids.length} referrals`);
        let completed = 0, failed = 0;
        for (const id of ids) {
            try {
                const referral = await Referral.findById(id);
                if (!referral || referral.status === 'completed') { failed++; continue; }
                const referrer = await User.findById(referral.referrerId);
                if (!referrer) { failed++; continue; }
                const bonusAmount = referral.bonusAmount || 10;
                const now = new Date();

                referral.status = 'completed';
                referral.completedAt = now;
                referral.referrerBonusPaid = true;
                referral.referrerBonusPaidAt = now;
                referral.notes = (referral.notes || '') + ' [Bulk-approved by ' + req.user.fullName + ']';
                await referral.save();

                await User.updateOne(
                    { _id: referrer._id },
                    { $inc: { balance: bonusAmount, referralCount: 1, referralPendingCount: -1, referralEarnings: bonusAmount } }
                );

                const txnId = 'BULK_REF_' + Date.now().toString(36).toUpperCase() + '_' + completed;
                await Transaction.create({
                    user_id: referrer._id,
                    sender_id: referrer._id,
                    receiver_id: referrer._id,
                    amount: bonusAmount,
                    type: 'gift',
                    status: 'success',
                    remark: 'Referral bonus (Bulk approved)',
                    tx_id: txnId,
                    tx_time: now,
                    metadata: { transactionType: 'referral_bonus_bulk' }
                });
                completed++;
            } catch (err) {
                failed++;
                logError(tag, `Failed for ID ${id}`, err);
            }
        }

        logSuccess(tag, `Bulk complete: ${completed} success, ${failed} failed`);
        res.json({ success: true, message: `Completed: ${completed}, Failed: ${failed}`, completed, failed });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Bulk failed.' });
    }
});

// ============================================
// DASHBOARD STATS
// ============================================
router.get('/stats', verifyAdminToken, async (req, res) => {
    const tag = 'DASHBOARD_STATS';
    logRequest(req, tag);
    try {
        const totalUsers = await User.countDocuments({ isDeleted: { $ne: true } });
        const activeUsers = await User.countDocuments({ isBlocked: false, isDeleted: { $ne: true }, isActive: { $ne: false } });
        const blockedUsers = await User.countDocuments({ isBlocked: true, isDeleted: { $ne: true } });
        const deletedUsers = await User.countDocuments({ isDeleted: true });

        const approvedDeposits = await Deposit.countDocuments({ status: 'approved' });
        const pendingDeposits = await Deposit.countDocuments({ status: 'pending_approval' });
        const rejectedDeposits = await Deposit.countDocuments({ status: 'rejected' });

        const allDeposits = await Deposit.find({ status: 'approved' });
        const totalVolume = allDeposits.reduce((sum, d) => sum + d.amount, 0);

        const totalWithdrawals = await Withdrawal.countDocuments();
        const pendingWithdrawals = await Withdrawal.countDocuments({ status: 'pending' });
        const completedWithdrawals = await Withdrawal.countDocuments({ status: 'completed' });
        const allWithdrawals = await Withdrawal.find({ status: 'completed' });
        const totalWithdrawn = allWithdrawals.reduce((sum, w) => sum + w.amount, 0);

        const totalLifafas = await Lifafa.countDocuments();
        const totalGifts = await Gift.countDocuments();

        const recentTransactions = await Transaction.find()
            .populate('sender_id', 'fullName mobile walletId')
            .populate('receiver_id', 'fullName mobile walletId')
            .populate('user_id', 'fullName mobile walletId')
            .sort({ createdAt: -1 })
            .limit(10);

        logSuccess(tag, 'Stats fetched', { totalUsers, pendingDeposits, pendingWithdrawals });
        res.json({
            success: true,
            stats: {
                totalUsers, activeUsers, blockedUsers, deletedUsers,
                approvedDeposits, pendingDeposits, rejectedDeposits, totalVolume,
                totalWithdrawals, pendingWithdrawals, completedWithdrawals, totalWithdrawn,
                totalLifafas, totalGifts
            },
            recentTransactions
        });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// TRANSACTIONS
// ============================================
router.get('/transactions', verifyAdminToken, async (req, res) => {
    const tag = 'TRANSACTIONS_LIST';
    logRequest(req, tag);
    try {
        const { type, status, search, page = 1, limit = 20 } = req.query;
        let query = {};
        if (type) query.type = type;
        if (status) query.status = status;
        if (search) {
            query.$or = [
                { tx_id: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } },
                { remark: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const transactions = await Transaction.find(query)
            .populate('sender_id', 'fullName mobile walletId')
            .populate('receiver_id', 'fullName mobile walletId')
            .populate('user_id', 'fullName mobile walletId')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Transaction.countDocuments(query);

        logSuccess(tag, `Fetched ${transactions.length} transactions (total: ${total})`);
        res.json({
            success: true,
            transactions,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// USERS
// ============================================
router.get('/users', verifyAdminToken, async (req, res) => {
    const tag = 'USERS_LIST';
    logRequest(req, tag);
    try {
        const { search, page = 1, limit = 20, status } = req.query;
        let query = {};
        if (status === 'active') query = { isBlocked: false, isDeleted: { $ne: true }, isActive: { $ne: false } };
        else if (status === 'blocked') query = { isBlocked: true, isDeleted: { $ne: true } };
        else if (status === 'deleted') query = { isDeleted: true };
        else if (status === 'all') query = {};
        else query = { isDeleted: { $ne: true } };

        if (search) {
            query.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { mobile: { $regex: search, $options: 'i' } },
                { walletId: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const users = await User.find(query).select('-password -pin -__v')
            .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));

        const total = await User.countDocuments(query);

        logSuccess(tag, `Fetched ${users.length} users (total: ${total})`);
        res.json({
            success: true,
            users,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.get('/user/:identifier', verifyAdminToken, async (req, res) => {
    const tag = 'USER_DETAIL';
    logRequest(req, tag);
    try {
        const { identifier } = req.params;
        let user = null;
        if (mongoose.Types.ObjectId.isValid(identifier)) {
            user = await User.findById(identifier).select('-password -pin -__v');
        }
        if (!user && /^[0-9]{10}$/.test(identifier)) {
            user = await User.findOne({ mobile: identifier }).select('-password -pin -__v');
        }
        if (!user) {
            user = await User.findOne({ walletId: identifier.toUpperCase() }).select('-password -pin -__v');
        }
        if (!user) {
            logWarn(tag, 'User not found', { identifier });
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const transactions = await Transaction.find({
            $or: [{ sender_id: user._id }, { receiver_id: user._id }, { user_id: user._id }]
        }).sort({ createdAt: -1 }).limit(100);

        logSuccess(tag, 'User details fetched', { userId: user._id });
        res.json({ success: true, user, transactions });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.post('/toggle-block', verifyAdminToken, async (req, res) => {
    const tag = 'TOGGLE_BLOCK';
    logRequest(req, tag);
    try {
        const { userId, reason } = req.body;
        const user = await User.findById(userId);
        if (!user) {
            logWarn(tag, 'User not found', { userId });
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        if (user.isBlocked) {
            await user.unblockAccount();
        } else {
            await user.blockAccount(reason || 'Blocked by admin');
        }

        const status = user.isBlocked ? 'Blocked' : 'Unblocked';
        logSuccess(tag, `User ${status}`, { userId, status });
        res.json({ success: true, message: `User ${status}.`, isBlocked: user.isBlocked });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.delete('/delete-user/:userId', verifyAdminToken, async (req, res) => {
    const tag = 'DELETE_USER';
    logRequest(req, tag);
    try {
        const userToDelete = await User.findById(req.params.userId);
        if (!userToDelete) {
            logWarn(tag, 'User not found', { userId: req.params.userId });
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        if (userToDelete.isAdmin) {
            logWarn(tag, 'Cannot delete admin');
            return res.status(400).json({ success: false, message: 'Cannot delete admin.' });
        }

        await userToDelete.softDelete(req.user.fullName || 'Admin');
        logSuccess(tag, 'User soft-deleted', { userId: req.params.userId, name: userToDelete.fullName });
        res.json({ success: true, message: `User "${userToDelete.fullName}" deleted.` });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.post('/restore-user/:userId', verifyAdminToken, async (req, res) => {
    const tag = 'RESTORE_USER';
    logRequest(req, tag);
    try {
        const user = await User.findById(req.params.userId);
        if (!user) {
            logWarn(tag, 'User not found');
            return res.status(404).json({ success: false, message: 'User not found.' });
        }
        if (!user.isDeleted) {
            logWarn(tag, 'User not deleted');
            return res.status(400).json({ success: false, message: 'Not deleted.' });
        }

        await user.restore();
        logSuccess(tag, 'User restored', { userId: req.params.userId });
        res.json({ success: true, message: `User "${user.fullName}" restored.` });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// UPDATE USER FULL DETAILS
// ============================================
router.put('/update-user/:userId', verifyAdminToken, async (req, res) => {
    const tag = 'UPDATE_USER';
    logRequest(req, tag);
    try {
        const { userId } = req.params;
        const {
            fullName, mobile, email, walletId,
            password, pin, balance, telegramId,
            isBlocked, isActive
        } = req.body;

        const user = await User.findById(userId);
        if (!user) {
            logWarn(tag, 'User not found', { userId });
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const changes = [];

        if (fullName && fullName.trim() && fullName !== user.fullName) {
            changes.push(`Name: ${user.fullName} -> ${fullName}`);
            user.fullName = fullName.trim();
        }

        if (mobile && mobile !== user.mobile) {
            if (!/^[0-9]{10}$/.test(mobile)) {
                return res.status(400).json({ success: false, message: 'Mobile must be 10 digits.' });
            }
            const exists = await User.findOne({ mobile, _id: { $ne: user._id } });
            if (exists) {
                return res.status(400).json({ success: false, message: 'Mobile already in use.' });
            }
            changes.push(`Mobile: ${user.mobile} -> ${mobile}`);
            user.mobile = mobile;
        }

        if (email !== undefined && email !== user.email) {
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(400).json({ success: false, message: 'Invalid email.' });
            }
            if (email) {
                const exists = await User.findOne({ email, _id: { $ne: user._id } });
                if (exists) {
                    return res.status(400).json({ success: false, message: 'Email already in use.' });
                }
            }
            changes.push(`Email: ${user.email || 'none'} -> ${email || 'none'}`);
            user.email = email || undefined;
        }

        if (walletId && walletId !== user.walletId) {
            const exists = await User.findOne({ walletId, _id: { $ne: user._id } });
            if (exists) {
                return res.status(400).json({ success: false, message: 'Wallet ID already in use.' });
            }
            changes.push(`Wallet: ${user.walletId} -> ${walletId}`);
            user.walletId = walletId;
        }

        if (telegramId !== undefined && telegramId !== user.telegramId) {
            changes.push(`Telegram: ${user.telegramId || 'none'} -> ${telegramId || 'none'}`);
            user.telegramId = telegramId || undefined;
        }

        if (password && password.length >= 6) {
            user.password = password;
            changes.push(`Password: CHANGED`);
        }

        if (pin !== undefined && pin !== null && String(pin).length >= 4) {
            user.pin = String(pin);
            changes.push(`PIN: CHANGED`);
        }

        if (balance !== undefined && typeof balance === 'number' && balance >= 0) {
            changes.push(`Balance: Rs ${user.balance} -> Rs ${balance}`);
            user.balance = balance;
        }

        if (typeof isBlocked === 'boolean' && isBlocked !== user.isBlocked) {
            user.isBlocked = isBlocked;
            changes.push(`Blocked: ${isBlocked ? 'YES' : 'NO'}`);
        }
        if (typeof isActive === 'boolean' && isActive !== user.isActive) {
            user.isActive = isActive;
            changes.push(`Active: ${isActive ? 'YES' : 'NO'}`);
        }

        if (changes.length === 0) {
            return res.json({ success: true, message: 'No changes made.' });
        }

        user.updatedBy = req.user.walletId;
        await user.save();

        logSuccess(tag, 'User updated', { userId, changes: changes.length });
        await notifyAdmin(
`✏️ <b>User Updated by Admin</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`👤 <b>User:</b> ${user.fullName}\n` +
`📱 <b>Mobile:</b> ${user.mobile}\n` +
`✍️ <b>Changed By:</b> ${req.user.fullName}\n\n` +
`📋 <b>Changes (${changes.length}):</b>\n` +
changes.map(c => `  • ${c}`).join('\n') + `\n\n` +
`✅ Update successful!`
        );

        res.json({
            success: true,
            message: `User updated (${changes.length} change${changes.length > 1 ? 's' : ''}).`,
            changes,
            user: await User.findById(userId).select('-password -pin -__v')
        });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed: ' + error.message });
    }
});

// ============================================
// ADJUST BALANCE
// ============================================
router.post('/adjust-balance', verifyAdminToken, async (req, res) => {
    const tag = 'ADJUST_BALANCE';
    logRequest(req, tag);
    try {
        const { userId, amount, type, reason } = req.body;
        if (!userId || !amount || !type) {
            logWarn(tag, 'Missing fields');
            return res.status(400).json({ success: false, message: 'Missing fields.' });
        }
        if (!['add', 'deduct'].includes(type)) {
            logWarn(tag, 'Invalid type', { type });
            return res.status(400).json({ success: false, message: 'Invalid type.' });
        }

        const user = await User.findById(userId);
        if (!user) {
            logWarn(tag, 'User not found', { userId });
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        const amountNum = parseFloat(amount);
        if (type === 'deduct' && user.balance < amountNum) {
            logWarn(tag, 'Insufficient balance', { balance: user.balance, required: amountNum });
            return res.status(400).json({ success: false, message: `Insufficient balance. Current: Rs ${user.balance}` });
        }

        const finalAmount = type === 'add' ? amountNum : -amountNum;
        user.balance += finalAmount;
        await user.save();

        const timestamp = Date.now().toString(36).toUpperCase();
        const random = Math.floor(Math.random() * 99999).toString().padStart(5, '0');
        const tx_id = `TXN${timestamp}${random}`;

        await Transaction.create({
            tx_id,
            user_id: user._id,
            sender_id: type === 'add' ? null : user._id,
            receiver_id: type === 'add' ? user._id : null,
            amount: amountNum,
            fee: 0,
            type: type === 'add' ? 'admin_add' : 'admin_deduct',
            status: 'success',
            remark: reason || 'No reason',
            description: `Admin ${type === 'add' ? 'added' : 'deducted'} Rs ${amountNum}`
        });

        logSuccess(tag, `Rs ${amountNum} ${type} - New balance: Rs ${user.balance}`, { userId, type });
        res.json({ success: true, message: `Balance ${type === 'add' ? 'added' : 'deducted'}. New: Rs ${user.balance}.`, newBalance: user.balance });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// DEPOSITS
// ============================================
router.get('/deposits', verifyAdminToken, async (req, res) => {
    const tag = 'DEPOSITS_LIST';
    logRequest(req, tag);
    try {
        const { status, page = 1, limit = 20 } = req.query;
        let query = {};
        if (status) query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const deposits = await Deposit.find(query)
            .populate('userId', 'fullName mobile walletId balance')
            .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const total = await Deposit.countDocuments(query);

        logSuccess(tag, `Fetched ${deposits.length} deposits (total: ${total})`);
        res.json({
            success: true,
            deposits,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// VERIFY DEPOSIT
// ============================================
router.post('/verify-deposit', verifyAdminToken, async (req, res) => {
    const tag = 'VERIFY_DEPOSIT';
    logRequest(req, tag);
    try {
        const { depositId, action, adminNotes } = req.body;
        const dateTime = getCurrentDateTime();

        logInfo(tag, 'Request received', { depositId, action });

        if (!depositId) {
            logWarn(tag, 'Deposit ID missing');
            return res.status(400).json({ success: false, message: 'Deposit ID required.' });
        }
        if (!action || !['approve', 'reject'].includes(action)) {
            logWarn(tag, 'Invalid action', { action });
            return res.status(400).json({ success: false, message: 'Invalid action.' });
        }

        const deposit = await Deposit.findById(depositId).populate('userId');
        if (!deposit) {
            logWarn(tag, 'Deposit not found', { depositId });
            return res.status(404).json({ success: false, message: 'Deposit not found.' });
        }

        logInfo(tag, 'Deposit found', { status: deposit.status, amount: deposit.amount });

        if (deposit.status !== 'pending_approval') {
            logWarn(tag, 'Invalid status for action', { currentStatus: deposit.status });
            return res.status(400).json({ success: false, message: `Status is "${deposit.status}".` });
        }

        if (action === 'approve') {
            const superAdmin = await Admin.findOne({
                role: 'super_admin',
                isActive: true,
                isBlocked: false
            }).select('depositSettings').lean();

            const depSettings = (superAdmin && superAdmin.depositSettings)
                ? Object.assign({}, DEFAULT_DEPOSIT_SETTINGS, superAdmin.depositSettings)
                : DEFAULT_DEPOSIT_SETTINGS;

            if (deposit.amount < depSettings.minDeposit) {
                return res.status(400).json({ success: false, message: `Below minimum deposit (Rs ${depSettings.minDeposit}).` });
            }
            if (deposit.amount > depSettings.maxDeposit) {
                return res.status(400).json({ success: false, message: `Exceeds maximum deposit (Rs ${depSettings.maxDeposit}).` });
            }

            let taxAmount = 0;
            let creditAmount = deposit.amount;
            let taxPercent = 0;

            if (depSettings.taxEnabled && depSettings.taxPercent > 0) {
                taxPercent = depSettings.taxPercent;
                taxAmount = parseFloat(((deposit.amount * taxPercent) / 100).toFixed(2));
                creditAmount = parseFloat((deposit.amount - taxAmount).toFixed(2));
            }

            deposit.status = 'approved';
            deposit.approvedBy = req.user.walletId || req.user.fullName;
            deposit.approvedAt = new Date();
            deposit.adminNote = adminNotes || 'Approved by admin';
            deposit.taxPercent = taxPercent;
            deposit.taxAmount = taxAmount;
            deposit.creditAmount = creditAmount;

            const user = await User.findById(deposit.userId._id);
            const oldBalance = user.balance;
            user.balance += creditAmount;
            await user.save();

            logInfo(tag, `Balance updated: Rs ${oldBalance} -> Rs ${user.balance}`);

            const timestamp = Date.now().toString(36).toUpperCase();
            const random = Math.random().toString(36).substring(2, 8).toUpperCase();
            const tx_id = `TXN_DEPOSIT_${timestamp}_${random}`;

            await Transaction.create({
                tx_id,
                user_id: deposit.userId._id,
                sender_id: deposit.userId._id,
                receiver_id: deposit.userId._id,
                amount: creditAmount,
                type: 'deposit',
                status: 'success',
                remark: taxAmount > 0
                    ? `Manual deposit approved (Tax ${taxPercent}%: Rs ${taxAmount})`
                    : 'Manual deposit approved by admin',
                description: `Deposit ${deposit.depositId} approved`,
                metadata: {
                    depositId: deposit.depositId,
                    originalAmount: deposit.amount,
                    taxPercent,
                    taxAmount,
                    creditAmount,
                    transactionRef: deposit.transactionRef,
                    approvedBy: req.user.fullName || 'Admin',
                    oldBalance, newBalance: user.balance
                }
            });

            logSuccess(tag, 'Transaction created', { tx_id });

            let referralResult = null;
            try {
                logInfo(tag, 'Processing referral...');
                referralResult = await safeProcessReferral(user, deposit.amount, dateTime);
                logSuccess(tag, 'Referral result', referralResult);
            } catch (refErr) {
                logError(tag, 'Referral processing error (continuing)', refErr);
            }

            try {
                let adminMsg = `✅ <b>Deposit Approved</b>\n\n`;
                adminMsg += `⏰ <b>Time:</b> ${dateTime}\n`;
                adminMsg += `👤 <b>Name:</b> ${user.fullName || 'N/A'}\n`;
                adminMsg += `💵 <b>Amount:</b> ₹${deposit.amount.toFixed(2)}\n`;
                if (taxAmount > 0) {
                    adminMsg += `✂️ <b>Tax (${taxPercent}%):</b> -₹${taxAmount.toFixed(2)}\n`;
                    adminMsg += `✅ <b>Credited:</b> ₹${creditAmount.toFixed(2)}\n`;
                }
                adminMsg += `🆔 <b>Deposit ID:</b> ${deposit.depositId}\n`;
                adminMsg += `💰 <b>New Balance:</b> ₹${user.balance.toFixed(2)}\n`;
                if (referralResult && referralResult.completed) {
                    adminMsg += `🎁 <b>Referral Bonus Paid:</b> ₹${referralResult.bonusAmount}\n`;
                }
                adminMsg += `\n🎉 Successfully approved!`;
                await notifyAdmin(adminMsg);

                if (user.telegramId && BOT_TOKEN) {
                    let userMsg = `🎉 <b>Deposit Approved!</b>\n\n`;
                    userMsg += `⏰ <b>Time:</b> ${dateTime}\n`;
                    userMsg += `💵 <b>Amount:</b> ₹${deposit.amount.toFixed(2)}\n`;
                    if (taxAmount > 0) {
                        userMsg += `✂️ <b>Tax (${taxPercent}%):</b> -₹${taxAmount.toFixed(2)}\n`;
                        userMsg += `✅ <b>You Received:</b> ₹${creditAmount.toFixed(2)}\n`;
                    }
                    userMsg += `💰 <b>New Balance:</b> ₹${user.balance.toFixed(2)}\n`;
                    if (referralResult && referralResult.completed) {
                        userMsg += `\n🎁 <b>Referral Update:</b>\n`;
                        userMsg += `Your friend got ₹${referralResult.bonusAmount} as bonus reward! 🎊\n`;
                    }
                    userMsg += `\n💜 Thanks for using our wallet!`;
                    await sendTelegramMessage(user.telegramId, userMsg);
                }
            } catch (notifyErr) {
                logError(tag, 'Notification error (continuing)', notifyErr);
            }

            await deposit.save();

            logSuccess(tag, 'Deposit approved successfully', { depositId: deposit.depositId });

            return res.json({
                success: true,
                message: 'Deposit approved successfully.',
                amount: deposit.amount,
                creditAmount,
                taxAmount,
                newBalance: user.balance,
                referral: referralResult
            });
        } else {
            deposit.status = 'rejected';
            deposit.rejectedBy = req.user.walletId || req.user.fullName;
            deposit.rejectedAt = new Date();
            deposit.adminNote = adminNotes || 'Rejected by admin';

            try {
                await notifyAdmin(
`❌ <b>Deposit Rejected</b>\n\n` +
`⏰ <b>Time:</b> ${dateTime}\n` +
`👤 <b>Name:</b> ${deposit.userId.fullName}\n` +
`💵 <b>Amount:</b> ₹${deposit.amount.toFixed(2)}\n` +
`📝 <b>Reason:</b> ${deposit.adminNote}\n\n` +
`⚠️ Deposit rejected by admin.`
                );
                if (deposit.userId.telegramId && BOT_TOKEN) {
                    await sendTelegramMessage(deposit.userId.telegramId,
`❌ <b>Deposit Rejected</b>\n\n` +
`⏰ <b>Time:</b> ${dateTime}\n` +
`💵 <b>Amount:</b> ₹${deposit.amount.toFixed(2)}\n` +
`📝 <b>Reason:</b> ${deposit.adminNote}\n\n` +
`💬 Need help? Contact admin.`
                    );
                }
            } catch (notifyErr) {
                logError(tag, 'Notification error (continuing)', notifyErr);
            }

            await deposit.save();
            logSuccess(tag, 'Deposit rejected', { depositId: deposit.depositId });
            return res.json({ success: true, message: 'Deposit rejected.', reason: deposit.adminNote });
        }
    } catch (error) {
        logError(tag, 'CRITICAL error', error);
        return res.status(500).json({ success: false, message: 'Failed: ' + error.message });
    }
});

// ============================================
// ADMIN CANCEL DEPOSIT
// ============================================
router.post('/cancel-deposit', verifyAdminToken, async (req, res) => {
    const tag = 'CANCEL_DEPOSIT';
    logRequest(req, tag);
    try {
        const { depositId, reason } = req.body;

        if (!depositId) {
            logWarn(tag, 'Deposit ID missing');
            return res.status(400).json({ success: false, message: 'Deposit ID required.' });
        }

        const deposit = await Deposit.findById(depositId).populate('userId');
        if (!deposit) {
            logWarn(tag, 'Deposit not found', { depositId });
            return res.status(404).json({ success: false, message: 'Deposit not found.' });
        }

        if (deposit.status !== 'pending_approval' && deposit.status !== 'pending') {
            logWarn(tag, 'Invalid status for cancel', { currentStatus: deposit.status });
            return res.status(400).json({ success: false, message: `Cannot cancel deposit with status "${deposit.status}".` });
        }

        const dateTime = getCurrentDateTime();
        const cancelReason = reason || 'Cancelled by admin';

        deposit.status = 'cancelled';
        deposit.adminNote = cancelReason;
        deposit.cancelledAt = new Date();
        deposit.cancelledBy = req.user.walletId || req.user.fullName;
        await deposit.save();

        logSuccess(tag, 'Deposit cancelled', { depositId: deposit.depositId });

        try {
            await notifyAdmin(
`🚫 <b>Deposit Cancelled by Admin</b>\n\n` +
`⏰ <b>Time:</b> ${dateTime}\n` +
`👤 <b>Name:</b> ${deposit.userId.fullName}\n` +
`💵 <b>Amount:</b> ₹${deposit.amount.toFixed(2)}\n` +
`📄 <b>Deposit ID:</b> ${deposit.depositId}\n` +
`📝 <b>Reason:</b> ${cancelReason}\n` +
`✍️ <b>By:</b> ${req.user.fullName}\n\n` +
`ℹ️ User can now create a new deposit.`
            );

            if (deposit.userId.telegramId && BOT_TOKEN) {
                await sendTelegramMessage(deposit.userId.telegramId,
`🚫 <b>Deposit Cancelled</b>\n\n` +
`⏰ <b>Time:</b> ${dateTime}\n` +
`💵 <b>Amount:</b> ₹${deposit.amount.toFixed(2)}\n` +
`📄 <b>Deposit ID:</b> ${deposit.depositId}\n` +
`📝 <b>Reason:</b> ${cancelReason}\n\n` +
`💡 You can create a new deposit anytime.`
                );
            }
        } catch (notifyErr) {
            logError(tag, 'Notification error (continuing)', notifyErr);
        }

        return res.json({
            success: true,
            message: 'Deposit cancelled successfully.',
            depositId: deposit.depositId
        });

    } catch (error) {
        logError(tag, 'Failed', error);
        return res.status(500).json({ success: false, message: 'Failed: ' + error.message });
    }
});

// ============================================
// SAFE REFERRAL PROCESSING
// ============================================
async function safeProcessReferral(user, depositAmount, dateTime) {
    const tag = 'SAFE_REFERRAL';
    try {
        if (!user.referredBy) {
            logInfo(tag, 'User not referred');
            return { processed: false, reason: 'User not referred' };
        }

        logInfo(tag, 'Processing for user', { userId: user._id, referredBy: user.referredBy, amount: depositAmount });

        const admin = await Admin.findOne({
            role: 'super_admin',
            isActive: true,
            isBlocked: false
        }).select('referralSettings').lean();

        const settings = (admin && admin.referralSettings) ? {
            enabled: admin.referralSettings.enabled !== false,
            bonusAmount: admin.referralSettings.bonusAmount || 10,
            minDepositAmount: admin.referralSettings.minDepositAmount || 50
        } : {
            enabled: true,
            bonusAmount: 10,
            minDepositAmount: 50
        };

        logInfo(tag, 'Settings loaded', settings);

        if (!settings.enabled) {
            logWarn(tag, 'Program disabled');
            return { processed: false, reason: 'Program disabled' };
        }

        const pendingReferral = await Referral.findOne({
            referrerId: user.referredBy,
            referredUserId: user._id,
            status: 'pending'
        });

        if (!pendingReferral) {
            logInfo(tag, 'No pending referral');
            return { processed: false, reason: 'No pending referral' };
        }

        const requiredDeposit = settings.minDepositAmount;
        const previousDeposit = pendingReferral.depositAmount || 0;
        const newTotalDeposit = previousDeposit + depositAmount;

        logInfo(tag, 'Deposit progress', { previousDeposit, depositAmount, newTotalDeposit, requiredDeposit });

        pendingReferral.minDepositRequired = requiredDeposit;
        pendingReferral.depositAmount = newTotalDeposit;

        if (newTotalDeposit >= requiredDeposit) {
            const now = new Date();
            const bonusAmount = settings.bonusAmount;

            pendingReferral.status = 'completed';
            pendingReferral.completedAt = now;
            pendingReferral.depositCompleted = true;
            pendingReferral.depositCompletedAt = now;
            pendingReferral.bonusAmount = bonusAmount;
            pendingReferral.referrerBonusPaid = true;
            pendingReferral.referrerBonusPaidAt = now;
            pendingReferral.referredBonusPaid = false;
            await pendingReferral.save();

            const referrer = await User.findById(pendingReferral.referrerId);
            if (!referrer) {
                logWarn(tag, 'Referrer not found', { referrerId: pendingReferral.referrerId });
                return { processed: false, reason: 'Referrer not found' };
            }

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

            const txnId = 'REF' + Math.random().toString(36).substring(2, 10).toUpperCase();
            await Transaction.create({
                user_id: referrer._id,
                sender_id: referrer._id,
                receiver_id: referrer._id,
                amount: bonusAmount,
                type: 'gift',
                status: 'success',
                remark: `Referral bonus from ${user.fullName || 'user'}`,
                description: `Friend's total deposit reached Rs ${newTotalDeposit}`,
                tx_id: txnId + '-REF',
                tx_time: now,
                metadata: {
                    transactionType: 'referral_bonus_received',
                    referredUserId: user._id,
                    totalDepositAmount: newTotalDeposit,
                    bonusType: 'referrer_only'
                }
            });

            logSuccess(tag, `Referral completed: Rs ${bonusAmount} to ${referrer.fullName}`);

            if (referrer.telegramId && BOT_TOKEN) {
                try {
                    await sendTelegramMessage(referrer.telegramId,
`🎉 <b>Referral Bonus Received!</b>\n\n` +
`⏰ <b>Time:</b> ${dateTime}\n` +
`💰 <b>Amount:</b> ₹${bonusAmount}\n` +
`👤 <b>From:</b> ${user.fullName || 'Your Friend'}\n` +
`📊 <b>Reason:</b> Friend's deposit reached ₹${newTotalDeposit}\n\n` +
`🎊 Keep inviting — keep earning! 🚀`
                    );
                } catch (e) { logError(tag, 'Referrer notify failed', e); }
            }

            if (user.telegramId && BOT_TOKEN) {
                try {
                    await sendTelegramMessage(user.telegramId,
`🎊 <b>Good News!</b>\n\n` +
`⏰ <b>Time:</b> ${dateTime}\n` +
`📊 <b>Your Total Deposit:</b> ₹${newTotalDeposit}\n` +
`🎁 <b>Referral Bonus Given:</b> ₹${bonusAmount}\n\n` +
`👥 Your friend just earned a reward!\n` +
`💡 Keep depositing to unlock more! 🚀`
                    );
                } catch (e) { logError(tag, 'User notify failed', e); }
            }

            return {
                processed: true,
                completed: true,
                bonusAmount,
                referrerName: referrer.fullName,
                totalDeposit: newTotalDeposit
            };
        } else {
            await pendingReferral.save();
            const remaining = requiredDeposit - newTotalDeposit;
            logInfo(tag, 'Progress saved', { totalDeposit: newTotalDeposit, remaining });
            return {
                processed: true,
                completed: false,
                totalDeposit: newTotalDeposit,
                requiredDeposit,
                remaining
            };
        }
    } catch (err) {
        logError(tag, 'Error', err);
        return { processed: false, reason: err.message };
    }
}

// ============================================
// LIFAFA
// ============================================
router.get('/lifafas', verifyAdminToken, async (req, res) => {
    const tag = 'LIFAFAS_LIST';
    logRequest(req, tag);
    try {
        const { search, page = 1, limit = 20 } = req.query;
        let query = {};
        if (search) query.$or = [{ title: { $regex: search, $options: 'i' } }];

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const lifafas = await Lifafa.find(query)
            .populate('userId', 'fullName mobile')
            .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const total = await Lifafa.countDocuments(query);

        logSuccess(tag, `Fetched ${lifafas.length} lifafas`);
        res.json({
            success: true, lifafas,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.delete('/delete-lifafa/:id', verifyAdminToken, async (req, res) => {
    const tag = 'DELETE_LIFAFA';
    logRequest(req, tag);
    try {
        const lifafa = await Lifafa.findByIdAndDelete(req.params.id);
        if (!lifafa) {
            logWarn(tag, 'Not found');
            return res.status(404).json({ success: false, message: 'Not found.' });
        }
        logSuccess(tag, 'Lifafa deleted', { id: req.params.id });
        res.json({ success: true, message: 'Deleted.' });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// GIFTS
// ============================================
router.get('/gifts', verifyAdminToken, async (req, res) => {
    const tag = 'GIFTS_LIST';
    logRequest(req, tag);
    try {
        const { search, page = 1, limit = 20 } = req.query;
        let query = {};
        if (search) query.code = { $regex: search, $options: 'i' };

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const gifts = await Gift.find(query)
            .populate('userId', 'fullName mobile')
            .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const total = await Gift.countDocuments(query);

        logSuccess(tag, `Fetched ${gifts.length} gifts`);
        res.json({
            success: true, gifts,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.delete('/delete-gift/:id', verifyAdminToken, async (req, res) => {
    const tag = 'DELETE_GIFT';
    logRequest(req, tag);
    try {
        const gift = await Gift.findByIdAndDelete(req.params.id);
        if (!gift) {
            logWarn(tag, 'Not found');
            return res.status(404).json({ success: false, message: 'Not found.' });
        }
        logSuccess(tag, 'Gift deleted', { code: gift.code });
        res.json({ success: true, message: 'Deleted.' });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

module.exports = router;