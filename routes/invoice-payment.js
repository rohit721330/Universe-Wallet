// FILE: routes/invoice-payment.js
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Invoice = require('../models/Invoice');
const axios = require('axios');
require('dotenv').config();

// CONSTANTS
const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG = process.env.ADMIN_TG_ID;
const APP_URL = process.env.APP_URL || 'https://universal-wallet.vercel.app';
const ADMIN_UPI = process.env.ADMIN_UPI_ID || 'admin@upi';

// ============================================
// VERIFY TOKEN MIDDLEWARE
// ============================================
const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            return res.status(401).json({ success: false, message: 'No Token Provided' });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (!user) {
            return res.status(401).json({ success: false, message: 'User Not Found' });
        }
        
        req.user = user;
        next();
    } catch (error) {
        console.error('Token Verification Error:', error.message);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ success: false, message: 'Invalid Token. Please Login Again.' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Token Expired. Please Login Again.' });
        }
        return res.status(500).json({ success: false, message: 'Authentication Error' });
    }
};

// ============================================
// HELPER: Generate Public Invoice ID (8 characters)
// ============================================
function generatePublicInvoiceId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

// ============================================
// HELPER: Generate Transaction ID (10 characters)
// ============================================
function generateTransactionId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 10; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return 'TXN' + result;
}

// ============================================
// HELPER: Validate API Key
// ============================================
async function validateApiKey(apiKey) {
    try {
        const user = await User.findOne({ apiKey: apiKey });
        
        if (!user) {
            return { success: false, message: 'Invalid API Key' };
        }
        
        if (user.isBlocked) {
            return { success: false, message: 'Account Is Blocked' };
        }
        
        return { success: true, user: user };
    } catch (error) {
        console.error('API Key Validation Error:', error.message);
        return { success: false, message: 'Authentication Failed' };
    }
}

// ============================================
// HELPER: Send Message Via Telegram
// ============================================
async function sendTelegramMessage(chatId, message) {
    if (!BOT_TOKEN) {
        console.log('Bot Token Not Configured');
        return { success: false, error: 'BOT_TOKEN not configured' };
    }

    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        const response = await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        }, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && response.data.ok) {
            return { success: true };
        } else {
            return { success: false, error: response.data?.description || 'Unknown Error' };
        }
    } catch (error) {
        if (error.code === 'ECONNABORTED') {
            return { success: false, error: 'Telegram API Time Out' };
        }
        return { success: false, error: error.message };
    }
}

// ============================================
// HELPER: Send Telegram Message with Inline Button
// ============================================
async function sendTelegramMessageWithButton(chatId, message, buttonText, buttonUrl) {
    if (!BOT_TOKEN) {
        return { success: false, error: 'BOT_TOKEN not configured' };
    }

    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        const data = {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        };

        if (buttonText && buttonUrl) {
            data.reply_markup = {
                inline_keyboard: [[{ text: buttonText, url: buttonUrl }]]
            };
        }

        const response = await axios.post(url, data, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data && response.data.ok) {
            return { success: true };
        } else {
            return { success: false, error: response.data?.description };
        }
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ============================================
// HELPER: Notify User with Payment Link Button
// ============================================
async function notifyUserWithLink(chatId, message, invoiceId) {
    if (!chatId) return;
    
    const payLink = `${APP_URL}/invoice-pay?id=${invoiceId}`;
    
    try {
        await sendTelegramMessageWithButton(chatId, message, 'Pay Now', payLink);
    } catch (error) {
        console.error('Failed To Send User Notification With Link:', error.message);
    }
}

// ============================================
// HELPER: Notify Admin
// ============================================
async function notifyAdmin(message) {
    if (!ADMIN_TG) return;
    try {
        await sendTelegramMessage(ADMIN_TG, message);
    } catch (error) {
        console.error('Failed To Send Admin Notification:', error.message);
    }
}

// ============================================
// HELPER: Notify User (Regular)
// ============================================
async function notifyUser(chatId, message) {
    if (!chatId) return;
    try {
        await sendTelegramMessage(chatId, message);
    } catch (error) {
        console.error('Failed To Send User Notification:', error.message);
    }
}

// ============================================
// HELPER: Send Webhook
// ============================================
async function sendWebhook(invoice, event = 'invoice_paid') {
    const webhookUrl = invoice.metadata?.webhook;
    if (!webhookUrl) return;

    try {
        const statusMap = {
            'pending': 'WAITING',
            'paid': 'PAID',
            'expired': 'EXPIRED',
            'cancelled': 'CANCELLED'
        };

        const webhookData = {
            event: event,
            invoice_id: invoice.invoiceId,
            transaction_id: invoice.metadata?.transactionId || null,
            amount: invoice.amount,
            status: statusMap[invoice.status] || invoice.status,
            txt_id: invoice.metadata?.txt_id || null,
            remark: invoice.notes || '',
            webhook: invoice.metadata?.webhook || null,
            created_at: invoice.createdAt,
            expires_at: invoice.expiresAt,
            paid_at: invoice.paidAt || null,
            payment_ref: invoice.paymentRef || null,
            sender: {
                name: invoice.metadata?.senderName || null,
                mobile: invoice.metadata?.senderMobile || null,
                walletId: invoice.metadata?.senderWalletId || null
            },
            receiver: {
                name: invoice.metadata?.receiverName || null,
                mobile: invoice.metadata?.receiverMobile || null,
                walletId: invoice.metadata?.receiverWalletId || null
            }
        };

        await axios.post(webhookUrl, webhookData, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        });

    } catch (error) {
        console.error('Webhook Failed:', error.message);
    }
}

