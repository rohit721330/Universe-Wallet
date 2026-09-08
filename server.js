// FILE: server.js
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// MongoDB Connection
const MONGO_URI = process.env.MONGODB_URI;

// ✅ ADMIN_WALLET_ID ডিফাইন করা হয়েছে
const ADMIN_WALLET_ID = process.env.ADMIN_WALLET_ID || 'PW_ADMIN_DEFAULT';

// Global OTP Stores
global.loginOtpStore = new Map();
global.regOtpStore = new Map();
global.resetOtpStore = new Map();

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
            console.log('✅ MᴏɴɢᴏDB Cᴏɴɴᴇᴄᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ');
            return;
        } catch (error) {
            console.error(`❌ Cᴏɴɴᴇᴄᴛɪᴏɴ ᴀᴛᴛᴇᴍᴘᴛ ${i + 1} ꜰᴀɪʟᴇᴅ:`, error.message);
            if (i < retries - 1) {
                const waitTime = (i + 1) * 2;
                console.log(`⏳ Rᴇᴛʀʏɪɴɢ ɪɴ ${waitTime} ꜱᴇᴄᴏɴᴅꜱ...`);
                await new Promise(resolve => setTimeout(resolve, waitTime * 1000));
            }
        }
    }
    console.error('❌ Aʟʟ ᴄᴏɴɴᴇᴄᴛɪᴏɴ ᴀᴛᴛᴇᴍᴘᴛꜱ ꜰᴀɪʟᴇᴅ');
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

// ==================== LIFAFA & GIFT MANAGEMENT ROUTES ====================
app.use('/api/lifafa-mgmt', require('./routes/lifafa-mgmt'));
app.use('/api/gift-mgmt', require('./routes/gift-mgmt'));

console.log('✅ Aʟʟ Rᴏᴜᴛᴇꜱ Lᴏᴀᴅᴇᴅ:');
console.log('   /api/auth');
console.log('   /api/wallet');
console.log('   /api/admin');
console.log('   /api/withdraw-settings');
console.log('   /api/deposit');
console.log('   /api/invoice-payment ✅');
console.log('   /api/admin-invoice ✅');
console.log('   /api/transfer');
console.log('   /api/payment');
console.log('   /api/lifafa');
console.log('   /api/gift');
console.log('   /api/pin');
console.log('   /api/profile');
console.log('   /api/tg');
console.log('   /api/games');
console.log('   /api/api-key');
console.log('   /api/withdraw');
console.log('   /api/lifafa-mgmt ✅');
console.log('   /api/gift-mgmt ✅');

// ==================== STATIC FILES ====================
app.use(express.static(path.join(__dirname, 'public')));

