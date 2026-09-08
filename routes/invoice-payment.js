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
const APP_URL = process.env.APP_URL || 'https://prime-wallet-lifafa.vercel.app';
const ADMIN_UPI = process.env.ADMIN_UPI_ID || 'admin@upi';

// ============================================
// VERIFY TOKEN MIDDLEWARE
// ============================================
const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            console.log('❌ Nᴏ Tᴏᴋᴇɴ Pʀᴏᴠɪᴅᴇᴅ');
            return res.status(401).json({ 
                success: false, 
                message: 'Nᴏ Tᴏᴋᴇɴ Pʀᴏᴠɪᴅᴇᴅ' 
            });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (!user) {
            console.log('❌ Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ');
            return res.status(401).json({ 
                success: false, 
                message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ' 
            });
        }
        
        req.user = user;
        next();
    } catch (error) {
        console.error('❌ Tᴏᴋᴇɴ Vᴇʀɪꜰɪᴄᴀᴛɪᴏɴ Eʀʀᴏʀ:', error.message);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Iɴᴠᴀʟɪᴅ Tᴏᴋᴇɴ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ Aɢᴀɪɴ.' 
            });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Tᴏᴋᴇɴ Exᴘɪʀᴇᴅ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ Aɢᴀɪɴ.' 
            });
        }
        return res.status(500).json({ 
            success: false, 
            message: 'Aᴜᴛʜᴇɴᴛɪᴄᴀᴛɪᴏɴ Eʀʀᴏʀ' 
        });
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
            return { success: false, message: 'Iɴᴠᴀʟɪᴅ API Kᴇʏ' };
        }
        
        if (user.isBlocked) {
            return { success: false, message: 'Aᴄᴄᴏᴜɴᴛ Iꜱ Bʟᴏᴄᴋᴇᴅ' };
        }
        
        return { success: true, user: user };
    } catch (error) {
        console.error('❌ API Kᴇʏ Vᴀʟɪᴅᴀᴛɪᴏɴ Eʀʀᴏʀ:', error.message);
        return { success: false, message: 'Aᴜᴛʜᴇɴᴛɪᴄᴀᴛɪᴏɴ Fᴀɪʟᴇᴅ' };
    }
}

// ============================================
// HELPER: Send Message Via Telegram
// ============================================
async function sendTelegramMessage(chatId, message) {
    if (!BOT_TOKEN) {
        console.log('⚠️ Bᴏᴛ Tᴏᴋᴇɴ Nᴏᴛ Cᴏɴꜰɪɢᴜʀᴇᴅ');
        return { success: false, error: 'BOT_TOKEN not configured' };
    }

    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        console.log('📤 Sᴇɴᴅɪɴɢ Tᴇʟᴇɢʀᴀᴍ Mᴇꜱꜱᴀɢᴇ Tᴏ Cʜᴀᴛ:', chatId);
        
        const response = await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        }, {
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data && response.data.ok) {
            console.log('✅ Tᴇʟᴇɢʀᴀᴍ Mᴇꜱꜱᴀɢᴇ Sᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ Tᴏ Cʜᴀᴛ:', chatId);
            return { success: true };
        } else {
            console.error('❌ Tᴇʟᴇɢʀᴀᴍ API Rᴇꜱᴘᴏɴꜱᴇ:', response.data?.description || 'Uɴᴋɴᴏᴡɴ Eʀʀᴏʀ');
            return { success: false, error: response.data?.description || 'Uɴᴋɴᴏᴡɴ Eʀʀᴏʀ' };
        }
    } catch (error) {
        console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Tᴇʟᴇɢʀᴀᴍ Mᴇꜱꜱᴀɢᴇ:', error.message);
        if (error.code === 'ECONNABORTED') {
            return { success: false, error: 'Tᴇʟᴇɢʀᴀᴍ API Tɪᴍᴇ Oᴜᴛ' };
        }
        return { success: false, error: error.message };
    }
}

// ============================================
// HELPER: Send Telegram Message with Inline Button
// ============================================
async function sendTelegramMessageWithButton(chatId, message, buttonText, buttonUrl) {
    if (!BOT_TOKEN) {
        console.log('⚠️ Bᴏᴛ Tᴏᴋᴇɴ Nᴏᴛ Cᴏɴꜰɪɢᴜʀᴇᴅ');
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
                inline_keyboard: [
                    [
                        {
                            text: buttonText,
                            url: buttonUrl
                        }
                    ]
                ]
            };
        }

        console.log('📤 Sᴇɴᴅɪɴɢ Tᴇʟᴇɢʀᴀᴍ Mᴇꜱꜱᴀɢᴇ Wɪᴛʜ Bᴜᴛᴛᴏɴ Tᴏ Cʜᴀᴛ:', chatId);
        console.log('🔗 Bᴜᴛᴛᴏɴ URL:', buttonUrl);
        
        const response = await axios.post(url, data, {
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data && response.data.ok) {
            console.log('✅ Tᴇʟᴇɢʀᴀᴍ Mᴇꜱꜱᴀɢᴇ Wɪᴛʜ Bᴜᴛᴛᴏɴ Sᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ');
            return { success: true };
        } else {
            console.error('❌ Tᴇʟᴇɢʀᴀᴍ API Rᴇꜱᴘᴏɴꜱᴇ:', response.data?.description);
            return { success: false, error: response.data?.description };
        }
    } catch (error) {
        console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Tᴇʟᴇɢʀᴀᴍ Mᴇꜱꜱᴀɢᴇ Wɪᴛʜ Bᴜᴛᴛᴏɴ:', error.message);
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
        await sendTelegramMessageWithButton(
            chatId,
            message,
            '💳 Pᴀʏ Nᴏᴡ',
            payLink
        );
        console.log('✅ Uꜱᴇʀ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Wɪᴛʜ Pᴀʏ Lɪɴᴋ Sᴇɴᴛ');
    } catch (error) {
        console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Uꜱᴇʀ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Wɪᴛʜ Lɪɴᴋ:', error.message);
    }
}

