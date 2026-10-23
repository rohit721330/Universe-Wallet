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
// LOGGERS
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
        console.error(`[${tag}] Message:`, error.message || error);
        if (error.name) console.error(`[${tag}] Name:`, error.name);
        if (error.code) console.error(`[${tag}] Code:`, error.code);
        if (error.keyValue) console.error(`[${tag}] KeyValue:`, JSON.stringify(error.keyValue));
        if (error.errors) {
            Object.keys(error.errors).forEach(k => {
                console.error(`[${tag}] Field "${k}":`, error.errors[k].message);
            });
        }
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
        if (!chatId) { resolve({ success: false }); return; }

        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const data = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' });
        const request = https.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData);
                    if (!parsed.ok) logWarn('TELEGRAM', 'Send failed', parsed.description);
                    resolve({ success: parsed.ok });
                } catch (e) { resolve({ success: false }); }
            });
        });
        request.on('error', () => resolve({ success: false }));
        request.write(data);
        request.end();
    });
}

// ============================================
// NOTIFY: System-only (no actor context)
// Used for: failed login, wrong pattern
// ============================================
async function notifyAdmin(message) {
    try {
        if (!ADMIN_TG_ID) {
            logWarn('NOTIFY', 'ADMIN_TG_ID not configured');
            return;
        }
        const result = await sendTelegramMessage(ADMIN_TG_ID, message);
        if (result.success) logInfo('NOTIFY', 'Admin notification sent');
        else logWarn('NOTIFY', 'Admin notification failed');
    } catch (error) {
        logError('NOTIFY', 'Admin notification error', error);
    }
}

// ============================================
// NOTIFY_ACTION: Sends to actor + all super_admins
// ============================================
async function notifyAction(actorAdmin, message, options) {
    options = options || {};
    try {
        const recipients = new Set();

        // 1) Actor's own telegramId
        if (actorAdmin && actorAdmin.telegramId) {
            const tid = String(actorAdmin.telegramId).trim();
            if (tid) recipients.add(tid);
        }

        // 2) All active super_admins' telegramIds
        const superAdmins = await Admin.find({
            role: 'super_admin',
            isActive: true,
            isBlocked: false
        }).select('telegramId').lean();

        superAdmins.forEach(sa => {
            if (sa.telegramId && String(sa.telegramId).trim()) {
                recipients.add(String(sa.telegramId).trim());
            }
        });

        // 3) Global fallback (ADMIN_TG_ID)
        if (ADMIN_TG_ID) {
            const gid = String(ADMIN_TG_ID).trim();
            if (gid) recipients.add(gid);
        }

        // 4) Extra recipients (e.g., new admin being created)
        if (options.extraRecipients && Array.isArray(options.extraRecipients)) {
            options.extraRecipients.forEach(r => {
                if (r && String(r).trim()) recipients.add(String(r).trim());
            });
        }

        if (recipients.size === 0) {
            logWarn('NOTIFY_ACTION', 'No recipients', { actor: actorAdmin ? actorAdmin.walletId : 'system' });
            return { sent: 0, failed: 0, total: 0 };
        }

        let sent = 0, failed = 0;
        const list = Array.from(recipients);

        for (const chatId of list) {
            try {
                const res = await sendTelegramMessage(chatId, message);
                if (res.success) sent++;
                else failed++;
            } catch (e) {
                failed++;
                logError('NOTIFY_ACTION', `Failed for ${chatId}`, e);
            }
        }

        logInfo('NOTIFY_ACTION', `Sent ${sent}/${list.length}`, {
            actor: actorAdmin ? actorAdmin.walletId : 'system',
            sent, failed
        });
        return { sent, failed, total: list.length };
    } catch (error) {
        logError('NOTIFY_ACTION', 'Routing error', error);
        return { sent: 0, failed: 0 };
    }
}

// Helper: get actor admin (fresh from DB)
async function getActorAdmin(req) {
    if (!req.user || !req.user.adminDbId) return null;
    try {
        return await Admin.findById(req.user.adminDbId)
            .select('telegramId fullName walletId role')
            .lean();
    } catch (e) { return null; }
}

// ============================================
// AUTH MIDDLEWARE
// ============================================
async function verifyAdminToken(req, res, next) {
    const tag = 'AUTH';
    logRequest(req, tag);
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'No Token Provided.' });
        }
        const token = authHeader.split(' ')[1];
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (!decoded.isAdmin || decoded.tokenType !== 'admin_jwt') {
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
            return next();
        } catch (jwtError) {
            if (jwtError.name === 'TokenExpiredError') {
                return res.status(401).json({ success: false, message: 'Token Has Expired.' });
            }
            return res.status(401).json({ success: false, message: 'Invalid Token.' });
        }
    } catch (error) {
        logError(tag, 'Token verification error', error);
        return res.status(500).json({ success: false, message: 'Auth Error.' });
    }
}

