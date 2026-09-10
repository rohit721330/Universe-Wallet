// FILE: server.js
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection
const MONGO_URI = process.env.MONGODB_URI;

// ✅ ADMIN_WALLET_ID
const ADMIN_WALLET_ID = process.env.ADMIN_WALLET_ID || 'UW_ADMIN_DEFAULT';

// ✅ Global OTP & TG ID Stores
global.loginOtpStore = new Map();
global.regOtpStore = new Map();
global.resetOtpStore = new Map();
global.tgIdStore = new Map();
global.emailOtpStore = new Map();

// Connect to MongoDB
const connectWithRetry = async (retries = 5) => {
    for (let i = 0; i < retries; i++) {
        try {
            await mongoose.connect(MONGO_URI, {
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
                family: 4,
                maxPoolSize: 10,
                minPoolSize: 2,
                retryWrites: true,
                retryReads: true
            });
            console.log('✅ MongoDB Connected Successfully');
            
            // Email index
            try {
                const User = require('./models/User');
                await User.collection.createIndex({ email: 1 }, { unique: true, sparse: true });
                console.log('✅ Email index verified');
            } catch (indexError) {
                console.log('ℹ️ Email index check skipped');
            }
            
            return;
        } catch (error) {
            console.error(`❌ Connection attempt ${i + 1} failed:`, error.message);
            if (i < retries - 1) {
                const waitTime = (i + 1) * 2;
                console.log(`⏳ Retrying in ${waitTime} seconds...`);
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
            }
        }
    }
    console.error('❌ All connection attempts failed');
};

connectWithRetry();

// ==================== ALL API ROUTES ====================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/withdraw-settings', require('./routes/withdraw-settings'));
app.use('/api/deposit', require('./routes/deposit'));
app.use('/api/invoice-payment', require('./routes/invoice-payment'));
app.use('/api/admin-invoice', require('./routes/admin-invoice'));
app.use('/api/transfer', require('./routes/transfer'));
app.use('/api/payment', require('./routes/payment'));
app.use('/api/lifafa', require('./routes/lifafa'));
app.use('/api/gift', require('./routes/giftCode'));
app.use('/api/pin', require('./routes/pin'));
app.use('/api/profile', require('./routes/profile'));
app.use('/api/tg', require('./routes/tg'));
app.use('/api/games', require('./routes/games'));
app.use('/api/api-key', require('./routes/api-key'));
app.use('/api/withdraw', require('./routes/withdraw'));
app.use('/api/lifafa-mgmt', require('./routes/lifafa-mgmt'));
app.use('/api/gift-mgmt', require('./routes/gift-mgmt'));

console.log('✅ All API Routes Loaded');