// ============================================
// HELPER: Notify Admin
// ============================================
async function notifyAdmin(message) {
    if (!ADMIN_TG) {
        console.log('⚠️ Aᴅᴍɪɴ Tᴇʟᴇɢʀᴀᴍ Iᴅ Nᴏᴛ Cᴏɴꜰɪɢᴜʀᴇᴅ');
        return;
    }
    try {
        await sendTelegramMessage(ADMIN_TG, message);
        console.log('✅ Aᴅᴍɪɴ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Sᴇɴᴛ');
    } catch (error) {
        console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Aᴅᴍɪɴ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ:', error.message);
    }
}

// ============================================
// HELPER: Notify User (Regular - Without Button)
// ============================================
async function notifyUser(chatId, message) {
    if (!chatId) return;
    try {
        await sendTelegramMessage(chatId, message);
        console.log('✅ Uꜱᴇʀ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Sᴇɴᴛ');
    } catch (error) {
        console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Uꜱᴇʀ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ:', error.message);
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

        console.log('✅ Wᴇʙʜᴏᴏᴋ Sᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ Tᴏ:', webhookUrl);

    } catch (error) {
        console.error('❌ Wᴇʙʜᴏᴏᴋ Fᴀɪʟᴇᴅ:', error.message);
    }
}

// ============================================
// HELPER: Get Current Date Time In IST
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