// ============================================
// HELPER: Get Current Date Time In IST
// ============================================
function getCurrentDateTime() {
    const now = new Date();
    return now.toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
}

// ============================================
// 1. CREATE INVOICE (User) - POST /api/invoice-payment/create
// ============================================
router.post('/create', verifyToken, async (req, res) => {
    try {
        const { amount, note, receiverMobile, webhook } = req.body;
        const sender = req.user;
        const dateTime = getCurrentDateTime();

        if (sender.mobile === receiverMobile) {
            return res.status(400).json({ success: false, message: 'You Cannot Create Invoice For Yourself' });
        }

        if (!amount || amount < 1) {
            return res.status(400).json({ success: false, message: 'Minimum Invoice Amount Is ₹1' });
        }

        if (amount > 5000) {
            return res.status(400).json({ success: false, message: 'Maximum Invoice Amount Is ₹5,000' });
        }

        if (!receiverMobile || !/^\d{10}$/.test(receiverMobile)) {
            return res.status(400).json({ success: false, message: 'Valid 10-Digit Receiver Mobile Required' });
        }

        if (webhook) {
            try { new URL(webhook); }
            catch (error) { return res.status(400).json({ success: false, message: 'Invalid Webhook URL' }); }
        }

        const receiver = await User.findOne({ mobile: receiverMobile });
        if (!receiver) {
            return res.status(404).json({ success: false, message: 'Receiver Not Found' });
        }

        if (receiver._id.toString() === sender._id.toString()) {
            return res.status(400).json({ success: false, message: 'You Cannot Send Invoice To Yourself' });
        }

        if (receiver.isBlocked) {
            return res.status(403).json({ success: false, message: 'Receiver Account Is Blocked' });
        }

        const existing = await Invoice.findOne({
            userId: receiver._id,
            status: 'pending',
            expiresAt: { $gt: new Date() }
        });

        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Receiver Has A Pending Invoice',
                invoice: {
                    invoiceId: existing.invoiceId,
                    amount: existing.amount,
                    expiresAt: existing.expiresAt
                }
            });
        }

        const transactionId = generateTransactionId();

        const invoice = await Invoice.createInvoice(
            sender._id,
            receiver._id,
            amount,
            note || 'Payment Request',
            { 
                source: 'web',
                senderMobile: sender.mobile,
                senderName: sender.fullName,
                senderWalletId: sender.walletId,
                receiverMobile: receiver.mobile,
                receiverName: receiver.fullName,
                receiverWalletId: receiver.walletId,
                webhook: webhook || null,
                transactionId: transactionId
            }
        );

        if (webhook) {
            await sendWebhook(invoice, 'invoice_created');
        }

        if (receiver.telegramId) {
            const receiverMessage = 
`New Invoice Received

Dear ${receiver.fullName || receiver.username},

You have received a payment request.

Amount: ₹${amount.toFixed(2)}
From: ${sender.fullName || sender.username} (${sender.walletId})
Invoice ID: ${invoice.invoiceId}
Transaction ID: ${transactionId}
Expires In: 5 Minutes
Note: ${note || 'Payment Request'}

Date: ${dateTime}`;

            await notifyUserWithLink(receiver.telegramId, receiverMessage, invoice.invoiceId);
        }

        await notifyAdmin(
`New Invoice Created

Sender: ${sender.fullName || sender.username}
Sender Wallet: ${sender.walletId}
Sender Mobile: ${sender.mobile}
Receiver: ${receiver.fullName || receiver.username}
Receiver Wallet: ${receiver.walletId}
Receiver Mobile: ${receiver.mobile}
Amount: ₹${amount.toFixed(2)}
Invoice ID: ${invoice.invoiceId}
Transaction ID: ${transactionId}
Expires In: 5 Minutes
Webhook: ${webhook || 'None'}

Date: ${dateTime}`
        );

        res.json({
            success: true,
            message: 'Invoice Created Successfully',
            invoice: {
                invoiceId: invoice.invoiceId,
                transactionId: transactionId,
                amount: invoice.amount,
                expiresAt: invoice.expiresAt,
                receiverName: receiver.fullName,
                receiverWalletId: receiver.walletId,
                receiverMobile: receiver.mobile,
                note: invoice.notes,
                remainingTime: invoice.getRemainingTime(),
                formattedRemainingTime: invoice.getFormattedRemainingTime(),
                webhook: webhook || null
            }
        });

    } catch (error) {
        console.error('Create Invoice Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Create Invoice: ' + error.message });
    }
});