// ==================== AI CHAT API ENDPOINT ====================
app.post('/ai/chat', async (req, res) => {
    try {
        const { message, history } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'Message is required'
            });
        }

        const AI_API_KEY = process.env.AI_API_KEY;
        const AI_API_URL = process.env.AI_API_URL;
        const AI_MODEL = process.env.AI_MODEL || 'llama-3.3-70b-versatile';

        // Real AI if API key is available
        if (AI_API_KEY && AI_API_URL) {
            const axios = require('axios');

            const systemPrompt = `You are Universal Wallet AI Assistant. You help users with:
- Wallet features and how to use them
- Lifafa (envelope) system
- Deposit and withdrawal process
- Transfer issues and troubleshooting
- Gift codes and redemption
- Account security best practices
- General questions about Universal Wallet

Be helpful, concise, and friendly. Answer in the same language the user asks (Hindi, English, or Hinglish).`;

            const messages = [
                { role: 'system', content: systemPrompt },
                ...(history || []).slice(-10),
                { role: 'user', content: message }
            ];

            try {
                const aiResponse = await axios.post(AI_API_URL, {
                    model: AI_MODEL,
                    messages: messages,
                    temperature: 0.7,
                    max_tokens: 1024
                }, {
                    headers: {
                        'Authorization': `Bearer ${AI_API_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 30000
                });

                const reply = aiResponse.data?.choices?.[0]?.message?.content;
                if (reply) {
                    return res.json({
                        status: 'success',
                        reply: reply,
                        model: aiResponse.data?.model || AI_MODEL
                    });
                }
            } catch (apiError) {
                console.error('❌ AI API Error:', apiError.message);
                // Fall through to rule-based
            }
        }

        // Fallback: Rule-based responses
        const lowerMsg = message.toLowerCase().trim();
        let reply = '';

        if (lowerMsg.includes('feature') || lowerMsg.includes('what can') || lowerMsg.includes('kya kar')) {
            reply = `Universal Wallet offers:\n\n• Instant money transfers\n• Lifafa (gift envelope) system\n• Gift code redemption\n• Zero-fee withdrawals\n• Secure PIN protection\n• Task-based earning\n• Telegram notifications\n\nWhat would you like to know more about?`;
        }
        else if (lowerMsg.includes('lifafa') || lowerMsg.includes('envelope')) {
            reply = `The Lifafa system lets you send gift envelopes:\n\n1. Go to Lifafa section\n2. Set total amount and number of users\n3. Add optional conditions (channel join, etc.)\n4. Share the link\n5. Users claim their share\n\nEach user can claim a specific Lifafa only once.`;
        }
        else if (lowerMsg.includes('deposit') || lowerMsg.includes('add money') || lowerMsg.includes('paisa')) {
            reply = `To deposit money:\n\n1. Go to Deposit section\n2. Enter amount (min ₹1, max ₹5000)\n3. Pay via UPI to the shown ID\n4. Submit UTR number\n5. Wait for admin approval (up to 24 hours)\n\nYour balance updates after verification.`;
        }
        else if (lowerMsg.includes('withdraw')) {
            reply = `To withdraw:\n\n1. Go to Withdraw section\n2. Enter amount\n3. Enter UPI ID (verified)\n4. Submit request\n5. Processing within 48 hours\n\nZero fees — you receive the exact amount requested.`;
        }
        else if (lowerMsg.includes('transfer') || lowerMsg.includes('send') || lowerMsg.includes('fail')) {
            reply = `If a transfer fails:\n\n1. Check your balance\n2. Verify receiver's mobile number\n3. Check internet connection\n4. Wait 5 minutes and retry\n\nIf still failing, contact support with transaction ID.`;
        }
        else if (lowerMsg.includes('gift') || lowerMsg.includes('code')) {
            reply = `Gift codes:\n\n• Enter code to redeem wallet credits\n• Each code is single-use\n• May have expiry date\n• Non-transferable\n\nGet codes from promotions, campaigns, or admin.`;
        }
        else if (lowerMsg.includes('security') || lowerMsg.includes('safe') || lowerMsg.includes('pin') || lowerMsg.includes('otp')) {
            reply = `Security tips:\n\n• Never share your PIN or OTP\n• Use a strong password\n• Enable 2FA if available\n• Log out from shared devices\n• Report suspicious activity immediately\n\nUniversal Wallet never asks for your PIN/password.`;
        }
        else if (lowerMsg.includes('hello') || lowerMsg.includes('hi') || lowerMsg.includes('hey')) {
            reply = `Hello! 👋 I'm Universal Wallet AI. How can I help you today?\n\nAsk me about:\n• Wallet features\n• Deposit & withdrawal\n• Lifafa system\n• Transfer help\n• Account security`;
        }
        else {
            reply = `I'm here to help with Universal Wallet!\n\nYou can ask me about:\n• Features & how to use\n• Deposit process\n• Withdrawal process\n• Lifafa system\n• Transfer issues\n• Gift codes\n• Account security\n\nWhat would you like to know?`;
        }

        return res.json({
            status: 'success',
            reply: reply,
            model: 'Rule-Based'
        });

    } catch (error) {
        console.error('❌ AI Chat Error:', error.message);
        return res.status(500).json({
            status: 'error',
            message: 'AI service temporarily unavailable. Please try again.'
        });
    }
});

console.log('✅ AI Chat Endpoint Loaded');

// ==================== STATIC FILES ====================
app.use(express.static(path.join(__dirname, 'public')));

// ==================== HTML ROUTES ====================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/ai', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ai.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get('/index', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/pin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pin.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/transfer', (req, res) => res.sendFile(path.join(__dirname, 'public', 'transfer.html')));
app.get('/deposit', (req, res) => res.sendFile(path.join(__dirname, 'public', 'deposit.html')));
app.get('/withdraw', (req, res) => res.sendFile(path.join(__dirname, 'public', 'withdraw.html')));
app.get('/transactions', (req, res) => res.sendFile(path.join(__dirname, 'public', 'transactions.html')));
app.get('/recent-transactions', (req, res) => res.sendFile(path.join(__dirname, 'public', 'recent-transactions.html')));
app.get('/lifafa', (req, res) => res.sendFile(path.join(__dirname, 'public', 'lifafa.html')));
app.get('/my-lifafa', (req, res) => res.sendFile(path.join(__dirname, 'public', 'my-lifafa.html')));
app.get('/invoice', (req, res) => res.sendFile(path.join(__dirname, 'public', 'invoice.html')));
app.get('/invoice-pay', (req, res) => res.sendFile(path.join(__dirname, 'public', 'invoice-pay.html')));
app.get('/gift', (req, res) => res.sendFile(path.join(__dirname, 'public', 'gift.html')));
app.get('/forgot-password', (req, res) => res.sendFile(path.join(__dirname, 'public', 'forgot-password.html')));
app.get('/game', (req, res) => res.sendFile(path.join(__dirname, 'public', 'game.html')));
app.get('/game-settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'game-settings.html')));
app.get('/more', (req, res) => res.sendFile(path.join(__dirname, 'public', 'more.html')));
app.get('/tg', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tg.html')));
app.get('/api', (req, res) => res.sendFile(path.join(__dirname, 'public', 'api.html')));
app.get('/txn', (req, res) => res.sendFile(path.join(__dirname, 'public', 'txn.html')));
app.get('/qr', (req, res) => res.sendFile(path.join(__dirname, 'public', 'qr.html')));

// Admin Pages
app.get('/admin-settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-settings.html')));
app.get('/admin-users', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-users.html')));
app.get('/admin-gift', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-gift.html')));
app.get('/admin-lifafa', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-lifafa.html')));
app.get('/admin-adjust', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-adjust.html')));
app.get('/admin-withdraw', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-withdraw.html')));
app.get('/admin-deposit', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-deposit.html')));
app.get('/admin-transactions', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-transactions.html')));
app.get('/admin-invoice', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-invoice.html')));

// Games Pages
app.get('/normal', (req, res) => res.sendFile(path.join(__dirname, 'public', 'normal.html')));
app.get('/dice', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dice.html')));
app.get('/toss', (req, res) => res.sendFile(path.join(__dirname, 'public', 'toss.html')));
app.get('/scratch', (req, res) => res.sendFile(path.join(__dirname, 'public', 'scratch.html')));

// ==================== FALLBACK ROUTE ====================
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, message: 'API Endpoint Not Found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== CRON JOB: CLEANUP EXPIRED INVOICES ====================
const Invoice = require('./models/Invoice');
setInterval(async () => {
    try {
        const result = await Invoice.cleanupExpired();
        if (result.modifiedCount > 0) {
            console.log(`🧹 Cleaned up ${result.modifiedCount} expired invoices`);
        }
    } catch (error) {
        console.error('❌ Cleanup cron error:', error.message);
    }
}, 5 * 60 * 1000);

// ==================== CLEANUP EXPIRED TG ID SESSIONS ====================
setInterval(() => {
    try {
        if (global.tgIdStore) {
            const now = Date.now();
            let deletedCount = 0;
            for (const [key, value] of global.tgIdStore.entries()) {
                if (value.expires && value.expires < now) {
                    global.tgIdStore.delete(key);
                    deletedCount++;
                }
            }
            if (deletedCount > 0) {
                console.log(`🧹 Cleaned up ${deletedCount} expired TG ID sessions`);
            }
        }
    } catch (error) {
        console.error('❌ TG ID cleanup error:', error.message);
    }
}, 2 * 60 * 1000);

// ==================== CLEANUP EXPIRED EMAIL OTP ====================
setInterval(() => {
    try {
        if (global.emailOtpStore) {
            const now = Date.now();
            let deletedCount = 0;
            for (const [key, value] of global.emailOtpStore.entries()) {
                if (value.expires && value.expires < now) {
                    global.emailOtpStore.delete(key);
                    deletedCount++;
                }
            }
            if (deletedCount > 0) {
                console.log(`🧹 Cleaned up ${deletedCount} expired email OTP sessions`);
            }
        }
    } catch (error) {
        console.error('❌ Email OTP cleanup error:', error.message);
    }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server Running On Port ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log(`📌 Admin Wallet ID: ${ADMIN_WALLET_ID}`);
    console.log(`📌 TG ID Store: ${global.tgIdStore ? '✅ Initialized' : '❌ Not initialized'}`);
});

module.exports = app;