// ============================================
// 1. CREATE INVOICE (User) - POST /api/invoice-payment/create
// ============================================
router.post('/create', verifyToken, async (req, res) => {
    try {
        const { amount, note, receiverMobile, webhook } = req.body;
        const sender = req.user;
        const dateTime = getCurrentDateTime();

        console.log('📝 Cʀᴇᴀᴛɪɴɢ Iɴᴠᴏɪᴄᴇ Rᴇǫᴜᴇꜱᴛ:', {
            Sᴇɴᴅᴇʀ: sender.mobile,
            Aᴍᴏᴜɴᴛ: amount,
            Rᴇᴄᴇɪᴠᴇʀ: receiverMobile,
            Wᴇʙʜᴏᴏᴋ: webhook || 'Nᴏɴᴇ'
        });

        if (sender.mobile === receiverMobile) {
            return res.status(400).json({
                success: false,
                message: 'Yᴏᴜ Cᴀɴɴᴏᴛ Cʀᴇᴀᴛᴇ Iɴᴠᴏɪᴄᴇ Fᴏʀ Yᴏᴜʀꜱᴇʟꜰ'
            });
        }

        if (!amount || amount < 1) {
            return res.status(400).json({
                success: false,
                message: 'Mɪɴɪᴍᴜᴍ Iɴᴠᴏɪᴄᴇ Aᴍᴏᴜɴᴛ Iꜱ ₹1'
            });
        }

        if (amount > 5000) {
            return res.status(400).json({
                success: false,
                message: 'Mᴀxɪᴍᴜᴍ Iɴᴠᴏɪᴄᴇ Aᴍᴏᴜɴᴛ Iꜱ ₹5,000'
            });
        }

        if (!receiverMobile || !/^\d{10}$/.test(receiverMobile)) {
            return res.status(400).json({
                success: false,
                message: 'Vᴀʟɪᴅ 10-Dɪɢɪᴛ Rᴇᴄᴇɪᴠᴇʀ Mᴏʙɪʟᴇ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        if (webhook) {
            try {
                new URL(webhook);
            } catch (error) {
                return res.status(400).json({
                    success: false,
                    message: 'Iɴᴠᴀʟɪᴅ Wᴇʙʜᴏᴏᴋ URL'
                });
            }
        }

        const receiver = await User.findOne({ mobile: receiverMobile });
        if (!receiver) {
            return res.status(404).json({
                success: false,
                message: 'Rᴇᴄᴇɪᴠᴇʀ Nᴏᴛ Fᴏᴜɴᴅ'
            });
        }

        if (receiver._id.toString() === sender._id.toString()) {
            return res.status(400).json({
                success: false,
                message: 'Yᴏᴜ Cᴀɴɴᴏᴛ Sᴇɴᴅ Iɴᴠᴏɪᴄᴇ Tᴏ Yᴏᴜʀꜱᴇʟꜰ'
            });
        }

        if (receiver.isBlocked) {
            return res.status(403).json({
                success: false,
                message: 'Rᴇᴄᴇɪᴠᴇʀ Aᴄᴄᴏᴜɴᴛ Iꜱ Bʟᴏᴄᴋᴇᴅ'
            });
        }

        const existing = await Invoice.findOne({
            userId: receiver._id,
            status: 'pending',
            expiresAt: { $gt: new Date() }
        });

        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Rᴇᴄᴇɪᴠᴇʀ Hᴀꜱ A Pᴇɴᴅɪɴɢ Iɴᴠᴏɪᴄᴇ',
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
            note || 'Pᴀʏᴍᴇɴᴛ Rᴇǫᴜᴇꜱᴛ',
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

        console.log('✅ Iɴᴠᴏɪᴄᴇ Cʀᴇᴀᴛᴇᴅ:', invoice.invoiceId);
        console.log('✅ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ:', transactionId);

        if (webhook) {
            await sendWebhook(invoice, 'invoice_created');
        }

        if (receiver.telegramId) {
            const receiverMessage = 
`<b>─────────────────</b>
<b>📄 Nᴇᴡ Iɴᴠᴏɪᴄᴇ Rᴇᴄᴇɪᴠᴇᴅ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${receiver.fullName || receiver.username},</b>
Yᴏᴜ Hᴀᴠᴇ Rᴇᴄᴇɪᴠᴇᴅ A Pᴀʏᴍᴇɴᴛ Rᴇǫᴜᴇꜱᴛ.

💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${amount.toFixed(2)}
👤 <b>Fʀᴏᴍ:</b> ${sender.fullName || sender.username} (${sender.walletId})
🆔 <b>Iɴᴠᴏɪᴄᴇ Iᴅ:</b> ${invoice.invoiceId}
🔢 <b>Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ:</b> ${transactionId}
⏰ <b>Exᴘɪʀᴇꜱ Iɴ:</b> 5 Mɪɴᴜᴛᴇꜱ
📝 <b>Nᴏᴛᴇ:</b> ${note || 'Pᴀʏᴍᴇɴᴛ Rᴇǫᴜᴇꜱᴛ'}

───────────────────────
📅 <code>${dateTime}</code>
───────────────────────`;

            await notifyUserWithLink(
                receiver.telegramId,
                receiverMessage,
                invoice.invoiceId
            );
        }

        const adminMessage = 
`<b>─────────────────</b>
<b>📄 Nᴇᴡ Iɴᴠᴏɪᴄᴇ Cʀᴇᴀᴛᴇᴅ</b>
<b>─────────────────</b>

👤 Sᴇɴᴅᴇʀ: <code>${sender.fullName || sender.username}</code>
💳 Sᴇɴᴅᴇʀ Wᴀʟʟᴇᴛ: <code>${sender.walletId}</code>
📱 Sᴇɴᴅᴇʀ Mᴏʙɪʟᴇ: <code>${sender.mobile}</code>
👤 Rᴇᴄᴇɪᴠᴇʀ: <code>${receiver.fullName || receiver.username}</code>
💳 Rᴇᴄᴇɪᴠᴇʀ Wᴀʟʟᴇᴛ: <code>${receiver.walletId}</code>
📱 Rᴇᴄᴇɪᴠᴇʀ Mᴏʙɪʟᴇ: <code>${receiver.mobile}</code>
💰 Aᴍᴏᴜɴᴛ: <b>₹${amount.toFixed(2)}</b>
🆔 Iɴᴠᴏɪᴄᴇ Iᴅ: <code>${invoice.invoiceId}</code>
🔢 Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ: <code>${transactionId}</code>
⏰ Exᴘɪʀᴇꜱ Iɴ: 5 Mɪɴᴜᴛᴇꜱ
🔗 Wᴇʙʜᴏᴏᴋ: ${webhook || 'Nᴏɴᴇ'}

───────────────────────
📅 <code>${dateTime}</code>
───────────────────────`;

        await notifyAdmin(adminMessage);

        res.json({
            success: true,
            message: 'Iɴᴠᴏɪᴄᴇ Cʀᴇᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ',
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
        console.error('❌ Cʀᴇᴀᴛᴇ Iɴᴠᴏɪᴄᴇ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Cʀᴇᴀᴛᴇ Iɴᴠᴏɪᴄᴇ: ' + error.message
        });
    }
});

// ============================================
// 2. GET INVOICE DETAILS - GET /api/invoice-payment/:invoiceId
// ============================================
router.get('/:invoiceId', async (req, res) => {
    try {
        const { invoiceId } = req.params;

        console.log('🔍 Fᴇᴛᴄʜɪɴɢ Iɴᴠᴏɪᴄᴇ:', invoiceId);

        const invoice = await Invoice.findOne({ invoiceId })
            .populate('senderId', 'fullName username mobile walletId')
            .populate('userId', 'fullName username mobile walletId');

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Iɴᴠᴏɪᴄᴇ Nᴏᴛ Fᴏᴜɴᴅ'
            });
        }

        // ✅ সঠিকভাবে sender ও receiver তৈরি করা walletId সহ
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
        console.error('❌ Gᴇᴛ Iɴᴠᴏɪᴄᴇ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Iɴᴠᴏɪᴄᴇ: ' + error.message
        });
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

        console.log('💳 Pᴀʏɪɴɢ Iɴᴠᴏɪᴄᴇ:', { invoiceId, Payer: payer.mobile });

        if (!invoiceId) {
            return res.status(400).json({
                success: false,
                message: 'Iɴᴠᴏɪᴄᴇ Iᴅ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        const invoice = await Invoice.findOne({ invoiceId })
            .populate('senderId', 'fullName username mobile walletId')
            .populate('userId', 'fullName username mobile walletId');

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Iɴᴠᴏɪᴄᴇ Nᴏᴛ Fᴏᴜɴᴅ'
            });
        }

        if (invoice.senderId._id.toString() === payer._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Yᴏᴜ Cᴀɴɴᴏᴛ Pᴀʏ Yᴏᴜʀ Oᴡɴ Iɴᴠᴏɪᴄᴇ'
            });
        }

        if (!invoice.canBePaid()) {
            return res.status(400).json({
                success: false,
                message: invoice.isExpired() ? 'Iɴᴠᴏɪᴄᴇ Hᴀꜱ Exᴘɪʀᴇᴅ' : 'Iɴᴠᴏɪᴄᴇ Cᴀɴɴᴏᴛ Bᴇ Pᴀɪᴅ'
            });
        }

        if (invoice.userId._id.toString() !== payer._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Yᴏᴜ Aʀᴇ Nᴏᴛ Tʜᴇ Rᴇᴄᴇɪᴠᴇʀ Oꜰ Tʜɪꜱ Iɴᴠᴏɪᴄᴇ'
            });
        }

        if (payer.balance < invoice.amount) {
            return res.status(400).json({
                success: false,
                message: `Iɴꜱᴜꜰꜰɪᴄɪᴇɴᴛ Bᴀʟᴀɴᴄᴇ. Yᴏᴜʀ Bᴀʟᴀɴᴄᴇ Iꜱ ₹${payer.balance.toFixed(2)}`
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
                remark: `Iɴᴠᴏɪᴄᴇ Pᴀʏᴍᴇɴᴛ - ${invoiceId}`,
                description: `Iɴᴠᴏɪᴄᴇ ${invoiceId} Pᴀɪᴅ Tᴏ ${receiver.fullName}`,
                tx_time: new Date(),
                metadata: {
                    invoiceId: invoiceId,
                    invoiceAmount: invoice.amount,
                    invoiceStatus: invoice.status,
                    transactionType: 'invoice_payment_sent',
                    senderName: payer.fullName,
                    senderWalletId: payer.walletId,
                    receiverName: receiver.fullName,
                    receiverWalletId: receiver.walletId,
                    senderMobile: payer.mobile,
                    receiverMobile: receiver.mobile,
                    note: invoice.notes || '',
                    type: 'invoice_pay_send'
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
                remark: `Iɴᴠᴏɪᴄᴇ Pᴀʏᴍᴇɴᴛ Rᴇᴄᴇɪᴠᴇᴅ - ${invoiceId}`,
                description: `Iɴᴠᴏɪᴄᴇ ${invoiceId} Pᴀɪᴅ Bʏ ${payer.fullName}`,
                tx_time: new Date(),
                metadata: {
                    invoiceId: invoiceId,
                    invoiceAmount: invoice.amount,
                    invoiceStatus: invoice.status,
                    transactionType: 'invoice_payment_received',
                    senderName: payer.fullName,
                    senderWalletId: payer.walletId,
                    receiverName: receiver.fullName,
                    receiverWalletId: receiver.walletId,
                    senderMobile: payer.mobile,
                    receiverMobile: receiver.mobile,
                    note: invoice.notes || '',
                    type: 'invoice_pay_receive'
                }
            }], { session });

            await session.commitTransaction();
            session.endSession();

            console.log('✅ Iɴᴠᴏɪᴄᴇ Pᴀɪᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ:', invoiceId);
            console.log('✅ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ:', transactionId);

            await sendWebhook(invoice, 'invoice_paid');

            if (receiver.telegramId) {
                const receiverMessage = 
`<b>─────────────────</b>
<b>✅ Iɴᴠᴏɪᴄᴇ Pᴀɪᴅ!</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${receiver.fullName || receiver.username},</b>
Yᴏᴜʀ Iɴᴠᴏɪᴄᴇ Hᴀꜱ Bᴇᴇɴ Pᴀɪᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ.

💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${invoice.amount.toFixed(2)}
👤 <b>Pᴀɪᴅ Bʏ:</b> ${payer.fullName || payer.username} (${payer.walletId})
🆔 <b>Iɴᴠᴏɪᴄᴇ Iᴅ:</b> ${invoiceId}
🔢 <b>Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ:</b> ${transactionId}
💳 <b>Nᴇᴡ Bᴀʟᴀɴᴄᴇ:</b> ₹${receiver.balance.toFixed(2)}

───────────────────────
📅 <code>${dateTime}</code>
───────────────────────`;

                await notifyUser(receiver.telegramId, receiverMessage);
            }

            if (payer.telegramId) {
                const payerMessage = 
`<b>─────────────────</b>
<b>💸 Iɴᴠᴏɪᴄᴇ Pᴀʏᴍᴇɴᴛ Cᴏᴍᴘʟᴇᴛᴇᴅ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${payer.fullName || payer.username},</b>
Yᴏᴜʀ Iɴᴠᴏɪᴄᴇ Pᴀʏᴍᴇɴᴛ Hᴀꜱ Bᴇᴇɴ Pʀᴏᴄᴇꜱꜱᴇᴅ.

💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${invoice.amount.toFixed(2)}
👤 <b>Tᴏ:</b> ${receiver.fullName || receiver.username} (${receiver.walletId})
🆔 <b>Iɴᴠᴏɪᴄᴇ Iᴅ:</b> ${invoiceId}
🔢 <b>Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ:</b> ${transactionId}
💳 <b>Nᴇᴡ Bᴀʟᴀɴᴄᴇ:</b> ₹${payer.balance.toFixed(2)}

───────────────────────
✅ Pᴀʏᴍᴇɴᴛ Cᴏᴍᴘʟᴇᴛᴇᴅ
───────────────────────`;

                await notifyUser(payer.telegramId, payerMessage);
            }

            const adminMessage = 
`<b>─────────────────</b>
<b>✅ Iɴᴠᴏɪᴄᴇ Pᴀʏᴍᴇɴᴛ Cᴏᴍᴘʟᴇᴛᴇᴅ</b>
<b>─────────────────</b>

👤 Pᴀɪᴅ Bʏ: <code>${payer.fullName || payer.username}</code>
💳 Pᴀɪᴅ Bʏ Wᴀʟʟᴇᴛ: <code>${payer.walletId}</code>
📱 Pᴀɪᴅ Bʏ Mᴏʙɪʟᴇ: <code>${payer.mobile}</code>
👤 Rᴇᴄᴇɪᴠᴇʀ: <code>${receiver.fullName || receiver.username}</code>
💳 Rᴇᴄᴇɪᴠᴇʀ Wᴀʟʟᴇᴛ: <code>${receiver.walletId}</code>
📱 Rᴇᴄᴇɪᴠᴇʀ Mᴏʙɪʟᴇ: <code>${receiver.mobile}</code>
💰 Aᴍᴏᴜɴᴛ: <b>₹${invoice.amount.toFixed(2)}</b>
🆔 Iɴᴠᴏɪᴄᴇ Iᴅ: <code>${invoiceId}</code>
🔢 Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ: <code>${transactionId}</code>
🔗 Wᴇʙʜᴏᴏᴋ: ${invoice.metadata?.webhook || 'Nᴏɴᴇ'}

───────────────────────
📅 <code>${dateTime}</code>
───────────────────────`;

            await notifyAdmin(adminMessage);

            res.json({
                success: true,
                message: 'Iɴᴠᴏɪᴄᴇ Pᴀɪᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ',
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
                    sender: {
                        fullName: receiver.fullName,
                        walletId: receiver.walletId
                    },
                    receiver: {
                        fullName: payer.fullName,
                        walletId: payer.walletId
                    }
                }
            });

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            console.error('❌ Pᴀʏᴍᴇɴᴛ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Fᴀɪʟᴇᴅ:', error.message);
            throw error;
        }

    } catch (error) {
        console.error('❌ Pᴀʏ Iɴᴠᴏɪᴄᴇ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Pᴀʏ Iɴᴠᴏɪᴄᴇ: ' + error.message
        });
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

        console.log('🗑️ Cᴀɴᴄᴇʟʟɪɴɢ Iɴᴠᴏɪᴄᴇ:', { invoiceId, User: user.mobile });

        const invoice = await Invoice.findOne({ invoiceId });

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: 'Iɴᴠᴏɪᴄᴇ Nᴏᴛ Fᴏᴜɴᴅ'
            });
        }

        if (invoice.senderId.toString() !== user._id.toString() && 
            invoice.userId.toString() !== user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Uɴᴀᴜᴛʜᴏʀɪᴢᴇᴅ Tᴏ Cᴀɴᴄᴇʟ Tʜɪꜱ Iɴᴠᴏɪᴄᴇ'
            });
        }

        if (invoice.status === 'paid') {
            return res.status(400).json({
                success: false,
                message: 'Cᴀɴɴᴏᴛ Cᴀɴᴄᴇʟ A Pᴀɪᴅ Iɴᴠᴏɪᴄᴇ'
            });
        }

        if (invoice.status === 'cancelled') {
            return res.status(400).json({
                success: false,
                message: 'Iɴᴠᴏɪᴄᴇ Iꜱ Aʟʀᴇᴀᴅʏ Cᴀɴᴄᴇʟʟᴇᴅ'
            });
        }

        await invoice.markAsCancelled(reason || 'Cᴀɴᴄᴇʟʟᴇᴅ Bʏ Uꜱᴇʀ');

        console.log('✅ Iɴᴠᴏɪᴄᴇ Cᴀɴᴄᴇʟʟᴇᴅ:', invoiceId);

        await sendWebhook(invoice, 'invoice_cancelled');

        const sender = await User.findById(invoice.senderId);
        const receiver = await User.findById(invoice.userId);

        const cancelMessage = 