// ============================================
// 2. GET INVOICE DETAILS - GET /api/invoice-payment/:invoiceId
// ============================================
router.get('/:invoiceId', async (req, res) => {
    try {
        const { invoiceId } = req.params;

        const invoice = await Invoice.findOne({ invoiceId })
            .populate('senderId', 'fullName username mobile walletId')
            .populate('userId', 'fullName username mobile walletId');

        if (!invoice) {
            return res.status(404).json({ success: false, message: 'Invoice Not Found' });
        }

        const senderData = invoice.senderId ? {
            _id: invoice.senderId._id,
            fullName: invoice.senderId.fullName,
            username: invoice.senderId.username,
            mobile: invoice.senderId.mobile,
            walletId: invoice.senderId.walletId
        } : null;

        const receiverData = invoice.userId ? {
            _id: invoice.userId._id,
            fullName: invoice.userId.fullName,
            username: invoice.userId.username,
            mobile: invoice.userId.mobile,
            walletId: invoice.userId.walletId
        } : null;

        res.json({
            success: true,
            invoice: {
                invoiceId: invoice.invoiceId,
                transactionId: invoice.metadata?.transactionId || null,
                amount: invoice.amount,
                status: invoice.status,
                statusLabel: invoice.statusLabel,
                expiresAt: invoice.expiresAt,
                createdAt: invoice.createdAt,
                notes: invoice.notes,
                sender: senderData,
                receiver: receiverData,
                isExpired: invoice.isExpired(),
                canBePaid: invoice.canBePaid(),
                remainingTime: invoice.getRemainingTime(),
                formattedRemainingTime: invoice.getFormattedRemainingTime(),
                paidAt: invoice.paidAt,
                webhook: invoice.metadata?.webhook || null,
                txt_id: invoice.metadata?.txt_id || null
            }
        });

    } catch (error) {
        console.error('Get Invoice Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Fetch Invoice: ' + error.message });
    }
});

