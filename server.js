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
// ✅ DB Connection Middleware
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

// =========================================================
// ✅ REFERRAL-SPECIFIC CORS MIDDLEWARE
// =========================================================
const referralCorsMiddleware = (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Auth-Token, X-HTTP-Method-Override');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Expose-Headers', 'Authorization, X-Auth-Token');

    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
};

app.use('/referral', referralCorsMiddleware);
app.use('/api', dbConnectMiddleware);
app.use('/referral', dbConnectMiddleware);

// ============================================================
// ✅ /setup-admin — Create FIRST admin from CURRENT LOGGED-IN USER
// ⚠️ Only works if NO admin exists yet. Once an admin exists, this route is locked.
// ============================================================
app.post('/setup-admin', async (req, res) => {
    try {
        await connectDB();

        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                success: false,
                message: 'MongoDB not connected yet. Try again in 5 seconds.',
                readyState: mongoose.connection.readyState
            });
        }

        // ---------- 0. LOCK CHECK: No admin must exist ----------
        const Admin = require('./models/Admin');
        const User = require('./models/User');

        const existingAdminCount = await Admin.countDocuments({});
        if (existingAdminCount > 0) {
            const existingAdmin = await Admin.findOne({}).select('adminId fullName role mobile createdAt').lean();

            console.warn(`[SETUP-ADMIN] Blocked attempt — admin already exists: ${existingAdmin?.adminId}`);

            return res.status(403).json({
                success: false,
                message: '🔒 Admin setup is locked. An admin already exists in the system.',
                hint: 'To create more admins, login to the admin panel and use "Create Admin Account" (/api/admin/create-admin-account).',
                existingAdmin: {
                    adminId: existingAdmin?.adminId || 'unknown',
                    role: existingAdmin?.role || 'unknown',
                    createdAt: existingAdmin?.createdAt || null
                }
            });
        }

        // ---------- 1. Verify JWT ----------
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'No token provided. Please login first and send Authorization: Bearer <token>.'
            });
        }

        const JWT_SECRET = process.env.JWT_SECRET;
        if (!JWT_SECRET) {
            return res.status(500).json({ success: false, message: 'JWT_SECRET not configured.' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({
                success: false,
                message: err.name === 'TokenExpiredError'
                    ? 'Token expired. Please login again.'
                    : 'Invalid token.'
            });
        }

        if (!decoded.userId) {
            return res.status(401).json({ success: false, message: 'Invalid token payload.' });
        }

        // ---------- 2. Load current user ----------
        const currentUser = await User.findById(decoded.userId);
        if (!currentUser) {
            return res.status(404).json({ success: false, message: 'User not found for this token.' });
        }
        if (currentUser.isDeleted) {
            return res.status(403).json({ success: false, message: 'This account has been deleted.' });
        }
        if (currentUser.isBlocked) {
            return res.status(403).json({ success: false, message: 'This account is blocked.' });
        }

        // ---------- 3. Build admin data from current user ----------
        const adminId = (currentUser.walletId || `u${currentUser._id}`).toLowerCase();

        const plainPassword = currentUser.password;
        if (!plainPassword) {
            return res.status(400).json({
                success: false,
                message: 'Current user has no password set. Please set one first.'
            });
        }

        // ---------- 4. Double-check for race conditions ----------
        // In case two requests hit at the exact same time.
        const raceCheck = await Admin.findOne({
            $or: [{ adminId }, { mobile: currentUser.mobile }]
        });
        if (raceCheck) {
            return res.status(409).json({
                success: false,
                message: 'An admin with your ID / mobile already exists.',
                hint: 'Please login to the admin panel instead.'
            });
        }

        // ---------- 5. Create the FIRST admin ----------
        const admin = new Admin({
            adminId,
            password: plainPassword, // will be bcrypt-hashed by Admin schema pre('save')
            fullName: currentUser.fullName,
            mobile: currentUser.mobile,
            email: currentUser.email,
            telegramId: currentUser.telegramId,
            role: 'super_admin', // first admin is always super_admin
            isActive: true,
            isBlocked: false,
            createdBy: 'setup-admin-route'
        });

        await admin.save();

        // Mark User.isAdmin = true
        if (!currentUser.isAdmin) {
            currentUser.isAdmin = true;
            await currentUser.save();
        }

        console.log(`✅ [SETUP-ADMIN] First super_admin created: ${admin.adminId}`);

        return res.json({
            success: true,
            message: '✅ First admin (super_admin) created from your current user.',
            admin: {
                adminId: admin.adminId,
                fullName: admin.fullName,
                mobile: admin.mobile,
                email: admin.email,
                role: admin.role,
                createdAt: admin.createdAt
            },
            credentials: {
                adminId: admin.adminId,
                password: '(same as your user password)'
            },
            nextSteps: [
                '1. Go to /admin or /rohit (admin panel)',
                '2. Enter your pattern',
                `3. Admin ID: ${admin.adminId}`,
                '4. Password: your existing user password',
                '5. ⚠️ Change the password from admin settings after first login.',
                '6. ⚠️ This /setup-admin route is now LOCKED forever — no new admin can be created from here.'
            ],
            locked: true,
            lockMessage: '🔒 /setup-admin is now permanently locked. Use /api/admin/create-admin-account (as super_admin) to add more admins.'
        });

    } catch (err) {
        console.error('❌ /setup-admin error:', err.message);

        if (err.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'An admin with this ID / mobile already exists. /setup-admin is now locked.'
            });
        }

        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
});
                