// ==================== HTML ROUTES ====================
app.get('/a', (req, res) => res.sendFile(path.join(__dirname, 'public', 'own-username.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/index', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/pin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pin.html')));
app.get('/api', (req, res) => res.sendFile(path.join(__dirname, 'public', 'api.html')));
app.get('/txn', (req, res) => res.sendFile(path.join(__dirname, 'public', 'txn.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/more', (req, res) => res.sendFile(path.join(__dirname, 'public', 'more.html')));
app.get('/rohit', (req, res) => res.sendFile(path.join(__dirname, 'public', 'rohit.html')));
app.get('/admin-settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-settings.html')));
app.get('/admin-users', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-users.html')));
app.get('/admin-gift', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-gift.html')));
app.get('/admin-lifafa', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-lifafa.html')));
app.get('/admin-adjust', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-adjust.html')));
app.get('/admin-withdraw', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-withdraw.html')));
app.get('/admin-deposit', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-deposit.html')));
app.get('/admin-transactions', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-transactions.html')));
app.get('/admin-invoice', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin-invoice.html')));
app.get('/recent-transactions', (req, res) => res.sendFile(path.join(__dirname, 'public', 'recent-transactions.html')));
app.get('/transfer', (req, res) => res.sendFile(path.join(__dirname, 'public', 'transfer.html')));
app.get('/deposit', (req, res) => res.sendFile(path.join(__dirname, 'public', 'deposit.html')));
app.get('/withdraw', (req, res) => res.sendFile(path.join(__dirname, 'public', 'withdraw.html')));
app.get('/transactions', (req, res) => res.sendFile(path.join(__dirname, 'public', 'transactions.html')));
app.get('/lifafa', (req, res) => res.sendFile(path.join(__dirname, 'public', 'lifafa.html')));
app.get('/my-lifafa', (req, res) => res.sendFile(path.join(__dirname, 'public', 'my-lifafa.html')));
app.get('/invoice', (req, res) => res.sendFile(path.join(__dirname, 'public', 'invoice.html')));
app.get('/invoice-pay', (req, res) => res.sendFile(path.join(__dirname, 'public', 'invoice-pay.html')));

// ✅ লিফাফা ক্লেইম পেজ
app.get('/normal', (req, res) => res.sendFile(path.join(__dirname, 'public', 'normal.html')));
app.get('/dice', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dice.html')));
app.get('/toss', (req, res) => res.sendFile(path.join(__dirname, 'public', 'toss.html')));
app.get('/scratch', (req, res) => res.sendFile(path.join(__dirname, 'public', 'scratch.html')));

app.get('/gift', (req, res) => res.sendFile(path.join(__dirname, 'public', 'gift.html')));
app.get('/forgot-password', (req, res) => res.sendFile(path.join(__dirname, 'public', 'forgot-password.html')));
app.get('/tg', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tg.html')));
app.get('/game', (req, res) => res.sendFile(path.join(__dirname, 'public', 'game.html')));
app.get('/game-settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'game-settings.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get('/qr', (req, res) => res.sendFile(path.join(__dirname, 'public', 'qr.html')));

// ==================== FALLBACK ROUTE ====================
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API Endpoint Not Found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== CRON JOB: CLEANUP EXPIRED INVOICES ====================
const Invoice = require('./models/Invoice');
setInterval(async () => {
    try {
        const result = await Invoice.cleanupExpired();
        if (result.modifiedCount > 0) {
            console.log(`🧹 Cʟᴇᴀɴᴇᴅ ᴜᴘ ${result.modifiedCount} ᴇxᴘɪʀᴇᴅ ɪɴᴠᴏɪᴄᴇꜱ`);
        }
    } catch (error) {
        console.error('❌ Cʟᴇᴀɴᴜᴘ ᴄʀᴏɴ ᴇʀʀᴏʀ:', error.message);
    }
}, 5 * 60 * 1000); // Every 5 minutes

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Sᴇʀᴠᴇʀ Rᴜɴɴɪɴɢ Oɴ Pᴏʀᴛ ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log(`📌 Aᴅᴍɪɴ Mᴀɴᴀɢᴇᴍᴇɴᴛ Rᴏᴜᴛᴇꜱ:`);
    console.log(`   /api/lifafa-mgmt → Lɪꜰᴀꜰᴀ Mᴀɴᴀɢᴇᴍᴇɴᴛ API`);
    console.log(`   /api/gift-mgmt   → Gɪꜰᴛ Mᴀɴᴀɢᴇᴍᴇɴᴛ API`);
    console.log(`   /api/invoice-payment → Uꜱᴇʀ Iɴᴠᴏɪᴄᴇ Pᴀʏᴍᴇɴᴛ API ✅`);
    console.log(`   /api/invoice-payment/public → Pᴜʙʟɪᴄ Iɴᴠᴏɪᴄᴇ API ✅`);
    console.log(`   /api/admin-invoice  → Aᴅᴍɪɴ Iɴᴠᴏɪᴄᴇ Mᴀɴᴀɢᴇᴍᴇɴᴛ API ✅`);
    console.log(`   /admin-lifafa    → Aᴅᴍɪɴ Lɪꜰᴀꜰᴀ Pᴀɢᴇ`);
    console.log(`   /admin-gift      → Aᴅᴍɪɴ Gɪꜰᴛ Pᴀɢᴇ`);
    console.log(`   /admin-invoice   → Aᴅᴍɪɴ Iɴᴠᴏɪᴄᴇ Pᴀɢᴇ ✅`);
    console.log(`   /invoice         → Uꜱᴇʀ Iɴᴠᴏɪᴄᴇ Pᴀɢᴇ ✅`);
    console.log(`   /invoice-pay     → Uꜱᴇʀ Iɴᴠᴏɪᴄᴇ Pᴀʏ Pᴀɢᴇ ✅`);
    console.log(`   /txn             → Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Vɪᴇᴡᴇʀ Pᴀɢᴇ ✅`);
    console.log(`📌 Aᴅᴍɪɴ Wᴀʟʟᴇᴛ ID: ${ADMIN_WALLET_ID}`);
});

module.exports = app;
