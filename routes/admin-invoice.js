// FILE: routes/admin-invoice.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const Invoice = require('../models/Invoice');
const Transaction = require('../models/Transaction');
const { auth } = require('../middleware/auth');
require('dotenv').config();

// ============================================
// TELEGRAM CONFIG
// ============================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TG_ID;

// ============================================
// HELPERS
// ============================================

function getCurrentDateTime() {
    const now = new Date();
    const options = {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    };
    return now.toLocaleString('en-IN', options);
}

async function sendTelegramMessage(chatId, message) {
    return new Promise((resolve) => {
        const https = require('https');
        if (!BOT_TOKEN) {
            console.warn('BOT_TOKEN Not Configured');
            resolve({ success: false, error: 'BOT_TOKEN Not Configured' });
            return;
        }
        
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        const data = JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        });
        
        const request = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        }, (res) => {
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(responseData);
                    resolve({ success: result.ok, error: result.description });
                } catch (e) {
                    resolve({ success: false, error: e.message });
                }
            });
        });
        
        request.on('error', (error) => {
            resolve({ success: false, error: error.message });
        });
        
        request.write(data);
        request.end();
    });
}

async function notifyAdmin(message) {
    if (!ADMIN_TELEGRAM_ID) return;
    try {
        await sendTelegramMessage(ADMIN_TELEGRAM_ID, message);
        console.log('Admin Notification Sent');
    } catch (error) {
        console.error('Admin Notification Failed:', error.message);
    }
}

// ============================================
// VERIFY ADMIN TOKEN MIDDLEWARE
// ============================================
async function verifyAdminToken(req, res, next) {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'No Token Provided. Please Login To Access This Resource.' 
            });
        }
        
        if (token.startsWith('Admin_')) {
            req.user = { 
                isAdmin: true, 
                fullName: 'Admin',
                tokenType: 'admin_token'
            };
            return next();
        }
        
        try {
            const jwt = require('jsonwebtoken');
            const JWT_SECRET = process.env.JWT_SECRET;
            const decoded = jwt.verify(token, JWT_SECRET);
            
            if (decoded.isAdmin) {
                req.user = { 
                    isAdmin: true, 
                    fullName: decoded.fullName || 'Admin',
                    tokenType: 'jwt',
                    ...decoded
                };
                return next();
            } else {
                return res.status(403).json({ 
                    success: false, 
                    message: 'Access Denied. This Resource Is Restricted To Admins Only.' 
                });
            }
        } catch (jwtError) {
            if (jwtError.name === 'JsonWebTokenError') {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Invalid Token Format. Please Login Again.' 
                });
            }
            if (jwtError.name === 'TokenExpiredError') {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Token Has Expired. Please Login Again To Refresh Your Session.' 
                });
            }
            return res.status(401).json({ 
                success: false, 
                message: 'Authentication Failed. Please Provide A Valid Token.' 
            });
        }
        
    } catch (error) {
        console.error('Token Verification Error:', error.message);
        return res.status(500).json({ 
            success: false, 
            message: 'Internal Server Error During Authentication.' 
        });
    }
}

// ============================================
// 1. GET ALL INVOICES
// ============================================
router.get('/invoices', verifyAdminToken, async (req, res) => {
    try {
        const { status, search, page = 1, limit = 20 } = req.query;
        let query = {};
        
        if (status && status !== 'all') {
            query.status = status;
        }
        
        if (search) {
            query.$or = [
                { invoiceId: { $regex: search, $options: 'i' } },
                { 'metadata.senderMobile': { $regex: search, $options: 'i' } },
                { 'metadata.receiverMobile': { $regex: search, $options: 'i' } }
            ];
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const invoices = await Invoice.find(query)
            .populate('senderId', 'fullName mobile walletId balance')
            .populate('userId', 'fullName mobile walletId balance')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
            
        const total = await Invoice.countDocuments(query);
        const stats = await Invoice.getStats();
        
        res.json({
            success: true,
            stats,
            invoices: invoices.map(inv => ({
                _id: inv._id,
                invoiceId: inv.invoiceId,
                senderId: inv.senderId,
                userId: inv.userId,
                amount: inv.amount,
                status: inv.status,
                statusLabel: inv.statusLabel,
                expiresAt: inv.expiresAt,
                createdAt: inv.createdAt,
                paidAt: inv.paidAt,
                verifiedAt: inv.verifiedAt,
                notes: inv.notes,
                metadata: inv.metadata,
                formattedAmount: inv.formattedAmount,
                isExpired: inv.isExpired(),
                canBePaid: inv.canBePaid(),
                remainingTime: inv.getRemainingTime(),
                formattedRemainingTime: inv.getFormattedRemainingTime()
            })),
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
        
    } catch (error) {
        console.error('Get Invoices Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch Invoices: ' + error.message
        });
    }
});

// ============================================
// 2. GET SINGLE INVOICE
// ============================================
router.get('/invoice/:invoiceId', verifyAdminToken, async (req, res) => {
    try {
        const { invoiceId } = req.params;
        
        const invoice = await Invoice.findOne({ invoiceId })
            .populate('senderId', 'fullName mobile walletId balance')
            .populate('userId', 'fullName mobile walletId balance');
        
        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice Not Found'
            });
        }
        
        res.json({
            success: true,
            invoice: {
                _id: invoice._id,
                invoiceId: invoice.invoiceId,
                senderId: invoice.senderId,
                userId: invoice.userId,
                amount: invoice.amount,
                formattedAmount: invoice.formattedAmount,
                status: invoice.status,
                statusLabel: invoice.statusLabel,
                expiresAt: invoice.expiresAt,
                createdAt: invoice.createdAt,
                paidAt: invoice.paidAt,
                verifiedAt: invoice.verifiedAt,
                notes: invoice.notes,
                metadata: invoice.metadata,
                isExpired: invoice.isExpired(),
                canBePaid: invoice.canBePaid(),
                remainingTime: invoice.getRemainingTime(),
                formattedRemainingTime: invoice.getFormattedRemainingTime()
            }
        });
        
    } catch (error) {
        console.error('Get Invoice Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch Invoice: ' + error.message
        });
    }
});