// ============================================
// LOGIN STEP 1: PATTERN
// ============================================
router.post('/login-step1', async (req, res) => {
    const tag = 'LOGIN_STEP1';
    logRequest(req, tag);
    try {
        const { pattern } = req.body;
        if (!pattern) return res.status(400).json({ success: false, message: 'Pattern required.' });
        if (!/^[0-9]{2,9}$/.test(pattern)) {
            return res.status(400).json({ success: false, message: 'Pattern must be 2-9 digits.' });
        }
        if (!ADMIN_PATTERN) {
            return res.status(500).json({ success: false, message: 'Server misconfiguration.' });
        }
        if (pattern !== ADMIN_PATTERN) {
            logWarn(tag, 'Wrong pattern', { ip: req.ip });
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
        res.json({ success: true, message: 'Pattern verified.', tempToken });
    } catch (error) {
        logError(tag, 'Login step1 error', error);
        res.status(500).json({ success: false, message: 'Login failed.' });
    }
});

// ============================================
// LOGIN: shared credential verification
// ============================================
async function _processAdminCredentialLogin(req, res, tag, lookupQuery, lookupLabel) {
    logRequest(req, tag);
    try {
        const { tempToken, password } = req.body;
        if (!tempToken || !password) {
            return res.status(400).json({ success: false, message: 'Required fields missing.' });
        }
        let decoded;
        try { decoded = jwt.verify(tempToken, JWT_SECRET); }
        catch (err) {
            return res.status(401).json({ success: false, message: 'Session expired.' });
        }
        if (decoded.step !== 'credentials_pending' || !decoded.patternVerified) {
            return res.status(401).json({ success: false, message: 'Invalid session.' });
        }
        if (!lookupQuery || Object.keys(lookupQuery).length === 0) {
            return res.status(400).json({ success: false, message: `${lookupLabel} required.` });
        }

        const admin = await Admin.findOne(lookupQuery);
        if (!admin) {
            await notifyAdmin(
`❌ <b>Admin Login Failed</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`📝 <b>Reason:</b> ${lookupLabel} not found\n` +
`🆔 <b>${lookupLabel}:</b> ${JSON.stringify(lookupQuery)}\n` +
`🌐 <b>IP:</b> ${req.ip}\n\n` +
`🔒 Security Alert!`
            );
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }
        if (admin.isBlocked) {
            return res.status(403).json({ success: false, message: 'Account blocked.' });
        }
        if (!admin.isActive) {
            return res.status(403).json({ success: false, message: 'Account inactive.' });
        }

        const isMatch = await admin.comparePassword(password);
        if (!isMatch) {
            await notifyAdmin(
`❌ <b>Admin Login Failed</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`📝 <b>Reason:</b> Wrong password\n` +
`🎯 <b>Via:</b> ${lookupLabel}\n` +
`💼 <b>Wallet ID:</b> ${admin.walletId}\n` +
`🌐 <b>IP:</b> ${req.ip}\n\n` +
`🔒 Security Alert!`
            );
            return res.status(401).json({ success: false, message: 'Invalid credentials.' });
        }

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

        // Notify actor + super_admins
        const actorForNotify = {
            telegramId: admin.telegramId,
            fullName: admin.fullName,
            walletId: admin.walletId
        };
        await notifyAction(actorForNotify,
`✅ <b>Admin Login Successful</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`👤 <b>Name:</b> ${admin.fullName}\n` +
`💼 <b>Wallet ID:</b> ${admin.walletId}\n` +
`📱 <b>Mobile:</b> ${admin.mobile}\n` +
`🎯 <b>Via:</b> ${lookupLabel}\n` +
`🎭 <b>Role:</b> ${admin.role}\n` +
`🌐 <b>IP:</b> ${req.ip}\n\n` +
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

router.post('/login-step2', async (req, res) => {
    const { mobile } = req.body || {};
    if (!mobile || !/^[0-9]{10}$/.test(mobile)) {
        return res.status(400).json({ success: false, message: 'Valid 10-digit mobile required.' });
    }
    return _processAdminCredentialLogin(req, res, 'LOGIN_STEP2', { mobile: mobile.trim() }, 'Mobile');
});

router.post('/login-step3', async (req, res) => {
    const { telegramId } = req.body || {};
    if (!telegramId || String(telegramId).trim() === '') {
        return res.status(400).json({ success: false, message: 'Telegram ID required.' });
    }
    return _processAdminCredentialLogin(req, res, 'LOGIN_STEP3', { telegramId: String(telegramId).trim() }, 'Telegram ID');
});

router.post('/login-step4', async (req, res) => {
    const { walletId } = req.body || {};
    if (!walletId || String(walletId).trim() === '') {
        return res.status(400).json({ success: false, message: 'Wallet ID required.' });
    }
    return _processAdminCredentialLogin(req, res, 'LOGIN_STEP4', { walletId: String(walletId).trim().toUpperCase() }, 'Wallet ID');
});

// ============================================
// MY PROFILE
// ============================================
router.get('/my-profile', verifyAdminToken, async (req, res) => {
    const tag = 'MY_PROFILE';
    try {
        const admin = await Admin.findById(req.user.adminDbId).select('-password');
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });
        res.json({ success: true, admin });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.put('/update-my-profile', verifyAdminToken, async (req, res) => {
    const tag = 'UPDATE_PROFILE';
    try {
        const { fullName, mobile, email, telegramId } = req.body;
        const admin = await Admin.findById(req.user.adminDbId);
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });

        const changes = [];
        if (fullName && fullName !== admin.fullName) {
            changes.push(`Name: ${admin.fullName} → ${fullName}`);
            admin.fullName = fullName;
        }
        if (mobile && mobile !== admin.mobile) {
            if (!/^[0-9]{10}$/.test(mobile)) {
                return res.status(400).json({ success: false, message: 'Mobile must be 10 digits.' });
            }
            const dup = await Admin.findOne({ mobile, _id: { $ne: admin._id } });
            if (dup) return res.status(400).json({ success: false, message: 'Mobile already in use.' });
            changes.push(`Mobile: ${admin.mobile} → ${mobile}`);
            admin.mobile = mobile;
        }
        if (email !== undefined && email !== admin.email) {
            if (email) {
                const dup = await Admin.findOne({ email, _id: { $ne: admin._id } });
                if (dup) return res.status(400).json({ success: false, message: 'Email already in use.' });
            }
            changes.push(`Email changed`);
            admin.email = email || undefined;
        }
        if (telegramId !== undefined && telegramId !== admin.telegramId) {
            const tId = telegramId ? String(telegramId).trim() : undefined;
            if (tId) {
                const dup = await Admin.findOne({ telegramId: tId, _id: { $ne: admin._id } });
                if (dup) return res.status(400).json({ success: false, message: 'Telegram ID already in use.' });
            }
            changes.push(`Telegram: ${admin.telegramId || 'none'} → ${tId || 'none'}`);
            admin.telegramId = tId;
        }
        if (changes.length === 0) return res.json({ success: true, message: 'No changes.' });

        admin.updatedBy = admin.walletId;
        await admin.save();

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
`✏️ <b>Profile Updated</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`👤 <b>Admin:</b> ${admin.fullName} (${admin.walletId})\n\n` +
`📋 <b>Changes:</b>\n` +
changes.map(c => `  • ${c}`).join('\n')
        );

        res.json({ success: true, message: 'Profile updated.', admin });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.put('/change-my-password', verifyAdminToken, async (req, res) => {
    const tag = 'CHANGE_PASSWORD';
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: 'Both passwords required.' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'Min 6 characters.' });
        }
        const admin = await Admin.findById(req.user.adminDbId);
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });

        const isMatch = await admin.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(401).json({ success: false, message: 'Current password incorrect.' });
        }
        admin.password = newPassword;
        admin.updatedBy = admin.walletId;
        await admin.save();

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
`🔑 <b>Password Changed</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`👤 <b>Admin:</b> ${admin.fullName} (${admin.walletId})\n\n` +
`⚠️ If this wasn't you, contact super admin immediately!`
        );

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
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }
        const admins = await Admin.find().select('-password').sort({ createdAt: -1 });
        res.json({ success: true, admins });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// CREATE ADMIN