`<b>─────────────────</b>
<b>🗑️ Iɴᴠᴏɪᴄᴇ Cᴀɴᴄᴇʟʟᴇᴅ</b>
<b>─────────────────</b>

💰 Aᴍᴏᴜɴᴛ: ₹${invoice.amount.toFixed(2)}
🆔 Iɴᴠᴏɪᴄᴇ Iᴅ: ${invoiceId}
🔢 Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ: ${invoice.metadata?.transactionId || 'N/A'}
📝 Rᴇᴀꜱᴏɴ: ${invoice.notes}

───────────────────────
📅 <code>${dateTime}</code>
───────────────────────`;

        if (sender.telegramId) {
            await notifyUser(sender.telegramId, cancelMessage);
        }
        if (receiver.telegramId) {
            await notifyUser(receiver.telegramId, cancelMessage);
        }

        res.json({
            success: true,
            message: 'Iɴᴠᴏɪᴄᴇ Cᴀɴᴄᴇʟʟᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ',
            invoice: {
                invoiceId: invoice.invoiceId,
                status: invoice.status,
                notes: invoice.notes
            }
        });

    } catch (error) {
        console.error('❌ Cᴀɴᴄᴇʟ Iɴᴠᴏɪᴄᴇ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Cᴀɴᴄᴇʟ Iɴᴠᴏɪᴄᴇ: ' + error.message
        });
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

        console.log('📜 Fᴇᴛᴄʜɪɴɢ Mʏ Iɴᴠᴏɪᴄᴇꜱ:', { User: user.mobile, status });

        const filter = {
            $or: [
                { senderId: user._id },
                { userId: user._id }
            ]
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
        console.error('❌ Gᴇᴛ Mʏ Iɴᴠᴏɪᴄᴇꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Iɴᴠᴏɪᴄᴇꜱ: ' + error.message
        });
    }
});

