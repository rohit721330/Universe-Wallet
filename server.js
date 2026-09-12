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

// ============================================================
// ⚠️⚠️⚠️ TEMPORARY ROUTE — DELETE AFTER CREATING ADMIN ⚠️⚠️⚠️
// ============================================================
app.get('/setup-admin', async (req, res) => {
    try {
        // Check MongoDB connection
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                success: false,
                error: 'MongoDB not connected yet. Try again in 5 seconds.',
                readyState: mongoose.connection.readyState
            });
        }

        const Admin = require('./models/Admin');

        // Check if any admin exists
        const existing = await Admin.findOne({ role: 'super_admin' });
        if (existing) {
            return res.json({
                success: false,
                message: 'Super admin already exists',
                adminId: existing.adminId,
                mobile: existing.mobile,
                role: existing.role,
                hint: 'If you forgot password, delete this document from MongoDB Atlas and visit /setup-admin again'
            });
        }

        const superAdmin = new Admin({
            adminId: 'superadmin',
            password: 'ChangeMe123!',
            fullName: 'Super Admin',
            mobile: '9999999999',
            email: 'admin@universewallet.com',
            role: 'super_admin',
            isActive: true,
            isBlocked: false,
            createdBy: 'setup-route'
        });

        await superAdmin.save();

        res.json({
            success: true,
            message: '✅ Super Admin Created Successfully!',
            credentials: {
                adminId: 'superadmin',
                password: 'ChangeMe123!',
                mobile: '9999999999'
            },
            nextSteps: [
                '1. Go to /rohit (admin panel)',
                '2. Enter your 6-digit pattern',
                '3. Admin ID: superadmin',
                '4. Password: ChangeMe123!',
                '5. ⚠️ Change password immediately after login!',
                '6. ⚠️ DELETE this /setup-admin route from server.js NOW!'
            ]
        });

    } catch (err) {
        console.error('Setup admin error:', err.message);
        res.status(500).json({
            success: false,
            error: err.message,
            hint: err.code === 11000 ? 'Admin with same adminId or mobile already exists' : 'Check server logs'
        });
    }
});
// ============================================================
// ⚠️ END TEMPORARY ROUTE
// ============================================================

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

// ✅ AI ROUTE (separate file)
app.use('/ai', require('./routes/ai'));

console.log('✅ All API Routes Loaded');

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
    console.log(`⚠️  /setup-admin route is ACTIVE — DELETE after creating admin!`);
});

module.exports = app;