// ============================================
// 3. PAY INVOICE - POST /api/invoice-payment/pay
// ============================================
router.post('/pay', verifyToken, async (req, res) => {
    try {
        const { invoiceId } = req.body;
        const payer = req.user;
        const dateTime = getCurrentDateTime();

        if (!invoiceId) {
            return res.status(400).json({ success: false, message: 'Invoice Id Is Required' });
        }

        const invoice = await Invoice.findOne({ invoiceId })
            .populate('senderId', 'fullName username mobile walletId')
            .populate('userId', 'fullName username mobile walletId');

        if (!invoice) {
            return res.status(404).json({ success: false, message: 'Invoice Not Found' });
        }

        if (invoice.senderId._id.toString() === payer._id.toString()) {
            return res.status(403).json({ success: false, message: 'You Cannot Pay Your Own Invoice' });
        }

        if (!invoice.canBePaid()) {
            return res.status(400).json({
                success: false,
                message: invoice.isExpired() ? 'Invoice Has Expired' : 'Invoice Cannot Be Paid'
            });
        }

        if (invoice.userId._id.toString() !== payer._id.toString()) {
            return res.status(403).json({ success: false, message: 'You Are Not The Receiver Of This Invoice' });
        }

        if (payer.balance < invoice.amount) {
            return res.status(400).json({
                success: false,
                message: `Insufficient Balance. Your Balance Is ₹${payer.balance.toFixed(2)}`
            });
        }

        const receiver = await User.findById(invoice.senderId._id);

        const session = await User.startSession();
        session.startTransaction();

        try {
            payer.balance -= invoice.amount;
            await payer.save({ session });

            receiver.balance += invoice.amount;
            await receiver.save({ session });

            await invoice.markAsPaid();

            // ✅ Capture balanceAfter for both users
            const payerBalanceAfter = payer.balance;
            const receiverBalanceAfter = receiver.balance;

            const transactionId = invoice.metadata?.transactionId || generateTransactionId();

            // Sender Transaction - invoice_pay_send
            await Transaction.create([{
                tx_id: transactionId,
                user_id: payer._id,
                sender_id: payer._id,
                receiver_id: receiver._id,
                amount: invoice.amount,
                type: 'invoice_pay_send',
                status: 'success',
                remark: `Invoice Payment - ${invoiceId}`,
                description: `Invoice ${invoiceId} Paid To ${receiver.fullName}`,
                tx_time: new Date(),
                metadata: {
                    invoiceId: invoiceId,
                    invoiceAmount: invoice.amount,
                    invoiceStatus: invoice.status,
                    transactionType: 'payment_sent',
                    senderName: payer.fullName,
                    senderWalletId: payer.walletId,
                    receiverName: receiver.fullName,
                    receiverWalletId: receiver.walletId,
                    senderMobile: payer.mobile,
                    receiverMobile: receiver.mobile,
                    note: invoice.notes || '',
                    type: 'invoice_pay_send',
                    method: 'Invoice',
                    category: 'Invoice sent',
                    balanceAfter: payerBalanceAfter
                }
            }], { session });

            // Receiver Transaction - invoice_pay_receive
            await Transaction.create([{
                tx_id: transactionId,
                user_id: receiver._id,
                sender_id: payer._id,
                receiver_id: receiver._id,
                amount: invoice.amount,
                type: 'invoice_pay_receive',
                status: 'success',
                remark: `Invoice Payment Received - ${invoiceId}`,
                description: `Invoice ${invoiceId} Paid By ${payer.fullName}`,
                tx_time: new Date(),
                metadata: {
                    invoiceId: invoiceId,
                    invoiceAmount: invoice.amount,
                    invoiceStatus: invoice.status,
                    transactionType: 'payment_received',
                    senderName: payer.fullName,
                    senderWalletId: payer.walletId,
                    receiverName: receiver.fullName,
                    receiverWalletId: receiver.walletId,
                    senderMobile: payer.mobile,
                    receiverMobile: receiver.mobile,
                    note: invoice.notes || '',
                    type: 'invoice_pay_receive',
                    method: 'Invoice',
                    category: 'Invoice received',
                    balanceAfter: receiverBalanceAfter
                }
            }], { session });

            await session.commitTransaction();
            session.endSession();

            await sendWebhook(invoice, 'invoice_paid');

            if (receiver.telegramId) {
                const receiverMessage = 
`Invoice Paid!

Dear ${receiver.fullName || receiver.username},

Your invoice has been paid successfully.

Amount: ₹${invoice.amount.toFixed(2)}
Paid By: ${payer.fullName || payer.username} (${payer.walletId})
Invoice ID: ${invoiceId}
Transaction ID: ${transactionId}
New Balance: ₹${receiver.balance.toFixed(2)}

Date: ${dateTime}`;

                await notifyUser(receiver.telegramId, receiverMessage);
            }

            if (payer.telegramId) {
                const payerMessage = 
`Invoice Payment Completed

Dear ${payer.fullName || payer.username},

Your invoice payment has been processed.

Amount: ₹${invoice.amount.toFixed(2)}
To: ${receiver.fullName || receiver.username} (${receiver.walletId})
Invoice ID: ${invoiceId}
Transaction ID: ${transactionId}
New Balance: ₹${payer.balance.toFixed(2)}

Payment completed successfully.`;

                await notifyUser(payer.telegramId, payerMessage);
            }

            await notifyAdmin(
`Invoice Payment Completed

Paid By: ${payer.fullName || payer.username}
Paid By Wallet: ${payer.walletId}
Paid By Mobile: ${payer.mobile}
Receiver: ${receiver.fullName || receiver.username}
Receiver Wallet: ${receiver.walletId}
Receiver Mobile: ${receiver.mobile}
Amount: ₹${invoice.amount.toFixed(2)}
Invoice ID: ${invoiceId}
Transaction ID: ${transactionId}
Webhook: ${invoice.metadata?.webhook || 'None'}

Date: ${dateTime}`
            );

            res.json({
                success: true,
                message: 'Invoice Paid Successfully',
                transaction: {
                    id: transactionId,
                    amount: invoice.amount,
                    type: 'invoice_payment'
                },
                newBalance: payer.balance,
                invoice: {
                    invoiceId: invoiceId,
                    status: 'paid',
                    webhook: invoice.metadata?.webhook || null,
                    sender: { fullName: receiver.fullName, walletId: receiver.walletId },
                    receiver: { fullName: payer.fullName, walletId: payer.walletId }
                }
            });

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            console.error('Payment Transaction Failed:', error.message);
            throw error;
        }

    } catch (error) {
        console.error('Pay Invoice Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Pay Invoice: ' + error.message });
    }
});

