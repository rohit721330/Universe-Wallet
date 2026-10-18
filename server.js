// ============================================================
// FILE: server.js — SECURED VERSION
// ============================================================
require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

// Render/Proxy এর পিছনে সঠিক IP পাওয়ার জন্য জরুরি
app.set('trust proxy', 1);

// ============================================================
// ENV VARIABLES (verify করুন Render-এ সেট আছে)
// ============================================================
const PORT = process.env.PORT || 3000;
const ADMIN_WALLET_ID = process.env.ADMIN_WALLET_ID;
const SETUP_SECRET = process.env.SETUP_SECRET;
const MONGO_URI = process.env.MONGODB_URI;
const IS_PROD = process.env.NODE_ENV === 'production';

// CORS allowlist — comma-separated env
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

// ============================================================
// GLOBAL STORES (বড় হলে Redis-এ migrate করুন)
// ============================================================
global.loginOtpStore = new Map();
global.regOtpStore = new Map();
global.resetOtpStore = new Map();
global.tgIdStore = new Map();
global.emailOtpStore = new Map();

// ============================================================
// HELPERS
// ============================================================
function maskAdminId(adminId) {
    if (!adminId || typeof adminId !== 'string') return 'unknown';
    const id = adminId.trim();
    if (id.length <= 4) return '*'.repeat(id.length || 4);
    return id.slice(0, 2) + '*'.repeat(Math.max(id.length - 4, 3)) + id.slice(-2);
}

function safeCompareSecret(provided, expected) {
    if (typeof provided !== 'string' || typeof expected !== 'string') return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
        try { crypto.timingSafeEqual(b, b); } catch { /* ignore */ }
        return false;
    }
    try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

// শুধু header এবং POST body থেকে secret নিন (query বাদ)
function extractSetupSecret(req) {
    const h = req.headers['x-setup-secret'];
    if (typeof h === 'string' && h.length > 0) return h;
    if (req.method === 'POST' && req.body && typeof req.body.secret === 'string' && req.body.secret.length > 0) {
        return req.body.secret;
    }
    return null;
}

function logSetupAttempt(tag, req, success, reason) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const source = req.headers['x-setup-secret']
        ? 'header'
        : (req.method === 'POST' && req.body?.secret ? 'body' : 'none');
    console.log(`[${new Date().toISOString()}] [${tag}] ${success ? '✅' : '❌'} IP: ${ip} | Source: ${source} | ${reason}`);
}

// ============================================================
// SECURITY MIDDLEWARE
// ============================================================

// 1. Security headers
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false, // আপনার frontend inline script থাকলে বন্ধ রাখুন; পরে proper CSP দিন
    referrerPolicy: { policy: 'no-referrer' },
}));

// 2. CORS
app.use(cors({
    origin: (origin, cb) => {
        // same-origin/no-origin request allow
        if (!origin) return cb(null, true);
        if (ALLOWED_ORIGINS.length === 0) {
            // production-এ allowlist ছাড়া CORS fail-safe: শুধু same-origin ধরে নিন
            if (IS_PROD) return cb(new Error('CORS: origin not allowed'));
            return cb(null, true);
        }
        return ALLOWED_ORIGINS.includes(origin)
            ? cb(null, true)
            : cb(new Error('CORS: origin not allowed'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Auth-Token', 'X-Setup-Secret'],
    maxAge: 86400,
}));

// 3. Body size limits (DoS prevention)
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 4. Global API rate limiter
app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again later.' },
}));

// 5. Setup route limiter (brute-force প্রতিরোধ)
const setupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many setup attempts. Try again in 1 hour.' },
});

// 6. Referral-specific CORS (secure)
const referralCorsMiddleware = (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Vary', 'Origin');
        res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Auth-Token, X-Setup-Secret');
    res.header('Access-Control-Expose-Headers', 'Authorization, X-Auth-Token');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
};

// ============================================================
// MONGODB CONNECTION (cached)
// ============================================================
let cached = global.mongoose;
if (!cached) cached = global.mongoose = { conn: null, promise: null };

async function connectDB() {
    if (cached.conn && mongoose.connection.readyState === 1) return cached.conn;

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
            retryReads: true,
        };
        console.log('🔌 Connecting to MongoDB...');
        cached.promise = mongoose.connect(MONGO_URI, opts)
            .then(inst => { console.log('✅ MongoDB Connected'); return inst; })
            .catch(err => {
                console.error('❌ MongoDB Connection Error:', err.message);
                cached.promise = null;
                cached.conn = null;
                throw err;
            });
    }

    try { cached.conn = await cached.promise; }
    catch (err) { cached.promise = null; cached.conn = null; throw err; }
    return cached.conn;
}