// ============================================
router.post('/create-admin-account', verifyAdminToken, async (req, res) => {
    const tag = 'CREATE_ADMIN';
    logRequest(req, tag);
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Only super admin can create admins.' });
        }

        const { walletId, password, fullName, mobile, email, telegramId, role } = req.body;

        if (!walletId || !password || !fullName || !mobile) {
            return res.status(400).json({
                success: false,
                message: 'Wallet ID, Password, Full Name and Mobile are required.'
            });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
        }
        if (!/^[0-9]{10}$/.test(String(mobile).trim())) {
            return res.status(400).json({ success: false, message: 'Mobile must be 10 digits.' });
        }

        const normalizedWalletId = String(walletId).trim().toUpperCase();
        if (!/^[A-Z0-9_]{2,}$/.test(normalizedWalletId)) {
            return res.status(400).json({ success: false, message: 'Invalid Wallet ID format.' });
        }

        const allowedRoles = ['admin', 'super_admin', 'moderator'];
        const finalRole = allowedRoles.indexOf(role) > -1 ? role : 'admin';

        const normalizedMobile = String(mobile).trim();
        const normalizedTelegram = (telegramId && String(telegramId).trim()) ? String(telegramId).trim() : null;

        const orConditions = [
            { walletId: normalizedWalletId },
            { mobile: normalizedMobile },
            { adminId: normalizedWalletId }
        ];
        if (normalizedTelegram) orConditions.push({ telegramId: normalizedTelegram });

        const existing = await Admin.findOne({ $or: orConditions });
        if (existing) {
            let field = 'Wallet ID';
            if (existing.mobile === normalizedMobile) field = 'Mobile';
            else if (normalizedTelegram && existing.telegramId === normalizedTelegram) field = 'Telegram ID';
            return res.status(400).json({ success: false, message: `${field} already exists.` });
        }

        const adminData = {
            adminId: normalizedWalletId,      // ← auto-set
            walletId: normalizedWalletId,
            password: password,
            fullName: String(fullName).trim(),
            mobile: normalizedMobile,
            role: finalRole,
            createdBy: req.user.walletId || 'system',
            isActive: true,
            isBlocked: false
        };

        if (email && String(email).trim()) {
            const normEmail = String(email).trim().toLowerCase();
            const emailExists = await Admin.findOne({ email: normEmail });
            if (emailExists) {
                return res.status(400).json({ success: false, message: 'Email already in use.' });
            }
            adminData.email = normEmail;
        }

        if (normalizedTelegram) adminData.telegramId = normalizedTelegram;

        const newAdmin = new Admin(adminData);
        await newAdmin.save();

        logSuccess(tag, 'Admin created', { walletId: newAdmin.walletId, adminId: newAdmin.adminId });

        // Notify: actor + all super_admins + new admin
        const actor = await getActorAdmin(req);
        await notifyAction(actor,
`🆕 <b>New Admin Created</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`👤 <b>Name:</b> ${newAdmin.fullName}\n` +
`💼 <b>Wallet ID:</b> ${newAdmin.walletId}\n` +
`📱 <b>Mobile:</b> ${newAdmin.mobile}\n` +
`📨 <b>Telegram:</b> ${newAdmin.telegramId || 'N/A'}\n` +
`🎭 <b>Role:</b> ${newAdmin.role}\n` +
`✍️ <b>Created By:</b> ${req.user.fullName || 'Admin'}\n\n` +
`🎉 Welcome to the team!`,
        { extraRecipients: [newAdmin.telegramId] }
        );

        res.json({
            success: true,
            message: 'Admin created successfully.',
            admin: {
                _id: newAdmin._id,
                adminId: newAdmin.adminId,
                walletId: newAdmin.walletId,
                fullName: newAdmin.fullName,
                mobile: newAdmin.mobile,
                email: newAdmin.email,
                telegramId: newAdmin.telegramId,
                role: newAdmin.role,
                isActive: newAdmin.isActive,
                isBlocked: newAdmin.isBlocked,
                createdAt: newAdmin.createdAt
            }
        });
    } catch (error) {
        logError(tag, 'CREATE FAILED', error);
        if (error.name === 'ValidationError' && error.errors) {
            const fieldErrors = Object.keys(error.errors).map(k => ({
                field: k, message: error.errors[k].message
            }));
            return res.status(400).json({
                success: false,
                message: 'Validation: ' + fieldErrors.map(f => `${f.field} - ${f.message}`).join(', '),
                errors: fieldErrors
            });
        }
        if (error.code === 11000) {
            const dupField = error.keyValue ? Object.keys(error.keyValue)[0] : 'field';
            return res.status(400).json({
                success: false,
                message: `Duplicate value for "${dupField}".`,
                duplicateField: dupField
            });
        }
        return res.status(500).json({
            success: false,
            message: 'Server error while creating admin.',
            debug: process.env.NODE_ENV !== 'production' ? error.message : undefined
        });
    }
});

// ============================================
// UPDATE ADMIN
// ============================================
router.put('/update-admin/:adminDbId', verifyAdminToken, async (req, res) => {
    const tag = 'UPDATE_ADMIN';
    logRequest(req, tag);
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }
        if (!mongoose.Types.ObjectId.isValid(req.params.adminDbId)) {
            return res.status(400).json({ success: false, message: 'Invalid admin ID.' });
        }

        const { fullName, mobile, email, telegramId, walletId, role, isActive, isBlocked, newPassword } = req.body;
        const admin = await Admin.findById(req.params.adminDbId);
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });

        const changes = [];

        if (fullName && fullName.trim() && fullName !== admin.fullName) {
            changes.push(`Name: ${admin.fullName} → ${fullName}`);
            admin.fullName = fullName.trim();
        }
        if (mobile && mobile !== admin.mobile) {
            if (!/^[0-9]{10}$/.test(mobile)) {
                return res.status(400).json({ success: false, message: 'Mobile must be 10 digits.' });
            }
            const dup = await Admin.findOne({ mobile, _id: { $ne: admin._id } });
            if (dup) return res.status(400).json({ success: false, message: 'Mobile already in use.' });
            changes.push(`Mobile: ${admin.mobile} → ${mobile}`);
            admin.mobile = mobile;
        }
        if (email !== undefined) {
            const newEmail = email ? String(email).trim().toLowerCase() : undefined;
            if (newEmail !== admin.email) {
                if (newEmail) {
                    const dup = await Admin.findOne({ email: newEmail, _id: { $ne: admin._id } });
                    if (dup) return res.status(400).json({ success: false, message: 'Email already in use.' });
                }
                changes.push(`Email changed`);
                admin.email = newEmail;
            }
        }
        if (telegramId !== undefined) {
            const tId = telegramId ? String(telegramId).trim() : undefined;
            if (tId !== admin.telegramId) {
                if (tId) {
                    const dup = await Admin.findOne({ telegramId: tId, _id: { $ne: admin._id } });
                    if (dup) return res.status(400).json({ success: false, message: 'Telegram ID already in use.' });
                }
                changes.push(`Telegram changed`);
                admin.telegramId = tId;
            }
        }
        if (walletId !== undefined) {
            const wId = walletId ? String(walletId).trim().toUpperCase() : undefined;
            if (wId && wId !== admin.walletId) {
                if (!/^[A-Z0-9_]{2,}$/.test(wId)) {
                    return res.status(400).json({ success: false, message: 'Invalid Wallet ID format.' });
                }
                const dup = await Admin.findOne({
                    $or: [{ walletId: wId }, { adminId: wId }],
                    _id: { $ne: admin._id }
                });
                if (dup) return res.status(400).json({ success: false, message: 'Wallet ID already in use.' });
                changes.push(`Wallet: ${admin.walletId} → ${wId}`);
                admin.walletId = wId;
                admin.adminId = wId;
            }
        }
        if (role) {
            const allowedRoles = ['admin', 'super_admin', 'moderator'];
            if (allowedRoles.indexOf(role) === -1) {
                return res.status(400).json({ success: false, message: 'Invalid role.' });
            }
            if (role !== admin.role) {
                changes.push(`Role: ${admin.role} → ${role}`);
                admin.role = role;
            }
        }
        if (typeof isActive === 'boolean' && isActive !== admin.isActive) {
            changes.push(`Active: ${admin.isActive} → ${isActive}`);
            admin.isActive = isActive;
        }
        if (typeof isBlocked === 'boolean' && isBlocked !== admin.isBlocked) {
            changes.push(`Blocked: ${admin.isBlocked} → ${isBlocked}`);
            admin.isBlocked = isBlocked;
        }
        if (newPassword) {
            if (newPassword.length < 6) {
                return res.status(400).json({ success: false, message: 'Password min 6 chars.' });
            }
            admin.password = newPassword;
            changes.push(`Password: CHANGED`);
        }

        if (changes.length === 0) {
            return res.json({ success: true, message: 'No changes.' });
        }

        admin.updatedBy = req.user.walletId;
        await admin.save();

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
`✏️ <b>Admin Updated</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`👤 <b>Target:</b> ${admin.fullName} (${admin.walletId})\n` +
`✍️ <b>By:</b> ${req.user.fullName}\n\n` +
`📋 <b>Changes (${changes.length}):</b>\n` +
changes.map(c => `  • ${c}`).join('\n'),
        { extraRecipients: [admin.telegramId] }
        );

        res.json({
            success: true,
            message: `Admin updated (${changes.length} change${changes.length > 1 ? 's' : ''}).`,
            changes
        });
    } catch (error) {
        logError(tag, 'Failed', error);
        if (error.code === 11000) {
            const dupField = error.keyValue ? Object.keys(error.keyValue)[0] : 'field';
            return res.status(400).json({ success: false, message: `Duplicate value for "${dupField}".` });
        }
        return res.status(500).json({ success: false, message: 'Failed: ' + error.message });
    }
});