// ============================================
// 4. CANCEL INVOICE - POST /api/invoice-payment/cancel/:invoiceId
// ============================================
router.post('/cancel/:invoiceId', verifyToken, async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const user = req.user;
        const { reason } = req.body;
        const dateTime = getCurrentDateTime();

        const invoice = await Invoice.findOne({ invoiceId });

        if (!invoice) {
            return res.status(404).json({ success: false, message: 'Invoice Not Found' });
        }

        if (invoice.senderId.toString() !== user._id.toString() && 
            invoice.userId.toString() !== user._id.toString()) {
            return res.status(403).json({ success: false, message: 'Unauthorized To Cancel This Invoice' });
        }

        if (invoice.status === 'paid') {
            return res.status(400).json({ success: false, message: 'Cannot Cancel A Paid Invoice' });
        }

        if (invoice.status === 'cancelled') {
            return res.status(400).json({ success: false, message: 'Invoice Is Already Cancelled' });
        }

        await invoice.markAsCancelled(reason || 'Cancelled By User');

        await sendWebhook(invoice, 'invoice_cancelled');

        const sender = await User.findById(invoice.senderId);
        const receiver = await User.findById(invoice.userId);

        const cancelMessage = 
`Invoice Cancelled

Amount: ₹${invoice.amount.toFixed(2)}
Invoice ID: ${invoiceId}
Transaction ID: ${invoice.metadata?.transactionId || 'N/A'}
Reason: ${invoice.notes}

Date: ${dateTime}`;

        if (sender && sender.telegramId) await notifyUser(sender.telegramId, cancelMessage);
        if (receiver && receiver.telegramId) await notifyUser(receiver.telegramId, cancelMessage);

        res.json({
            success: true,
            message: 'Invoice Cancelled Successfully',
            invoice: {
                invoiceId: invoice.invoiceId,
                status: invoice.status,
                notes: invoice.notes
            }
        });

    } catch (error) {
        console.error('Cancel Invoice Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Cancel Invoice: ' + error.message });
    }
});