const dbConnectMiddleware = async (req, res, next) => {
    try { await connectDB(); next(); }
    catch (error) {
        console.error('❌ DB Middleware Error:', error.message);
        return res.status(503).json({
            success: false,
            message: 'Database connection failed. Please try again in a moment.',
        });
    }
};

app.use('/referral', referralCorsMiddleware);
app.use('/api', dbConnectMiddleware);
app.use('/referral', dbConnectMiddleware);

// ============================================================
// SETUP ADMIN HANDLER
// ============================================================
const setupAdminHandler = async (req, res) => {
    try {
        await connectDB();
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ success: false, message: 'MongoDB not connected yet. Try again in 5 seconds.' });
        }

        if (!SETUP_SECRET) {
            console.error('❌ [SETUP-ADMIN] SETUP_SECRET not configured.');
            return res.status(500).json({ success: false, message: 'Setup secret is not configured on the server.' });
        }

        const providedSecret = extractSetupSecret(req);
        if (!providedSecret) {
            logSetupAttempt('SETUP-ADMIN', req, false, 'No secret provided');
            return res.status(403).json({
                success: false,
                message: '❌ Secret key required.',
                hint: 'Send X-Setup-Secret header (preferred).',
            });
        }

        if (!safeCompareSecret(providedSecret, SETUP_SECRET)) {
            logSetupAttempt('SETUP-ADMIN', req, false, 'Invalid secret');
            return res.status(403).json({ success: false, message: '❌ Invalid secret key.' });
        }

        logSetupAttempt('SETUP-ADMIN', req, true, 'Secret verified');

        const Admin = require('./models/Admin');
        const User = require('./models/User');

        const existingAdminCount = await Admin.countDocuments({});
        if (existingAdminCount > 0) {
            const existingAdmin = await Admin.findOne({}).select('adminId role createdAt').lean();
            console.warn(`[SETUP-ADMIN] Blocked — admin exists: ${maskAdminId(existingAdmin?.adminId)}`);
            return res.status(403).json({
                success: false,
                locked: true,
                message: '🔒 Admin setup is locked. An admin already exists in the system.',
                existingAdmin: {
                    adminId: maskAdminId(existingAdmin?.adminId),
                    role: existingAdmin?.role || 'unknown',
                    createdAt: existingAdmin?.createdAt || null,
                },
            });
        }

        const targetMobileRaw = (req.body && req.body.mobile) || null;
        const targetMobile = targetMobileRaw ? String(targetMobileRaw).trim() : null;

        let currentUser = null;
        if (targetMobile) {
            if (!/^[0-9]{10}$/.test(targetMobile)) {
                return res.status(400).json({ success: false, message: 'Invalid mobile — must be 10 digits.' });
            }
            currentUser = await User.findOne({ mobile: targetMobile, isDeleted: false }).select('+password');
            if (!currentUser) {
                return res.status(404).json({ success: false, message: 'No active user found with that mobile.' });
            }
        } else {
            currentUser = await User.findOne({ isDeleted: false, isBlocked: false })
                .sort({ createdAt: 1 })
                .select('+password');
            if (!currentUser) {
                return res.status(404).json({
                    success: false,
                    message: 'No active user found in the database.',
                    hint: 'Register a user first, OR provide mobile.',
                });
            }
        }

        if (currentUser.isDeleted) return res.status(403).json({ success: false, message: 'This user account has been deleted.' });
        if (currentUser.isBlocked) return res.status(403).json({ success: false, message: 'This user account is blocked.' });

        if (!currentUser.walletId || String(currentUser.walletId).trim() === '') {
            return res.status(400).json({ success: false, message: 'Selected user has no Wallet ID.' });
        }

        const rawWalletId = String(currentUser.walletId).trim();
        const adminId = rawWalletId.toLowerCase();
        const adminWalletId = rawWalletId.toUpperCase();

        // ⚠️ CRITICAL: currentUser.password এখানে plain text হতে পারে
        // User model-এ select('+password') থেকে যেটা আসে সেটা hash (bcrypt) হওয়া উচিত।
        // যদি plain text হয়, তবে Admin model-এর pre('save') hook-এ আবার hash হবে।
        // নিশ্চিত করুন Admin model-এ pre('save') bcrypt hook আছে।
        const passwordForAdmin = currentUser.password;
        if (!passwordForAdmin) {
            return res.status(400).json({ success: false, message: 'Selected user has no password set.' });
        }

        const raceCheck = await Admin.findOne({ $or: [{ adminId }, { mobile: currentUser.mobile }] });
        if (raceCheck) {
            return res.status(409).json({
                success: false,
                message: 'An admin with this ID / mobile already exists.',
                existingAdmin: { adminId: maskAdminId(raceCheck.adminId), role: raceCheck.role },
            });
        }

        const admin = new Admin({
            adminId,
            walletId: adminWalletId,
            password: passwordForAdmin, // Admin model-এ pre('save') hash করবে
            fullName: currentUser.fullName,
            mobile: currentUser.mobile,
            telegramId: currentUser.telegramId || undefined,
            email: currentUser.email,
            role: 'super_admin',
            isActive: true,
            isBlocked: false,
            createdBy: 'setup-admin-route',
        });

        await admin.save();

        if (!currentUser.isAdmin) {
            currentUser.isAdmin = true;
            await currentUser.save();
        }

        console.log(`✅ [SETUP-ADMIN] super_admin created: ${maskAdminId(admin.adminId)}`);

        // Response-এ sensitive data বাদ (masked only)
        return res.json({
            success: true,
            message: '✅ First admin (super_admin) created successfully.',
            admin: {
                adminId: maskAdminId(admin.adminId),
                fullName: admin.fullName,
                mobile: admin.mobile ? `******${String(admin.mobile).slice(-4)}` : null,
                role: admin.role,
                createdAt: admin.createdAt,
            },
            nextSteps: [
                '1. Go to /admin to log in.',
                '2. Use your mobile / telegram / wallet ID.',
                '3. ⚠️ Change password immediately after first login.',
            ],
        });
    } catch (err) {
        console.error('❌ /setup-admin error:', err.message);
        if (err.code === 11000) {
            return res.status(409).json({ success: false, message: 'Duplicate admin data.' });
        }
        return res.status(500).json({
            success: false,
            message: IS_PROD ? 'Setup failed. Please try again.' : err.message,
        });
    }
};

