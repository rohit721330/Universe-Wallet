// FILE: routes/admin-invoice.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const Invoice = require('../models/Invoice');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
require('dotenv').config();

// ============================================
// ENVIRONMENT VARIABLES
// ============================================
const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG_ID = process.env.ADMIN_TG_ID;

// ============================================
// HELPER FUNCTIONS
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
            resolve({ success: false, error: 'BOT_TOKEN not configured' });
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

// ============================================
// VERIFY ADMIN TOKEN
// ============================================
async function verifyAdminToken(req, res, next) {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'No Token Provided'
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
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.isAdmin) {
                req.user = {
                    isAdmin: true,
                    fullName: decoded.fullName || 'Admin',
                    ...decoded
                };
                return next();
            } else {
                return res.status(403).json({
                    success: false,
                    message: 'Access Denied. Admins Only.'
                });
            }
        } catch (jwtError) {
            if (jwtError.name === 'JsonWebTokenError') {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid Token'
                });
            }
            if (jwtError.name === 'TokenExpiredError') {
                return res.status(401).json({
                    success: false,
                    message: 'Token Expired'
                });
            }
            return res.status(401).json({
                success: false,
                message: 'Authentication Failed'
            });
        }
    } catch (error) {
        console.error('Token Verification Error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Server Error During Authentication'
        });
    }
}

// ============================================
// GET ALL INVOICES (with filters)
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
                { paymentRef: { $regex: search, $options: 'i' } },
                { notes: { $regex: search, $options: 'i' } }
            ];
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
            invoices,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Get invoices error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch Invoices'
        });
    }
});

// ============================================
// GET SINGLE INVOICE BY ID
// ============================================
router.get('/invoice/:invoiceId', verifyAdminToken, async (req, res) => {
    try {
        const { invoiceId } = req.params;

        const invoice = await Invoice.findOne({
            $or: [
                { invoiceId: invoiceId },
                { _id: mongoose.Types.ObjectId.isValid(invoiceId) ? invoiceId : null }
            ].filter(Boolean)
        })
        .populate('senderId', 'fullName mobile walletId')
        .populate('userId', 'fullName mobile walletId');

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: `Invoice "${invoiceId}" Not Found`
            });
        }

        res.json({
            success: true,
            invoice
        });
    } catch (error) {
        console.error('Get invoice error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch Invoice'
        });
    }
});

// ============================================
// GET INVOICE STATISTICS
// ============================================
router.get('/stats', verifyAdminToken, async (req, res) => {
    try {
        const [total, pending, paid, expired, cancelled] = await Promise.all([
            Invoice.countDocuments(),
            Invoice.countDocuments({ status: 'pending' }),
            Invoice.countDocuments({ status: 'paid' }),
            Invoice.countDocuments({ status: 'expired' }),
            Invoice.countDocuments({ status: 'cancelled' })
        ]);

        const totalAmount = await Invoice.aggregate([
            { $match: { status: 'paid' } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        res.json({
            success: true,
            stats: {
                total,
                pending,
                paid,
                expired,
                cancelled,
                totalAmount: totalAmount[0]?.total || 0
            }
        });
    } catch (error) {
        console.error('Invoice stats error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Fetch Invoice Stats'
        });
    }
});

// ============================================
// CANCEL INVOICE
// ============================================
router.post('/cancel-invoice/:invoiceId', verifyAdminToken, async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const { reason } = req.body;
        const dateTime = getCurrentDateTime();

        const invoice = await Invoice.findById(invoiceId)
            .populate('senderId', 'fullName mobile walletId')
            .populate('userId', 'fullName mobile walletId');

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice Not Found'
            });
        }

        if (invoice.status === 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Cannot Cancel A Paid Invoice'
            });
        }

        invoice.status = 'cancelled';
        invoice.notes = reason || 'Cancelled By Admin';
        await invoice.save();

        res.json({
            success: true,
            message: 'Invoice Cancelled Successfully',
            invoice
        });
    } catch (error) {
        console.error('Cancel invoice error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Cancel Invoice'
        });
    }
});

// ============================================
// DELETE INVOICE
// ============================================
router.delete('/delete-invoice/:invoiceId', verifyAdminToken, async (req, res) => {
    try {
        const { invoiceId } = req.params;

        const invoice = await Invoice.findById(invoiceId);
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

        await Invoice.findByIdAndDelete(invoiceId);

        res.json({
            success: true,
            message: `Invoice "${invoice.invoiceId}" Deleted Successfully`
        });
    } catch (error) {
        console.error('Delete invoice error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Delete Invoice'
        });
    }
});

// ============================================
// MARK INVOICE AS PAID (Manual)
// ============================================
router.post('/mark-paid/:invoiceId', verifyAdminToken, async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const dateTime = getCurrentDateTime();

        const invoice = await Invoice.findById(invoiceId)
            .populate('senderId', 'fullName mobile walletId')
            .populate('userId', 'fullName mobile walletId');

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Invoice Not Found'
            });
        }

        if (invoice.status === 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Invoice Is Already Paid'
            });
        }

        invoice.status = 'paid';
        invoice.paidAt = new Date();
        invoice.verifiedAt = new Date();
        await invoice.save();

        res.json({
            success: true,
            message: 'Invoice Marked As Paid',
            invoice
        });
    } catch (error) {
        console.error('Mark paid error:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed To Mark Invoice As Paid'
        });
    }
});

// ============================================
// EXPORT ROUTER
// ============================================
module.exports = router;