// ============================================
// 5. GET USER INVOICES - GET /api/invoice-payment/my-invoices
// ============================================
router.get('/my-invoices', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        const { status, limit = 20, page = 1 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const filter = {
            $or: [{ senderId: user._id }, { userId: user._id }]
        };

        if (status && status !== 'all') {
            filter.status = status;
        }

        const invoices = await Invoice.find(filter)
            .populate('senderId', 'fullName username mobile walletId')
            .populate('userId', 'fullName username mobile walletId')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Invoice.countDocuments(filter);

        res.json({
            success: true,
            invoices: invoices.map(inv => {
                const senderData = inv.senderId ? {
                    _id: inv.senderId._id,
                    fullName: inv.senderId.fullName,
                    username: inv.senderId.username,
                    mobile: inv.senderId.mobile,
                    walletId: inv.senderId.walletId
                } : null;

                const receiverData = inv.userId ? {
                    _id: inv.userId._id,
                    fullName: inv.userId.fullName,
                    username: inv.userId.username,
                    mobile: inv.userId.mobile,
                    walletId: inv.userId.walletId
                } : null;

                return {
                    invoiceId: inv.invoiceId,
                    transactionId: inv.metadata?.transactionId || null,
                    amount: inv.amount,
                    status: inv.status,
                    statusLabel: inv.statusLabel,
                    isExpired: inv.isExpired(),
                    canBePaid: inv.canBePaid(),
                    remainingTime: inv.getRemainingTime(),
                    formattedRemainingTime: inv.getFormattedRemainingTime(),
                    notes: inv.notes,
                    sender: senderData,
                    receiver: receiverData,
                    expiresAt: inv.expiresAt,
                    createdAt: inv.createdAt,
                    paidAt: inv.paidAt,
                    webhook: inv.metadata?.webhook || null,
                    txt_id: inv.metadata?.txt_id || null
                };
            }),
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            }
        });

    } catch (error) {
        console.error('Get My Invoices Error:', error.message);
        res.status(500).json({ success: false, message: 'Failed To Fetch Invoices: ' + error.message });
    }
});

// ============================================
// 6. PUBLIC: GET USER BY TELEGRAM ID
// ============================================
router.get('/public/user-by-telegram/:tgid', async (req, res) => {
    try {
        const { tgid } = req.params;

        if (!tgid) {
            return res.status(200).json({ success: false, message: 'Telegram Id Is Required' });
        }

        const user = await User.findOne({ telegramId: tgid });

        if (!user) {
            return res.status(200).json({ success: false, message: 'User Not Found' });
        }

        return res.status(200).json({
            success: true,
            mobile: user.mobile,
            fullName: user.fullName,
            walletId: user.walletId,
            balance: user.balance
        });

    } catch (error) {
        console.error('Get User By Telegram Error:', error);
        return res.status(200).json({ success: false, message: 'Server Error. Please Try Again.' });
    }
});

// ============================================
// 7. PUBLIC: GET USER BY API KEY
// ============================================
router.get('/user-by-apikey/:apiKey', async (req, res) => {
    try {
        const { apiKey } = req.params;

        if (!apiKey) {
            return res.status(200).json({ success: false, message: 'API Key Is Required' });
        }

        const user = await User.findOne({ apiKey: apiKey });

        if (!user) {
            return res.status(200).json({ success: false, message: 'User Not Found With This API Key' });
        }

        return res.status(200).json({
            success: true,
            mobile: user.mobile,
            fullName: user.fullName,
            walletId: user.walletId,
            balance: user.balance
        });

    } catch (error) {
        console.error('Get User By API Key Error:', error);
        return res.status(200).json({ success: false, message: 'Server Error. Please Try Again.' });
    }
});