// ============================================
// 6. PUBLIC: GET USER BY TELEGRAM ID
// ============================================
router.get('/public/user-by-telegram/:tgid', async (req, res) => {
    try {
        const { tgid } = req.params;
        console.log('🔍 Fᴇᴛᴄʜɪɴɢ Uꜱᴇʀ Bʏ Tᴇʟᴇɢʀᴀᴍ Iᴅ:', tgid);

        if (!tgid) {
            return res.status(200).json({
                success: false,
                message: 'Tᴇʟᴇɢʀᴀᴍ Iᴅ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        const user = await User.findOne({ telegramId: tgid });

        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ'
            });
        }

        return res.status(200).json({
            success: true,
            mobile: user.mobile,
            fullName: user.fullName,
            walletId: user.walletId,
            balance: user.balance
        });

    } catch (error) {
        console.error('❌ Gᴇᴛ Uꜱᴇʀ Bʏ Tᴇʟᴇɢʀᴀᴍ Eʀʀᴏʀ:', error);
        return res.status(200).json({
            success: false,
            message: 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.'
        });
    }
});

// ============================================
// 7. PUBLIC: GET USER BY API KEY
// ============================================
router.get('/user-by-apikey/:apiKey', async (req, res) => {
    try {
        const { apiKey } = req.params;
        console.log('🔍 Fᴇᴛᴄʜɪɴɢ Uꜱᴇʀ Bʏ API Kᴇʏ:', apiKey);

        if (!apiKey) {
            return res.status(200).json({
                success: false,
                message: 'API Kᴇʏ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        const user = await User.findOne({ apiKey: apiKey });

        if (!user) {
            return res.status(200).json({
                success: false,
                message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ Wɪᴛʜ Tʜɪꜱ API Kᴇʏ'
            });
        }

        return res.status(200).json({
            success: true,
            mobile: user.mobile,
            fullName: user.fullName,
            walletId: user.walletId,
            balance: user.balance
        });

    } catch (error) {
        console.error('❌ Gᴇᴛ Uꜱᴇʀ Bʏ API Kᴇʏ Eʀʀᴏʀ:', error);
        return res.status(200).json({
            success: false,
            message: 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.'
        });
    }
});

// ============================================
// 8. PUBLIC: CREATE INVOICE - POST /api/invoice-payment/public/create
// ============================================
router.post('/public/create', async (req, res) => {
    try {
        const { 
            api_key, 
            amount, 
            webhook, 
            txt_id, 
            expire_after, 
            remark,
            sender_mobile,
            sender_name,
            user_id
        } = req.body;

        console.log('📝 Pᴜʙʟɪᴄ API Iɴᴠᴏɪᴄᴇ Rᴇǫᴜᴇꜱᴛ:', { 
            api_key: api_key ? '***' : null, 
            amount, 
            txt_id,
            webhook: webhook || 'Nᴏɴᴇ',
            sender_mobile,
            sender_name
        });

        if (!api_key) {
            return res.status(400).json({
                ok: false,
                message: 'Mɪꜱꜱɪɴɢ API Kᴇʏ'
            });
        }

        const authResult = await validateApiKey(api_key);
        if (!authResult.success) {
            return res.status(401).json({
                ok: false,
                message: authResult.message
            });
        }

        const receiver = authResult.user;

        let sender = null;
        
        if (sender_mobile) {
            sender = await User.findOne({ mobile: sender_mobile });
        }
        
        if (!sender && user_id) {
            sender = await User.findOne({ telegramId: user_id });
        }
        
        if (!sender && sender_name) {
            sender = await User.findOne({ fullName: sender_name });
        }
        
        if (!sender) {
            sender = receiver;
            console.log('⚠️ Sᴇɴᴅᴇʀ Nᴏᴛ Fᴏᴜɴᴅ, Uꜱɪɴɢ Rᴇᴄᴇɪᴠᴇʀ Aꜱ Sᴇɴᴅᴇʀ');
        }

        if (!amount || amount < 1) {
            return res.status(400).json({
                ok: false,
                message: 'Mɪɴɪᴍᴜᴍ Iɴᴠᴏɪᴄᴇ Aᴍᴏᴜɴᴛ Iꜱ ₹1'
            });
        }

        if (amount > 5000) {
            return res.status(400).json({
                ok: false,
                message: 'Mᴀxɪᴍᴜᴍ Iɴᴠᴏɪᴄᴇ Aᴍᴏᴜɴᴛ Iꜱ ₹5,000'
            });
        }

        if (webhook) {
            try {
                new URL(webhook);
            } catch (error) {
                return res.status(400).json({
                    ok: false,
                    message: 'Iɴᴠᴀʟɪᴅ Wᴇʙʜᴏᴏᴋ URL'
                });
            }
        }

        let expireMinutes = parseInt(expire_after) || 30;
        if (expireMinutes < 15 || expireMinutes > 120) {
            expireMinutes = 30;
        }

        const invoiceId = generatePublicInvoiceId();
        const transactionId = generateTransactionId();
        const expiresAt = new Date(Date.now() + expireMinutes * 60 * 1000);

        console.log('📊 Iɴᴠᴏɪᴄᴇ Dᴇᴛᴀɪʟꜱ:');
        console.log('✅ Sᴇɴᴅᴇʀ:', sender.mobile, sender.fullName, sender.walletId);
        console.log('✅ Rᴇᴄᴇɪᴠᴇʀ:', receiver.mobile, receiver.fullName, receiver.walletId);

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

        console.log('✅ Pᴜʙʟɪᴄ API Iɴᴠᴏɪᴄᴇ Cʀᴇᴀᴛᴇᴅ:', invoice.invoiceId);
        console.log('✅ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ:', transactionId);

        const payLink = `${APP_URL}/invoice-pay?id=${invoice.invoiceId}`;

        if (webhook) {
            await sendWebhook(invoice, 'invoice_created');
        }

        const dateTime = getCurrentDateTime();

        await notifyAdmin(
`<b>─────────────────</b>
<b>📄 Pᴜʙʟɪᴄ API Iɴᴠᴏɪᴄᴇ Cʀᴇᴀᴛᴇᴅ</b>
<b>─────────────────</b>

👤 Sᴇɴᴅᴇʀ: <code>${sender.fullName}</code>
💳 Sᴇɴᴅᴇʀ Wᴀʟʟᴇᴛ: <code>${sender.walletId}</code>
📱 Sᴇɴᴅᴇʀ Mᴏʙɪʟᴇ: <code>${sender.mobile}</code>
👤 Rᴇᴄᴇɪᴠᴇʀ: <code>${receiver.fullName}</code>
💳 Rᴇᴄᴇɪᴠᴇʀ Wᴀʟʟᴇᴛ: <code>${receiver.walletId}</code>
📱 Rᴇᴄᴇɪᴠᴇʀ Mᴏʙɪʟᴇ: <code>${receiver.mobile}</code>
💰 Aᴍᴏᴜɴᴛ: <b>₹${amount.toFixed(2)}</b>
🆔 Iɴᴠᴏɪᴄᴇ Iᴅ: <code>${invoice.invoiceId}</code>
🔢 Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ: <code>${transactionId}</code>
🔗 Pᴀʏ Lɪɴᴋ: ${payLink}
📝 Rᴇᴍᴀʀᴋ: ${remark || 'N/A'}
🔗 Wᴇʙʜᴏᴏᴋ: ${webhook || 'Nᴏɴᴇ'}
📅 <code>${dateTime}</code>
───────────────────────`
        );

        if (sender.telegramId) {
            const userMessage = 
`<b>─────────────────</b>
<b>📄 Iɴᴠᴏɪᴄᴇ Cʀᴇᴀᴛᴇᴅ</b>
<b>─────────────────</b>

💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${amount.toFixed(2)}
🆔 <b>Iɴᴠᴏɪᴄᴇ Iᴅ:</b> <code>${invoice.invoiceId}</code>
🔢 <b>Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ:</b> <code>${transactionId}</code>
👤 <b>Sᴇɴᴅᴇʀ:</b> ${sender.fullName} (${sender.walletId})
👤 <b>Rᴇᴄᴇɪᴠᴇʀ:</b> ${receiver.fullName} (${receiver.walletId})
⏰ <b>Exᴘɪʀᴇꜱ Iɴ:</b> ${expireMinutes} Mɪɴᴜᴛᴇꜱ
📝 <b>Rᴇᴍᴀʀᴋ:</b> ${remark || 'N/A'}

───────────────────────
📅 <code>${dateTime}</code>
───────────────────────`;

            await notifyUserWithLink(
                sender.telegramId,
                userMessage,
                invoice.invoiceId
            );
        }

        res.json({
            ok: true,
            message: 'Iɴᴠᴏɪᴄᴇ Cʀᴇᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ.',
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
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                }),
                expire_after: expireMinutes
            }
        });

    } catch (error) {
        console.error('❌ Pᴜʙʟɪᴄ API Cʀᴇᴀᴛᴇ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            ok: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Cʀᴇᴀᴛᴇ Iɴᴠᴏɪᴄᴇ: ' + error.message
        });
    }
});