// ============================================
// 3. GET USER INVOICES
// ============================================
router.get('/user-invoices/:userId', verifyAdminToken, async (req, res) => {
    try {
        const { userId } = req.params;
        const { status, page = 1, limit = 20 } = req.query;
        
        const user = await User.findById(userId).select('fullName mobile walletId balance');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User Not Found'
            });
        }
        
        let query = {
            $or: [
                { senderId: userId },
                { userId: userId }
            ]
        };
        
        if (status && status !== 'all') {
            query.status = status;
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const invoices = await Invoice.find(query)
            .populate('senderId', 'fullName mobile walletId')
            .populate('userId', 'fullName mobile walletId')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));
            
        const total = await Invoice.countDocuments(query);
        
        res.json({
            success: true,
            user,
            invoices: invoices.map(inv => ({
                invoiceId: inv.invoiceId,
                amount: inv.amount,
                status: inv.status,
                statusLabel: inv.statusLabel,
                expiresAt: inv.expiresAt,
                createdAt: inv.createdAt,
                paidAt: inv.paidAt,
                formattedAmount: inv.formattedAmount,
                isExpired: inv.isExpired(),
                remainingTime: inv.getRemainingTime(),
                sender: inv.senderId,
                receiver: inv.userId,
                notes: inv.notes
            })),
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
        
    } catch (error) {
        console.error('Get User Invoices Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch User Invoices: ' + error.message
        });
    }
});

// ============================================
// 4. CLEANUP EXPIRED INVOICES
// ============================================
router.post('/cleanup', verifyAdminToken, async (req, res) => {
    try {
        console.log('Cleaning Up Expired Invoices');
        
        const result = await Invoice.cleanupExpired();
        
        res.json({
            success: true,
            message: `Cleaned Up ${result.modifiedCount} Expired Invoices`
        });
        
    } catch (error) {
        console.error('Cleanup Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Cleanup: ' + error.message
        });
    }
});

// ============================================
// 5. GET INVOICE STATS
// ============================================
router.get('/stats', verifyAdminToken, async (req, res) => {
    try {
        const stats = await Invoice.getStats();
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const todayInvoices = await Invoice.find({
            createdAt: { $gte: today, $lt: tomorrow }
        });
        
        const todayStats = {
            total: todayInvoices.length,
            paid: todayInvoices.filter(i => i.status === 'paid').length,
            pending: todayInvoices.filter(i => i.status === 'pending' && !i.isExpired()).length,
            amount: todayInvoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + i.amount, 0)
        };
        
        res.json({
            success: true,
            stats: {
                ...stats,
                today: todayStats
            }
        });
        
    } catch (error) {
        console.error('Get Stats Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Get Stats: ' + error.message
        });
    }
});

// ============================================
// 6. DELETE INVOICE
// ============================================
router.delete('/delete/:invoiceId', verifyAdminToken, async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const dateTime = getCurrentDateTime();
        
        console.log('Admin Deleting Invoice:', invoiceId);
        
        const invoice = await Invoice.findOne({ invoiceId });
        
        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice Not Found'
            });
        }
        
        if (invoice.status === 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Cannot Delete A Paid Invoice'
            });
        }
        
        const invoiceData = {
            invoiceId: invoice.invoiceId,
            amount: invoice.amount,
            status: invoice.status
        };
        
        await Invoice.findByIdAndDelete(invoice._id);
        
        const adminMessage = 
`Invoice Deleted

Invoice ID: ${invoiceData.invoiceId}
Amount: ₹${invoiceData.amount.toFixed(2)}
Status: ${invoiceData.status}
Admin: ${req.user.fullName || 'Admin'}
Time: ${dateTime}`;

        await notifyAdmin(adminMessage);
        
        res.json({
            success: true,
            message: 'Invoice Deleted Successfully'
        });
        
    } catch (error) {
        console.error('Delete Invoice Error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Delete Invoice: ' + error.message
        });
    }
});

module.exports = router;