// ============================================
// 8. PUBLIC: CREATE INVOICE
// ============================================
router.post('/public/create', async (req, res) => {
    try {
        const { 
            api_key, amount, webhook, txt_id, expire_after, remark,
            sender_mobile, sender_name, user_id
        } = req.body;

        if (!api_key) {
            return res.status(400).json({ ok: false, message: 'Missing API Key' });
        }

        const authResult = await validateApiKey(api_key);
        if (!authResult.success) {
            return res.status(401).json({ ok: false, message: authResult.message });
        }

        const receiver = authResult.user;

        let sender = null;
        
        if (sender_mobile) sender = await User.findOne({ mobile: sender_mobile });
        if (!sender && user_id) sender = await User.findOne({ telegramId: user_id });
        if (!sender && sender_name) sender = await User.findOne({ fullName: sender_name });
        if (!sender) sender = receiver;

        if (!amount || amount < 1) {
            return res.status(400).json({ ok: false, message: 'Minimum Invoice Amount Is ₹1' });
        }

        if (amount > 5000) {
            return res.status(400).json({ ok: false, message: 'Maximum Invoice Amount Is ₹5,000' });
        }

        if (webhook) {
            try { new URL(webhook); }
            catch (error) { return res.status(400).json({ ok: false, message: 'Invalid Webhook URL' }); }
        }

        let expireMinutes = parseInt(expire_after) || 30;
        if (expireMinutes < 15 || expireMinutes > 120) expireMinutes = 30;

        const invoiceId = generatePublicInvoiceId();
        const transactionId = generateTransactionId();
        const expiresAt = new Date(Date.now() + expireMinutes * 60 * 1000);

        const invoice = await Invoice.createPublicInvoice(
            sender._id,
            receiver._id,
            amount,
            {
                webhook: webhook || null,
                txt_id: txt_id || null,
                expire_after: expireMinutes,
                remark: remark || '',
                apiKey: api_key,
                senderMobile: sender.mobile,
                senderName: sender.fullName,
                senderWalletId: sender.walletId,
                receiverMobile: receiver.mobile,
                receiverName: receiver.fullName,
                receiverWalletId: receiver.walletId,
                transactionId: transactionId
            }
        );

        const payLink = `${APP_URL}/invoice-pay?id=${invoice.invoiceId}`;

        if (webhook) await sendWebhook(invoice, 'invoice_created');

        const dateTime = getCurrentDateTime();

        await notifyAdmin(
`Public API Invoice Created

Sender: ${sender.fullName}
Sender Wallet: ${sender.walletId}
Sender Mobile: ${sender.mobile}
Receiver: ${receiver.fullName}
Receiver Wallet: ${receiver.walletId}
Receiver Mobile: ${receiver.mobile}
Amount: ₹${amount.toFixed(2)}
Invoice ID: ${invoice.invoiceId}
Transaction ID: ${transactionId}
Pay Link: ${payLink}
Remark: ${remark || 'N/A'}
Webhook: ${webhook || 'None'}
Date: ${dateTime}`
        );

        if (sender.telegramId) {
            const userMessage = 
`Invoice Created

Amount: ₹${amount.toFixed(2)}
Invoice ID: ${invoice.invoiceId}
Transaction ID: ${transactionId}
Sender: ${sender.fullName} (${sender.walletId})
Receiver: ${receiver.fullName} (${receiver.walletId})
Expires In: ${expireMinutes} Minutes
Remark: ${remark || 'N/A'}

Date: ${dateTime}`;

            await notifyUserWithLink(sender.telegramId, userMessage, invoice.invoiceId);
        }

        res.json({
            ok: true,
            message: 'Invoice Created Successfully.',
            result: {
                invoice_id: invoice.invoiceId,
                transaction_id: transactionId,
                status: 'WAITING',
                amount: parseFloat(amount),
                txt_id: txt_id || null,
                remark: remark || '',
                webhook: webhook || null,
                payLink: payLink,
                sender: {
                    name: sender.fullName,
                    mobile: sender.mobile,
                    walletId: sender.walletId
                },
                receiver: {
                    name: receiver.fullName,
                    mobile: receiver.mobile,
                    walletId: receiver.walletId
                },
                created_at: dateTime,
                expires_at: new Date(expiresAt).toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                }),
                expire_after: expireMinutes
            }
        });

    } catch (error) {
        console.error('Public API Create Error:', error.message);
        res.status(500).json({ ok: false, message: 'Failed To Create Invoice: ' + error.message });
    }
});