// ============================================
// 9. PUBLIC: GET INVOICE STATUS - POST /api/invoice-payment/public/status
// ============================================
router.post('/public/status', async (req, res) => {
    try {
        const { invoice_id, api_key } = req.body;

        console.log('🔍 Pᴜʙʟɪᴄ API Sᴛᴀᴛᴜꜱ Cʜᴇᴄᴋ:', { invoice_id, api_key: api_key ? '***' : null });

        if (!invoice_id) {
            return res.status(400).json({
                ok: false,
                message: 'Iɴᴠᴏɪᴄᴇ Iᴅ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }

        if (!api_key) {
            return res.status(400).json({
                ok: false,
                message: 'Mɪꜱꜱɪɴɢ API Kᴇʏ'
            });
        }

        const authResult = await validateApiKey(api_key);
        if (!authResult.success) {
            return res.status(401).json({
                ok: false,
                message: authResult.message
            });
        }

        const user = authResult.user;

        const invoice = await Invoice.findOne({ 
            invoiceId: invoice_id 
        })
        .populate('senderId', 'fullName mobile walletId')
        .populate('userId', 'fullName mobile walletId');

        if (!invoice) {
            return res.status(404).json({
                ok: false,
                message: 'Iɴᴠᴏɪᴄᴇ Nᴏᴛ Fᴏᴜɴᴅ'
            });
        }

        if (invoice.userId._id.toString() !== user._id.toString()) {
            return res.status(403).json({
                ok: false,
                message: 'Yᴏᴜ Aʀᴇ Nᴏᴛ Aᴜᴛʜᴏʀɪᴢᴇᴅ Tᴏ Vɪᴇᴡ Tʜɪꜱ Iɴᴠᴏɪᴄᴇ'
            });
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
            }

            if (transaction) {
                const payer = await User.findById(transaction.sender_id);
                if (payer) {
                    sender = payer.mobile || payer.fullName;
                }
            }
        }

        res.json({
            ok: true,
            message: 'Iɴᴠᴏɪᴄᴇ Dᴇᴛᴀɪʟꜱ Rᴇᴛʀɪᴇᴠᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ.',
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
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                }),
                expire_after: invoice.metadata?.expire_after || 30,
                paid_amount: paidAmount,
                remaining_amount: remainingAmount
            }
        });

    } catch (error) {
        console.error('❌ Pᴜʙʟɪᴄ API Sᴛᴀᴛᴜꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            ok: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Cʜᴇᴄᴋ Iɴᴠᴏɪᴄᴇ Sᴛᴀᴛᴜꜱ: ' + error.message
        });
    }
});