// ============================================================
// RESET ADMIN HANDLER
// ============================================================
const resetAdminHandler = async (req, res) => {
    try {
        await connectDB();
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ success: false, message: 'MongoDB not connected yet.' });
        }

        if (!SETUP_SECRET) {
            console.error('❌ [RESET-ADMIN] SETUP_SECRET not configured.');
            return res.status(500).json({ success: false, message: 'Setup secret is not configured.' });
        }

        // confirm চেক প্রথমে — info leak কমাতে
        const confirm = String((req.body && req.body.confirm) || '').toUpperCase();
        if (confirm !== 'YES') {
            logSetupAttempt('RESET-ADMIN', req, false, 'Missing confirm=YES');
            return res.status(400).json({
                success: false,
                message: '⚠️ Confirmation required. This will DELETE all admins.',
                hint: 'Send confirm=YES in body.',
            });
        }

        const providedSecret = extractSetupSecret(req);
        if (!providedSecret) {
            logSetupAttempt('RESET-ADMIN', req, false, 'No secret provided');
            return res.status(403).json({ success: false, message: '❌ Secret key required.' });
        }
        if (!safeCompareSecret(providedSecret, SETUP_SECRET)) {
            logSetupAttempt('RESET-ADMIN', req, false, 'Invalid secret');
            return res.status(403).json({ success: false, message: '❌ Invalid secret key.' });
        }

        logSetupAttempt('RESET-ADMIN', req, true, 'Secret + confirm verified');

        const Admin = require('./models/Admin');
        const existingAdmins = await Admin.find({}).select('adminId role createdAt').lean();
        const deletedCount = existingAdmins.length;
        let deleted = 0;

        if (deletedCount > 0) {
            const delResult = await Admin.deleteMany({});
            deleted = delResult.deletedCount || 0;
            console.log(`🗑️  [RESET-ADMIN] Deleted ${deleted} admin(s).`);
        }

        return res.json({
            success: true,
            message: deleted > 0
                ? `✅ Deleted ${deleted} admin(s). Call /setup-admin to create a fresh admin.`
                : 'ℹ️ No admins existed to delete.',
            deletedAdminsCount: deleted,
            deletedAdmins: existingAdmins.map(a => ({
                adminId: maskAdminId(a.adminId),
                role: a.role || 'unknown',
                createdAt: a.createdAt || null,
            })),
        });
    } catch (err) {
        console.error('❌ /reset-admin error:', err.message);
        return res.status(500).json({
            success: false,
            message: IS_PROD ? 'Reset failed. Please try again.' : err.message,
        });
    }
};