// ============================================
// DELETE ADMIN
// ============================================
router.delete('/delete-admin/:adminDbId', verifyAdminToken, async (req, res) => {
    const tag = 'DELETE_ADMIN';
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }
        if (!mongoose.Types.ObjectId.isValid(req.params.adminDbId)) {
            return res.status(400).json({ success: false, message: 'Invalid admin ID.' });
        }
        const admin = await Admin.findById(req.params.adminDbId);
        if (!admin) return res.status(404).json({ success: false, message: 'Admin not found.' });

        if (admin._id.toString() === req.user.adminDbId) {
            return res.status(400).json({ success: false, message: 'Cannot delete yourself.' });
        }
        if (admin.role === 'super_admin') {
            const others = await Admin.countDocuments({
                role: 'super_admin',
                _id: { $ne: admin._id },
                isActive: true,
                isBlocked: false
            });
            if (others === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot delete the last active super admin.'
                });
            }
        }

        const deletedInfo = {
            fullName: admin.fullName,
            walletId: admin.walletId,
            mobile: admin.mobile,
            role: admin.role
        };
        await Admin.findByIdAndDelete(req.params.adminDbId);

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
`🗑️ <b>Admin Deleted</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`👤 <b>Name:</b> ${deletedInfo.fullName}\n` +
`💼 <b>Wallet ID:</b> ${deletedInfo.walletId}\n` +
`📱 <b>Mobile:</b> ${deletedInfo.mobile}\n` +
`🎭 <b>Role:</b> ${deletedInfo.role}\n` +
`✍️ <b>Deleted By:</b> ${req.user.fullName}\n\n` +
`⚠️ Account removed from system.`
        );

        res.json({ success: true, message: 'Admin deleted.' });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed: ' + error.message });
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
    try {
        const admin = await Admin.findOne({
            role: 'super_admin', isActive: true, isBlocked: false
        }).select('depositSettings').lean();

        const settings = (admin && admin.depositSettings)
            ? Object.assign({}, DEFAULT_DEPOSIT_SETTINGS, admin.depositSettings)
            : DEFAULT_DEPOSIT_SETTINGS;
        res.json({ success: true, settings });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.put('/deposit-settings', verifyAdminToken, async (req, res) => {
    const tag = 'DEPOSIT_SETTINGS_UPDATE';
    try {
        if (req.user.role !== 'super_admin') {
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
        if (!superAdmin) return res.status(404).json({ success: false, message: 'Super admin not found.' });

        await Admin.findByIdAndUpdate(superAdmin._id, { $set: update }, { new: true });

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
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
    try {
        const admin = await Admin.findOne({
            role: 'super_admin', isActive: true, isBlocked: false
        }).select('referralSettings').lean();

        const defaults = {
            enabled: true, bonusAmount: 10, minDepositAmount: 50, maxReferralsPerUser: 100
        };
        const settings = (admin && admin.referralSettings)
            ? Object.assign({}, defaults, admin.referralSettings)
            : defaults;
        res.json({ success: true, settings });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.put('/referral-settings', verifyAdminToken, async (req, res) => {
    const tag = 'REFERRAL_SETTINGS_UPDATE';
    try {
        if (req.user.role !== 'super_admin') {
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
        if (!superAdmin) return res.status(404).json({ success: false, message: 'Super admin not found.' });
        await Admin.findByIdAndUpdate(superAdmin._id, { $set: update }, { new: true });

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
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
// REFERRALS LIST
// ============================================
router.get('/referrals', verifyAdminToken, async (req, res) => {
    const tag = 'REFERRALS_LIST';
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
            .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean();
        const total = await Referral.countDocuments(query);
        const stats = await Referral.aggregate([{
            $group: {
                _id: null, total: { $sum: 1 },
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
        }]);
        res.json({
            success: true, referrals,
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
            count: t.count, totalEarned: t.totalEarned
        }));
        res.json({ success: true, leaderboard });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.put('/update-referral/:id', verifyAdminToken, async (req, res) => {
    const tag = 'UPDATE_REFERRAL';
    try {
        const { status, notes } = req.body;
        const referral = await Referral.findById(req.params.id);
        if (!referral) return res.status(404).json({ success: false, message: 'Not found.' });

        if (status) referral.status = status;
        if (notes !== undefined) referral.notes = notes;
        if (status === 'completed' && !referral.completedAt) referral.completedAt = new Date();
        await referral.save();

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
`✏️ <b>Referral Updated</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`🆔 <b>Referral ID:</b> ${referral._id}\n` +
`📊 <b>New Status:</b> ${status || 'unchanged'}\n` +
`✍️ <b>By:</b> ${req.user.fullName}`
        );

        res.json({ success: true, message: 'Updated.', referral });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.delete('/delete-referral/:id', verifyAdminToken, async (req, res) => {
    const tag = 'DELETE_REFERRAL';
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }
        const referral = await Referral.findByIdAndDelete(req.params.id);
        if (!referral) return res.status(404).json({ success: false, message: 'Not found.' });

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
`🗑️ <b>Referral Deleted</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`🆔 <b>Referral ID:</b> ${req.params.id}\n` +
`✍️ <b>By:</b> ${req.user.fullName}`
        );

        res.json({ success: true, message: 'Deleted.' });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.get('/user-referrals/:userId', verifyAdminToken, async (req, res) => {
    const tag = 'USER_REFERRALS';
    try {
        const userId = req.params.userId;
        const asReferrer = await Referral.find({ referrerId: userId })
            .populate('referredUserId', 'fullName mobile walletId')
            .sort({ createdAt: -1 }).lean();
        const asReferred = await Referral.findOne({ referredUserId: userId })
            .populate('referrerId', 'fullName mobile walletId referralCode').lean();
        res.json({ success: true, asReferrer, asReferred });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.post('/force-complete-referral/:id', verifyAdminToken, async (req, res) => {
    const tag = 'FORCE_COMPLETE_REFERRAL';
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }
        const referral = await Referral.findById(req.params.id);
        if (!referral) return res.status(404).json({ success: false, message: 'Referral not found.' });
        if (referral.status === 'completed') {
            return res.status(400).json({ success: false, message: 'Already completed.' });
        }
        const referrer = await User.findById(referral.referrerId);
        if (!referrer) return res.status(404).json({ success: false, message: 'Referrer not found.' });

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
            { $inc: { balance: bonusAmount, referralCount: 1, referralPendingCount: -1, referralEarnings: bonusAmount } }
        );

        const txnId = 'FORCE_REF_' + Date.now().toString(36).toUpperCase();
        await Transaction.create({
            user_id: referrer._id, sender_id: referrer._id, receiver_id: referrer._id,
            amount: bonusAmount, type: 'gift', status: 'success',
            remark: 'Referral bonus (Force-completed by admin)',
            description: 'Admin released referral bonus manually',
            tx_id: txnId, tx_time: now,
            metadata: { transactionType: 'referral_bonus_force', forceCompletedBy: req.user.fullName }
        });

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
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
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }
        const referral = await Referral.findById(req.params.id);
        if (!referral) return res.status(404).json({ success: false, message: 'Referral not found.' });
        if (referral.status !== 'completed') {
            return res.status(400).json({ success: false, message: 'Only completed can be reversed.' });
        }
        if (!referral.referrerBonusPaid) {
            return res.status(400).json({ success: false, message: 'Bonus not paid.' });
        }
        const referrer = await User.findById(referral.referrerId);
        if (!referrer) return res.status(404).json({ success: false, message: 'Referrer not found.' });

        const bonusAmount = referral.bonusAmount || 10;
        if (referrer.balance < bonusAmount) {
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
            { $inc: { balance: -bonusAmount, referralCount: -1, referralEarnings: -bonusAmount } }
        );

        const txnId = 'REV_REF_' + Date.now().toString(36).toUpperCase();
        await Transaction.create({
            user_id: referrer._id, sender_id: referrer._id, receiver_id: referrer._id,
            amount: bonusAmount, type: 'admin_deduct', status: 'success',
            remark: 'Referral bonus reversed',
            description: `Reversed by admin: ${reason}`,
            tx_id: txnId, tx_time: now,
            metadata: { transactionType: 'referral_bonus_reversed', reason }
        });

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
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
    try {
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Only super admin.' });
        }
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'No referral IDs provided.' });
        }
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
                    user_id: referrer._id, sender_id: referrer._id, receiver_id: referrer._id,
                    amount: bonusAmount, type: 'gift', status: 'success',
                    remark: 'Referral bonus (Bulk approved)',
                    tx_id: txnId, tx_time: now,
                    metadata: { transactionType: 'referral_bonus_bulk' }
                });
                completed++;
            } catch (err) { failed++; logError(tag, `Failed for ${id}`, err); }
        }

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
`📦 <b>Bulk Referral Approval</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`✅ <b>Completed:</b> ${completed}\n` +
`❌ <b>Failed:</b> ${failed}\n` +
`✍️ <b>By:</b> ${req.user.fullName}`
        );

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
    try {
        const totalUsers = await User.countDocuments({ isDeleted: { $ne: true } });
        const activeUsers = await User.countDocuments({ isBlocked: false, isDeleted: { $ne: true }, isActive: { $ne: false } });
        const blockedUsers = await User.countDocuments({ isBlocked: true, isDeleted: { $ne: true } });
        const deletedUsers = await User.countDocuments({ isDeleted: true });
        const approvedDeposits = await Deposit.countDocuments({ status: 'approved' });
        const pendingDeposits = await Deposit.countDocuments({ status: 'pending' });
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
            .sort({ createdAt: -1 }).limit(10);

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
            .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const total = await Transaction.countDocuments(query);
        res.json({
            success: true, transactions,
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
        res.json({
            success: true, users,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.get('/user/:identifier', verifyAdminToken, async (req, res) => {
    const tag = 'USER_DETAIL';
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
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
        const transactions = await Transaction.find({
            $or: [{ sender_id: user._id }, { receiver_id: user._id }, { user_id: user._id }]
        }).sort({ createdAt: -1 }).limit(100);
        res.json({ success: true, user, transactions });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.post('/toggle-block', verifyAdminToken, async (req, res) => {
    const tag = 'TOGGLE_BLOCK';
    try {
        const { userId, reason } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
        if (user.isBlocked) await user.unblockAccount();
        else await user.blockAccount(reason || 'Blocked by admin');
        const status = user.isBlocked ? 'Blocked' : 'Unblocked';

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
`🔒 <b>User ${status}</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`👤 <b>User:</b> ${user.fullName} (${user.mobile})\n` +
`💰 <b>Balance:</b> ₹${(user.balance || 0).toFixed(2)}\n` +
`📝 <b>Reason:</b> ${reason || 'N/A'}\n` +
`✍️ <b>By:</b> ${req.user.fullName}`
        );

        res.json({ success: true, message: `User ${status}.`, isBlocked: user.isBlocked });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.delete('/delete-user/:userId', verifyAdminToken, async (req, res) => {
    const tag = 'DELETE_USER';
    try {
        const userToDelete = await User.findById(req.params.userId);
        if (!userToDelete) return res.status(404).json({ success: false, message: 'User not found.' });
        if (userToDelete.isAdmin) {
            return res.status(400).json({ success: false, message: 'Cannot delete admin.' });
        }
        const info = { fullName: userToDelete.fullName, mobile: userToDelete.mobile, balance: userToDelete.balance };
        await userToDelete.softDelete(req.user.fullName || 'Admin');

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
`🗑️ <b>User Deleted</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`👤 <b>Name:</b> ${info.fullName}\n` +
`📱 <b>Mobile:</b> ${info.mobile}\n` +
`💰 <b>Balance:</b> ₹${(info.balance || 0).toFixed(2)}\n` +
`✍️ <b>By:</b> ${req.user.fullName}`
        );

        res.json({ success: true, message: `User "${userToDelete.fullName}" deleted.` });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.post('/restore-user/:userId', verifyAdminToken, async (req, res) => {
    const tag = 'RESTORE_USER';
    try {
        const user = await User.findById(req.params.userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
        if (!user.isDeleted) return res.status(400).json({ success: false, message: 'Not deleted.' });
        await user.restore();

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
`♻️ <b>User Restored</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`👤 <b>Name:</b> ${user.fullName}\n` +
`📱 <b>Mobile:</b> ${user.mobile}\n` +
`✍️ <b>By:</b> ${req.user.fullName}`
        );

        res.json({ success: true, message: `User "${user.fullName}" restored.` });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

// ============================================
// UPDATE USER
// ============================================
router.put('/update-user/:userId', verifyAdminToken, async (req, res) => {
    const tag = 'UPDATE_USER';
    try {
        const { userId } = req.params;
        const { fullName, mobile, email, walletId, password, pin, balance, telegramId, isBlocked, isActive } = req.body;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

        const changes = [];
        if (fullName && fullName.trim() && fullName !== user.fullName) {
            changes.push(`Name: ${user.fullName} → ${fullName}`);
            user.fullName = fullName.trim();
        }
        if (mobile && mobile !== user.mobile) {
            if (!/^[0-9]{10}$/.test(mobile)) {
                return res.status(400).json({ success: false, message: 'Mobile must be 10 digits.' });
            }
            const exists = await User.findOne({ mobile, _id: { $ne: user._id } });
            if (exists) return res.status(400).json({ success: false, message: 'Mobile already in use.' });
            changes.push(`Mobile: ${user.mobile} → ${mobile}`);
            user.mobile = mobile;
        }
        if (email !== undefined && email !== user.email) {
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(400).json({ success: false, message: 'Invalid email.' });
            }
            if (email) {
                const exists = await User.findOne({ email, _id: { $ne: user._id } });
                if (exists) return res.status(400).json({ success: false, message: 'Email already in use.' });
            }
            changes.push(`Email changed`);
            user.email = email || undefined;
        }
        if (walletId && walletId !== user.walletId) {
            const exists = await User.findOne({ walletId, _id: { $ne: user._id } });
            if (exists) return res.status(400).json({ success: false, message: 'Wallet ID already in use.' });
            changes.push(`Wallet: ${user.walletId} → ${walletId}`);
            user.walletId = walletId;
        }
        if (telegramId !== undefined && telegramId !== user.telegramId) {
            changes.push(`Telegram changed`);
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
            changes.push(`Balance: ₹${user.balance} → ₹${balance}`);
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

        if (changes.length === 0) return res.json({ success: true, message: 'No changes made.' });

        user.updatedBy = req.user.walletId;
        await user.save();

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
`✏️ <b>User Updated</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`👤 <b>User:</b> ${user.fullName} (${user.mobile})\n` +
`✍️ <b>By:</b> ${req.user.fullName}\n\n` +
`📋 <b>Changes (${changes.length}):</b>\n` +
changes.map(c => `  • ${c}`).join('\n')
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
    try {
        const { userId, amount, type, reason } = req.body;
        if (!userId || !amount || !type) {
            return res.status(400).json({ success: false, message: 'Missing fields.' });
        }
        if (!['add', 'deduct'].includes(type)) {
            return res.status(400).json({ success: false, message: 'Invalid type.' });
        }
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

        const amountNum = parseFloat(amount);
        if (type === 'deduct' && user.balance < amountNum) {
            return res.status(400).json({ success: false, message: `Insufficient balance. Current: ₹${user.balance}` });
        }

        const finalAmount = type === 'add' ? amountNum : -amountNum;
        user.balance += finalAmount;
        await user.save();

        const tx_id = `TXN${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 99999).toString().padStart(5, '0')}`;
        await Transaction.create({
            tx_id, user_id: user._id,
            sender_id: type === 'add' ? null : user._id,
            receiver_id: type === 'add' ? user._id : null,
            amount: amountNum, fee: 0,
            type: type === 'add' ? 'admin_add' : 'admin_deduct',
            status: 'success',
            remark: reason || 'No reason',
            description: `Admin ${type === 'add' ? 'added' : 'deducted'} ₹${amountNum}`
        });

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
`${type === 'add' ? '💰' : '💸'} <b>Balance ${type === 'add' ? 'Added' : 'Deducted'}</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`👤 <b>User:</b> ${user.fullName} (${user.mobile})\n` +
`💵 <b>Amount:</b> ₹${amountNum.toFixed(2)}\n` +
`💼 <b>New Balance:</b> ₹${user.balance.toFixed(2)}\n` +
`📝 <b>Reason:</b> ${reason || 'No reason'}\n` +
`✍️ <b>By:</b> ${req.user.fullName}`
        );

        res.json({ success: true, message: `Balance ${type === 'add' ? 'added' : 'deducted'}. New: ₹${user.balance}.`, newBalance: user.balance });
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
    try {
        const { status, page = 1, limit = 20 } = req.query;
        let query = {};
        if (status) query.status = status;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const deposits = await Deposit.find(query)
            .populate('userId', 'fullName mobile walletId balance')
            .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const total = await Deposit.countDocuments(query);
        res.json({
            success: true, deposits,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

router.get('/deposit/:id', verifyAdminToken, async (req, res) => {
    const tag = 'DEPOSIT_DETAIL';
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ success: false, message: 'Invalid deposit ID.' });
        }
        const deposit = await Deposit.findById(id)
            .populate('userId', 'fullName mobile walletId balance email').lean();
        if (!deposit) return res.status(404).json({ success: false, message: 'Deposit not found.' });
        res.json({ success: true, deposit });
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
    try {
        const { depositId, action, adminNotes } = req.body;
        const dateTime = getCurrentDateTime();

        if (!depositId) return res.status(400).json({ success: false, message: 'Deposit ID required.' });
        if (!action || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Invalid action.' });
        }

        const deposit = await Deposit.findById(depositId).populate('userId');
        if (!deposit) return res.status(404).json({ success: false, message: 'Deposit not found.' });
        if (deposit.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Status is "${deposit.status}". Only pending deposits can be verified.` });
        }

        if (action === 'approve') {
            const superAdmin = await Admin.findOne({
                role: 'super_admin', isActive: true, isBlocked: false
            }).select('depositSettings').lean();
            const depSettings = (superAdmin && superAdmin.depositSettings)
                ? Object.assign({}, DEFAULT_DEPOSIT_SETTINGS, superAdmin.depositSettings)
                : DEFAULT_DEPOSIT_SETTINGS;

            if (deposit.amount < depSettings.minDeposit) {
                return res.status(400).json({ success: false, message: `Below minimum deposit (₹${depSettings.minDeposit}).` });
            }
            if (deposit.amount > depSettings.maxDeposit) {
                return res.status(400).json({ success: false, message: `Exceeds maximum deposit (₹${depSettings.maxDeposit}).` });
            }

            let taxAmount = 0, creditAmount = deposit.amount, taxPercent = 0;
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

            const tx_id = `TXN_DEPOSIT_${Date.now().toString(36).toUpperCase()}_${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
            await Transaction.create({
                tx_id, user_id: deposit.userId._id,
                sender_id: deposit.userId._id, receiver_id: deposit.userId._id,
                amount: creditAmount, type: 'deposit', status: 'success',
                remark: taxAmount > 0
                    ? `Manual deposit approved (Tax ${taxPercent}%: ₹${taxAmount})`
                    : 'Manual deposit approved by admin',
                description: `Deposit ${deposit.depositId} approved`,
                metadata: {
                    depositId: deposit.depositId, originalAmount: deposit.amount,
                    taxPercent, taxAmount, creditAmount,
                    transactionRef: deposit.transactionRef,
                    approvedBy: req.user.fullName || 'Admin',
                    oldBalance, newBalance: user.balance
                }
            });

            let referralResult = null;
            try {
                referralResult = await safeProcessReferral(user, deposit.amount, dateTime);
            } catch (refErr) {
                logError(tag, 'Referral error', refErr);
            }

            // Notify: actor + super_admins
            const actor = await getActorAdmin(req);
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
            adminMsg += `\n✍️ <b>Approved By:</b> ${req.user.fullName}`;
            adminMsg += `\n🎉 Successfully approved!`;
            await notifyAction(actor, adminMsg);

            // User notification (personal)
            if (user.telegramId && BOT_TOKEN) {
                try {
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
                } catch (e) {}
            }

            await deposit.save();
            return res.json({
                success: true,
                message: 'Deposit approved successfully.',
                amount: deposit.amount, creditAmount, taxAmount,
                newBalance: user.balance, referral: referralResult
            });
        } else {
            deposit.status = 'rejected';
            deposit.rejectedBy = req.user.walletId || req.user.fullName;
            deposit.rejectedAt = new Date();
            deposit.adminNote = adminNotes || 'Rejected by admin';

            const actor = await getActorAdmin(req);
            await notifyAction(actor,
`❌ <b>Deposit Rejected</b>\n\n` +
`⏰ <b>Time:</b> ${dateTime}\n` +
`👤 <b>Name:</b> ${deposit.userId.fullName}\n` +
`💵 <b>Amount:</b> ₹${deposit.amount.toFixed(2)}\n` +
`📝 <b>Reason:</b> ${deposit.adminNote}\n` +
`✍️ <b>Rejected By:</b> ${req.user.fullName}\n\n` +
`⚠️ Deposit rejected by admin.`
            );

            if (deposit.userId.telegramId && BOT_TOKEN) {
                try {
                    await sendTelegramMessage(deposit.userId.telegramId,
`❌ <b>Deposit Rejected</b>\n\n` +
`⏰ <b>Time:</b> ${dateTime}\n` +
`💵 <b>Amount:</b> ₹${deposit.amount.toFixed(2)}\n` +
`📝 <b>Reason:</b> ${deposit.adminNote}\n\n` +
`💬 Need help? Contact admin.`
                    );
                } catch (e) {}
            }

            await deposit.save();
            return res.json({ success: true, message: 'Deposit rejected.', reason: deposit.adminNote });
        }
    } catch (error) {
        logError(tag, 'CRITICAL error', error);
        return res.status(500).json({ success: false, message: 'Failed: ' + error.message });
    }
});

// ============================================
// CANCEL DEPOSIT
// ============================================
router.post('/cancel-deposit', verifyAdminToken, async (req, res) => {
    const tag = 'CANCEL_DEPOSIT';
    try {
        const { depositId, reason } = req.body;
        if (!depositId) return res.status(400).json({ success: false, message: 'Deposit ID required.' });
        const deposit = await Deposit.findById(depositId).populate('userId');
        if (!deposit) return res.status(404).json({ success: false, message: 'Deposit not found.' });
        if (deposit.status !== 'pending') {
            return res.status(400).json({ success: false, message: `Cannot cancel deposit with status "${deposit.status}".` });
        }

        const dateTime = getCurrentDateTime();
        const cancelReason = reason || 'Cancelled by admin';
        deposit.status = 'cancelled';
        deposit.adminNote = cancelReason;
        deposit.cancelledAt = new Date();
        deposit.cancelledBy = req.user.walletId || req.user.fullName;
        await deposit.save();

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
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
            try {
                await sendTelegramMessage(deposit.userId.telegramId,
`🚫 <b>Deposit Cancelled</b>\n\n` +
`⏰ <b>Time:</b> ${dateTime}\n` +
`💵 <b>Amount:</b> ₹${deposit.amount.toFixed(2)}\n` +
`📄 <b>Deposit ID:</b> ${deposit.depositId}\n` +
`📝 <b>Reason:</b> ${cancelReason}\n\n` +
`💡 You can create a new deposit anytime.`
                );
            } catch (e) {}
        }

        res.json({ success: true, message: 'Deposit cancelled.', depositId: deposit.depositId });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed: ' + error.message });
    }
});

// ============================================
// SAFE REFERRAL PROCESSING
// ============================================
async function safeProcessReferral(user, depositAmount, dateTime) {
    const tag = 'SAFE_REFERRAL';
    try {
        if (!user.referredBy) return { processed: false, reason: 'User not referred' };

        const admin = await Admin.findOne({
            role: 'super_admin', isActive: true, isBlocked: false
        }).select('referralSettings').lean();
        const settings = (admin && admin.referralSettings) ? {
            enabled: admin.referralSettings.enabled !== false,
            bonusAmount: admin.referralSettings.bonusAmount || 10,
            minDepositAmount: admin.referralSettings.minDepositAmount || 50
        } : { enabled: true, bonusAmount: 10, minDepositAmount: 50 };

        if (!settings.enabled) return { processed: false, reason: 'Program disabled' };

        const pendingReferral = await Referral.findOne({
            referrerId: user.referredBy,
            referredUserId: user._id,
            status: 'pending'
        });
        if (!pendingReferral) return { processed: false, reason: 'No pending referral' };

        const requiredDeposit = settings.minDepositAmount;
        const previousDeposit = pendingReferral.depositAmount || 0;
        const newTotalDeposit = previousDeposit + depositAmount;

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
            if (!referrer) return { processed: false, reason: 'Referrer not found' };

            await User.updateOne(
                { _id: referrer._id },
                { $inc: { balance: bonusAmount, referralCount: 1, referralPendingCount: -1, referralEarnings: bonusAmount } }
            );

            const txnId = 'REF' + Math.random().toString(36).substring(2, 10).toUpperCase();
            await Transaction.create({
                user_id: referrer._id, sender_id: referrer._id, receiver_id: referrer._id,
                amount: bonusAmount, type: 'gift', status: 'success',
                remark: `Referral bonus from ${user.fullName || 'user'}`,
                description: `Friend's total deposit reached ₹${newTotalDeposit}`,
                tx_id: txnId + '-REF', tx_time: now,
                metadata: {
                    transactionType: 'referral_bonus_received',
                    referredUserId: user._id,
                    totalDepositAmount: newTotalDeposit,
                    bonusType: 'referrer_only'
                }
            });

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
                } catch (e) {}
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
                } catch (e) {}
            }

            return { processed: true, completed: true, bonusAmount, referrerName: referrer.fullName, totalDeposit: newTotalDeposit };
        } else {
            await pendingReferral.save();
            const remaining = requiredDeposit - newTotalDeposit;
            return { processed: true, completed: false, totalDeposit: newTotalDeposit, requiredDeposit, remaining };
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
    try {
        const { search, page = 1, limit = 20 } = req.query;
        let query = {};
        if (search) query.$or = [{ title: { $regex: search, $options: 'i' } }];
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const lifafas = await Lifafa.find(query)
            .populate('userId', 'fullName mobile')
            .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const total = await Lifafa.countDocuments(query);
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
    try {
        const lifafa = await Lifafa.findByIdAndDelete(req.params.id);
        if (!lifafa) return res.status(404).json({ success: false, message: 'Not found.' });

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
`🗑️ <b>Lifafa Deleted</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`📄 <b>ID:</b> ${req.params.id}\n` +
`💰 <b>Amount:</b> ₹${lifafa.amount || 0}\n` +
`✍️ <b>By:</b> ${req.user.fullName}`
        );

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
    try {
        const { search, page = 1, limit = 20 } = req.query;
        let query = {};
        if (search) query.code = { $regex: search, $options: 'i' };
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const gifts = await Gift.find(query)
            .populate('userId', 'fullName mobile')
            .sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
        const total = await Gift.countDocuments(query);
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
    try {
        const gift = await Gift.findByIdAndDelete(req.params.id);
        if (!gift) return res.status(404).json({ success: false, message: 'Not found.' });

        const actor = await getActorAdmin(req);
        await notifyAction(actor,
`🗑️ <b>Gift Deleted</b>\n\n` +
`⏰ <b>Time:</b> ${getCurrentDateTime()}\n` +
`🎁 <b>Code:</b> ${gift.code}\n` +
`💰 <b>Amount:</b> ₹${gift.amount || 0}\n` +
`✍️ <b>By:</b> ${req.user.fullName}`
        );

        res.json({ success: true, message: 'Deleted.' });
    } catch (error) {
        logError(tag, 'Failed', error);
        res.status(500).json({ success: false, message: 'Failed.' });
    }
});

module.exports = router;