// ============================================
// 10. PUBLIC: GET INVOICE STATUS (GET Method)
// ============================================
router.get('/public/status/:invoiceId', async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const { api_key } = req.query;

        const body = {
            invoice_id: invoiceId,
            api_key: api_key
        };

        req.body = body;
        return router.handle(req, res);
        
    } catch (error) {
        console.error('❌ Pᴜʙʟɪᴄ API Sᴛᴀᴛᴜꜱ (GET) Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            ok: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Cʜᴇᴄᴋ Iɴᴠᴏɪᴄᴇ Sᴛᴀᴛᴜꜱ: ' + error.message
        });
    }
});

// ============================================
// 11. PUBLIC: GET TRANSACTION DETAILS
// ============================================
router.get('/public/transaction/:txnId', async (req, res) => {
    try {
        const { txnId } = req.params;
        console.log('🔍 Fᴇᴛᴄʜɪɴɢ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ:', txnId);

        if (!txnId) {
            return res.status(200).json({
                success: false,
                message: 'Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
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
            return res.status(200).json({
                success: false,
                message: 'Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Nᴏᴛ Fᴏᴜɴᴅ'
            });
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
        console.error('❌ Gᴇᴛ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Eʀʀᴏʀ:', error);
        return res.status(200).json({
            success: false,
            message: 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ.'
        });
    }
});

module.exports = router;