// ============================================
// 9. PUBLIC: GET INVOICE STATUS
// ============================================
router.post('/public/status', async (req, res) => {
    try {
        const { invoice_id, api_key } = req.body;

        if (!invoice_id) {
            return res.status(400).json({ ok: false, message: 'Invoice Id Is Required' });
        }

        if (!api_key) {
            return res.status(400).json({ ok: false, message: 'Missing API Key' });
        }

        const authResult = await validateApiKey(api_key);
        if (!authResult.success) {
            return res.status(401).json({ ok: false, message: authResult.message });
        }

        const user = authResult.user;

        const invoice = await Invoice.findOne({ invoiceId: invoice_id })
            .populate('senderId', 'fullName mobile walletId')
            .populate('userId', 'fullName mobile walletId');

        if (!invoice) {
            return res.status(404).json({ ok: false, message: 'Invoice Not Found' });
        }

        if (invoice.userId._id.toString() !== user._id.toString()) {
            return res.status(403).json({ ok: false, message: 'You Are Not Authorized To View This Invoice' });
        }

        if (invoice.status === 'pending' && invoice.isExpired()) {
            await invoice.markAsExpired();
        }

        const statusMap = {
            'pending': 'WAITING',
            'paid': 'PAID',
            'expired': 'EXPIRED',
            'cancelled': 'CANCELLED'
        };

        const status = statusMap[invoice.status] || invoice.status;

        let paidAmount = '0.00';
        let remainingAmount = '0.00';
        let princeTxnId = null;
        let sender = null;

        if (invoice.status === 'paid') {
            const transaction = await Transaction.findOne({
                'metadata.invoiceId': invoice.invoiceId,
                type: 'invoice_pay_receive'
            });

            if (transaction) {
                princeTxnId = transaction.tx_id;
                paidAmount = invoice.amount.toFixed(2);
                remainingAmount = '0.00';
                const payer = await User.findById(transaction.sender_id);
                if (payer) sender = payer.mobile || payer.fullName;
            }
        }

        res.json({
            ok: true,
            message: 'Invoice Details Retrieved Successfully.',
            result: {
                invoice_id: invoice.invoiceId,
                transaction_id: invoice.metadata?.transactionId || null,
                sender: sender || null,
                receive_account: ADMIN_UPI,
                amount: invoice.amount.toFixed(2),
                txn_id: invoice.metadata?.txt_id || null,
                remark: invoice.notes || '',
                status: status,
                prince_txn_id: princeTxnId || null,
                webhook: invoice.metadata?.webhook || null,
                created_at: invoice.createdAt.toLocaleString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit'
                }),
                expire_after: invoice.metadata?.expire_after || 30,
                paid_amount: paidAmount,
                remaining_amount: remainingAmount
            }
        });

    } catch (error) {
        console.error('Public API Status Error:', error.message);
        res.status(500).json({ ok: false, message: 'Failed To Check Invoice Status: ' + error.message });
    }
});

// ============================================
// 10. PUBLIC: GET INVOICE STATUS (GET Method)
// ============================================
router.get('/public/status/:invoiceId', async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const { api_key } = req.query;

        const body = { invoice_id: invoiceId, api_key: api_key };
        req.body = body;
        return router.handle(req, res);
        
    } catch (error) {
        console.error('Public API Status (GET) Error:', error.message);
        res.status(500).json({ ok: false, message: 'Failed To Check Invoice Status: ' + error.message });
    }
});

// ============================================
// 11. PUBLIC: GET TRANSACTION DETAILS
// ============================================
router.get('/public/transaction/:txnId', async (req, res) => {
    try {
        const { txnId } = req.params;

        if (!txnId) {
            return res.status(200).json({ success: false, message: 'Transaction Id Is Required' });
        }

        const transaction = await Transaction.findOne({ tx_id: txnId })
            .populate('user_id', 'fullName username mobile walletId')
            .populate('sender_id', 'fullName username mobile walletId')
            .populate('receiver_id', 'fullName username mobile walletId');

        if (!transaction) {
            const invoice = await Invoice.findOne({ 'metadata.transactionId': txnId });
            if (invoice) {
                const txn = await Transaction.findOne({
                    'metadata.invoiceId': invoice.invoiceId,
                    type: 'invoice_pay_receive'
                })
                .populate('user_id', 'fullName username mobile walletId')
                .populate('sender_id', 'fullName username mobile walletId')
                .populate('receiver_id', 'fullName username mobile walletId');
                
                if (txn) {
                    return res.status(200).json({
                        success: true,
                        transaction: {
                            id: txn.tx_id,
                            amount: txn.amount,
                            type: txn.type,
                            typeLabel: txn.typeLabel,
                            status: txn.status,
                            remark: txn.remark,
                            description: txn.description,
                            time: txn.tx_time,
                            sender: txn.sender_id,
                            receiver: txn.receiver_id,
                            user: txn.user_id,
                            metadata: txn.metadata
                        }
                    });
                }
            }
            return res.status(200).json({ success: false, message: 'Transaction Not Found' });
        }

        return res.status(200).json({
            success: true,
            transaction: {
                id: transaction.tx_id,
                amount: transaction.amount,
                type: transaction.type,
                typeLabel: transaction.typeLabel,
                status: transaction.status,
                remark: transaction.remark,
                description: transaction.description,
                time: transaction.tx_time,
                sender: transaction.sender_id,
                receiver: transaction.receiver_id,
                user: transaction.user_id,
                metadata: transaction.metadata
            }
        });

    } catch (error) {
        console.error('Get Transaction Error:', error);
        return res.status(200).json({ success: false, message: 'Server Error. Please Try Again.' });
    }
});

module.exports = router;
