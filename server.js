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

// ✅ ADMIN_WALLET_ID
const ADMIN_WALLET_ID = process.env.ADMIN_WALLET_ID || 'UWLN427970';

// ✅ Global OTP & TG ID Stores
global.loginOtpStore = new Map();
global.regOtpStore = new Map();
global.resetOtpStore = new Map();
global.tgIdStore = new Map();
global.emailOtpStore = new Map();

const MONGO_URI = process.env.MONGODB_URI;

// =========================================================
// ✅ VERCEL-SAFE MongoDB Connection with Global Cache
// =========================================================
let cached = global.mongoose;

if (!cached) {
    cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
    if (cached.conn && mongoose.connection.readyState === 1) {
        return cached.conn;
    }

    if (!cached.promise) {
        const opts = {
            bufferCommands: false,
            serverSelectionTimeoutMS: 10000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 10000,
            family: 4,
            maxPoolSize: 10,
            minPoolSize: 1,
            retryWrites: true,
            retryReads: true
        };

        console.log('🔌 Connecting to MongoDB...');

        cached.promise = mongoose.connect(MONGO_URI, opts)
            .then((mongooseInstance) => {
                console.log('✅ MongoDB Connected Successfully');
                return mongooseInstance;
            })
            .catch((err) => {
                console.error('❌ MongoDB Connection Error:', err.message);
                cached.promise = null;
                cached.conn = null;
                throw err;
            });
    }

    try {
        cached.conn = await cached.promise;
    } catch (err) {
        cached.promise = null;
        cached.conn = null;
        throw err;
    }

    return cached.conn;
}

// =========================================================
// ✅ DB Connection Middleware — /api এবং /referral উভয়ের জন্য
// =========================================================
const dbConnectMiddleware = async (req, res, next) => {
    try {
        await connectDB();
        next();
    } catch (error) {
        console.error('❌ DB Middleware Error:', error.message);
        return res.status(200).json({
            success: false,
            message: 'Database connection failed. Please try again in a moment.'
        });
    }
};

app.use('/api', dbConnectMiddleware);
app.use('/referral', dbConnectMiddleware);

// ============================================================
// ⚠️⚠️⚠️ TEMPORARY ROUTE — DELETE AFTER CREATING ADMIN ⚠️⚠️⚠️
// ============================================================
app.get('/setup-admin', async (req, res) => {
    try {
        await connectDB();

        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                success: false,
                error: 'MongoDB not connected yet. Try again in 5 seconds.',
                readyState: mongoose.connection.readyState
            });
        }

        const Admin = require('./models/Admin');

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
            adminId: 'UWLN427970',
            password: 'Universe@330',
            fullName: 'Universe Admin',
            mobile: '9517532486',
            email: 'business.universewallet@gmail.com',
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
                adminId: 'UWLN427970',
                password: 'Universe@330',
                mobile: '9517532486'
            },
            nextSteps: [
                '1. Go to /rohit (admin panel)',
                '2. Enter your 6-digit pattern',
                '3. Admin ID: UWLN427970',
                '4. Password: Universe@330',
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
// ⚠️⚠️⚠️ TEMPORARY MIGRATION ROUTE — DELETE AFTER USE ⚠️⚠️⚠️
// ============================================================
app.get('/migrate-referral-codes', async (req, res) => {
    try {
        await connectDB();
        const User = require('./models/User');
        const crypto = require('crypto');
        
        function generateCode() {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let code = '';
            while (code.length < 10) {
                const byte = crypto.randomBytes(1)[0];
                if (byte < 252) code += chars[byte % chars.length];
            }
            return code;
        }
        
        // Find users without referralCode
        const users = await User.find({
            $or: [
                { referralCode: { $exists: false } },
                { referralCode: null },
                { referralCode: '' }
            ]
        });
        
        console.log(`🔵 [migrate] Found ${users.length} users without referralCode`);
        
        const results = [];
        for (const user of users) {
            let code = generateCode();
            let attempts = 0;
            while (await User.findOne({ referralCode: code }) && attempts < 15) {
                code = generateCode();
                attempts++;
            }
            
            await User.updateOne(
                { _id: user._id },
                { $set: { referralCode: code, referralCodeCustom: false } }
            );
            
            results.push({ 
                mobile: user.mobile, 
                fullName: user.fullName,
                code 
            });
            console.log(`✅ [migrate] ${user.mobile} → ${code}`);
        }
        
        res.json({
            success: true,
            migrated: results.length,
            results
        });
    } catch (error) {
        console.error('❌ [migrate] Error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================
// ⚠️ END TEMPORARY ROUTE
// ============================================================

// ==================== ALL API ROUTES ====================
app.use('/api/auth', require('./routes/auth'));
app.use('/referral', require('./routes/referral'));
app.use('/api/check-status', require('./routes/check-status'));
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
app.use(express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    index: false
}));

// ==================== ROOT & INDEX (Query Param Safe) ====================
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== HTML ROUTES (Order Matters!) ====================
app.get('/refer', (req, res) => res.sendFile(path.join(__dirname, 'public', 'refer.html')));
app.get('/universe-wallet.apk', (req, res) => res.sendFile(path.join(__dirname, 'public', 'universe-wallet.apk')));
app.get('/ai', (req, res) => res.sendFile(path.join(__dirname, 'public', 'ai.html')));
app.get('/download', (req, res) => res.sendFile(path.join(__dirname, 'public', 'download.html')));
app.get('/refund', (req, res) => res.sendFile(path.join(__dirname, 'public', 'refund.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
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

// ==================== FALLBACK ROUTE (SPA) ====================
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, message: 'API Endpoint Not Found' });
    }
    if (req.path.startsWith('/referral/')) {
        return res.status(404).json({ success: false, message: 'Referral Endpoint Not Found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== ERROR HANDLER ====================
app.use((err, req, res, next) => {
    console.error('❌ Unhandled Error:', err.message);
    res.status(200).json({ success: false, message: 'Something went wrong. Please try again.' });
});

// ==================== LOCAL DEVELOPMENT ONLY ====================
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    const PORT = process.env.PORT || 3000;

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

    app.listen(PORT, () => {
        console.log(`🚀 Server Running On Port ${PORT}`);
        console.log(`🌐 http://localhost:${PORT}`);
        console.log(`📌 Admin Wallet ID: ${ADMIN_WALLET_ID}`);
        console.log(`⚠️  /setup-admin route is ACTIVE — DELETE after creating admin!`);
    });
}

module.exports = app;