// ⚠️ TEMPORARY — Delete after use
app.get('/migrate-referral-codes-v2', async (req, res) => {
    try {
        await connectDB();
        const User = require('./models/User');
        const crypto = require('crypto');

        console.log('🔵 [migrate-v2] Starting migration...');

        const allUsers = await User.find({ isDeleted: false });
        console.log(`🔵 [migrate-v2] Total users found: ${allUsers.length}`);

        const results = [];
        const skipped = [];

        for (const user of allUsers) {
            const hasValidCode = user.referralCode &&
                                  typeof user.referralCode === 'string' &&
                                  user.referralCode.length >= 6;

            if (hasValidCode) {
                skipped.push({
                    mobile: user.mobile,
                    existingCode: user.referralCode,
                    reason: 'Already has code'
                });
                continue;
            }

            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let newCode = '';
            let attempts = 0;
            let isUnique = false;

            while (!isUnique && attempts < 20) {
                newCode = '';
                while (newCode.length < 10) {
                    const byte = crypto.randomBytes(1)[0];
                    if (byte < 252) newCode += chars[byte % chars.length];
                }
                const exists = await User.findOne({ referralCode: newCode });
                isUnique = !exists;
                attempts++;
            }

            if (!isUnique) {
                results.push({
                    mobile: user.mobile,
                    error: 'Failed to generate unique code'
                });
                continue;
            }

            await User.updateOne(
                { _id: user._id },
                { $set: { referralCode: newCode } }
            );

            results.push({
                mobile: user.mobile,
                fullName: user.fullName,
                newCode: newCode,
                status: 'updated'
            });

            console.log(`✅ [migrate-v2] ${user.mobile} → ${newCode}`);
        }

        res.json({
            success: true,
            totalUsers: allUsers.length,
            updated: results.length,
            skipped: skipped.length,
            results,
            skippedUsers: skipped
        });
    } catch (error) {
        console.error('❌ [migrate-v2] Error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ⚠️ TEMPORARY DEBUG ROUTE — Delete after use
app.get('/referral-test', (req, res) => {
    res.json({ success: true, message: 'Referral route is reachable' });
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
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'rohit.html')));
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
app.get('/bulk', (req, res) => res.sendFile(path.join(__dirname, 'public', 'bulk.html')));
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