// ============================================================
// SETUP / RESET ROUTES — শুধু POST + rate limit
// ============================================================
app.post('/setup-admin', setupLimiter, setupAdminHandler);
app.post('/reset-admin', setupLimiter, resetAdminHandler);
// ⛔ GET route বাদ দেওয়া হয়েছে (secret URL/log-এ leak হয়)

// ⛔ /migrate-referral-codes-v2 — সম্পূর্ণ ডিলিট
// ⛔ /referral-test — সম্পূর্ণ ডিলিট

// ============================================================
// ALL API ROUTES
// ============================================================
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
app.use('/ai', require('./routes/ai'));

console.log('✅ All API Routes Loaded');

// ============================================================
// STATIC FILES
// ============================================================
app.use(express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    index: false,
    dotfiles: 'deny',
    maxAge: IS_PROD ? '1h' : 0,
}));

// ============================================================
// HTML ROUTES
// ============================================================
const htmlPages = [
    'refer', 'ai', 'download', 'refund', 'privacy', 'terms', 'pin',
    'dashboard', 'profile', 'transfer', 'bulk', 'deposit', 'withdraw',
    'transactions', 'recent-transactions', 'lifafa', 'my-lifafa',
    'invoice', 'invoice-pay', 'gift', 'forgot-password', 'game',
    'game-settings', 'more', 'tg', 'api', 'txn', 'qr',
    'admin-settings', 'admin-users', 'admin-gift', 'admin-lifafa',
    'admin-adjust', 'admin-withdraw', 'admin-deposit',
    'admin-transactions', 'admin-invoice',
    'normal', 'dice', 'toss', 'scratch',
];

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/index', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'rohit.html')));
app.get('/rohit', (req, res) => res.sendFile(path.join(__dirname, 'public', 'rohit.html')));
app.get('/universe-wallet.apk', (req, res) => res.sendFile(path.join(__dirname, 'public', 'universe-wallet.apk')));

htmlPages.forEach(page => {
    app.get(`/${page}`, (req, res) => {
        res.sendFile(path.join(__dirname, 'public', `${page}.html`));
    });
});

// ============================================================
// FALLBACK ROUTE
// ============================================================
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, message: 'API Endpoint Not Found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// GLOBAL ERROR HANDLER (proper status codes)
// ============================================================
app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    console.error(`❌ [${status}] ${err.message}`);
    if (IS_PROD) console.error(err.stack);

    // CORS error হলে 403
    if (err.message && err.message.includes('CORS')) {
        return res.status(403).json({ success: false, message: 'CORS not allowed.' });
    }

    res.status(status).json({
        success: false,
        message: IS_PROD ? 'Something went wrong. Please try again.' : err.message,
    });
});

// ============================================================
// CLEANUP CRON JOBS
// ============================================================
const Invoice = require('./models/Invoice');

setInterval(async () => {
    try {
        const result = await Invoice.cleanupExpired();
        if (result.modifiedCount > 0) console.log(`🧹 Cleaned ${result.modifiedCount} expired invoices`);
    } catch (e) { console.error('❌ Cleanup cron:', e.message); }
}, 5 * 60 * 1000);

setInterval(() => {
    try {
        const now = Date.now();
        let n = 0;
        for (const [k, v] of (global.tgIdStore || new Map()).entries()) {
            if (v.expires && v.expires < now) { global.tgIdStore.delete(k); n++; }
        }
        if (n > 0) console.log(`🧹 Cleaned ${n} expired TG sessions`);
    } catch (e) { console.error('❌ TG cleanup:', e.message); }
}, 2 * 60 * 1000);

setInterval(() => {
    try {
        const now = Date.now();
        let n = 0;
        for (const [k, v] of (global.emailOtpStore || new Map()).entries()) {
            if (v.expires && v.expires < now) { global.emailOtpStore.delete(k); n++; }
        }
        if (n > 0) console.log(`🧹 Cleaned ${n} expired email OTPs`);
    } catch (e) { console.error('❌ Email OTP cleanup:', e.message); }
}, 5 * 60 * 1000);

// ============================================================
// START SERVER
// ============================================================
if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Server Running On Port ${PORT}`);
        console.log(`📌 ADMIN_WALLET_ID: ${ADMIN_WALLET_ID ? '✅ set' : '❌ missing'}`);
        console.log(`🔐 SETUP_SECRET: ${SETUP_SECRET ? '✅ set' : '❌ missing'}`);
        console.log(`🌐 ALLOWED_ORIGINS: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : '⚠️ not set (CORS restricted)'}`);
        console.log(`🔒 Environment: ${IS_PROD ? 'PRODUCTION' : 'development'}`);
    });
}

module.exports = app;