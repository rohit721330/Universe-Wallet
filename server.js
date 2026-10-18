// ============================================================
// FILE: server.js — FULL SECURED (সব ফিচার আছে, শুধু ভুল ঠিক)
// ============================================================
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

// 🔧 FIX: যোগ করা হয়েছে — security headers ও rate limiting
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);

// ============================================================
// 🔧 FIX: Security headers (helmet)
// ============================================================
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // APK/HTML serve করতে
    contentSecurityPolicy: false, // আপনার inline script আছে, পরে proper CSP দিন
    referrerPolicy: { policy: 'no-referrer' },
}));

// ============================================================
// 🔧 FIX: CORS — open `cors()` এর বদলে allowlist
// ============================================================
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean);
const IS_PROD = process.env.NODE_ENV === 'production';

app.use(cors({
    origin: (origin, cb) => {
        if (!origin) return cb(null, true); // same-origin/server-to-server
        if (ALLOWED_ORIGINS.length === 0) {
            if (IS_PROD) return cb(new Error('CORS: origin not allowed'));
            return cb(null, true); // dev-এ সব allow
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

// 🔧 FIX: body size limit (DoS প্রতিরোধ)
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ============================================================
// 🔧 FIX: Global API rate limiter
// ============================================================
app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests. Please try again later.' },
}));

// 🔧 FIX: setup/reset/migrate এর জন্য কড়া rate limiter (brute-force প্রতিরোধ)
const setupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many setup attempts. Try again in 1 hour.' },
});

// ============================================================
// ENV & GLOBALS (original-এর মতোই)
// ============================================================
const PORT = process.env.PORT || 3000;
const ADMIN_WALLET_ID = process.env.ADMIN_WALLET_ID;
const SETUP_SECRET = process.env.SETUP_SECRET;

global.loginOtpStore = new Map();
global.regOtpStore = new Map();
global.resetOtpStore = new Map();
global.tgIdStore = new Map();
global.emailOtpStore = new Map();

const MONGO_URI = process.env.MONGODB_URI;

// ============================================================
// HELPERS (original + fix)
// ============================================================
function maskAdminId(adminId) {
    if (!adminId || typeof adminId !== 'string') return 'unknown';
    const id = adminId.trim();
    if (id.length <= 4) return '*'.repeat(id.length || 4);
    const firstTwo = id.slice(0, 2);
    const lastTwo = id.slice(-2);
    const maskLength = Math.max(id.length - 4, 3);
    return firstTwo + '*'.repeat(maskLength) + lastTwo;
}

// 🔧 FIX: mobile/email/wallet mask helpers (response-এ leak কমাতে)
function maskMobile(m) {
    if (!m || typeof m !== 'string') return null;
    return m.length > 4 ? '******' + m.slice(-4) : '****';
}
function maskEmail(e) {
    if (!e || typeof e !== 'string' || !e.includes('@')) return null;
    const [name, domain] = e.split('@');
    return (name.slice(0, 2) + '***@' + domain);
}
function maskWallet(w) {
    return w ? maskAdminId(String(w)) : null;
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

// ============================================================
// 🔧 FIX: extractSetupSecret — query parameter বাদ (URL/log/history leak)
// header এবং POST body থেকে পড়বে
// ============================================================
function extractSetupSecret(req) {
    const headerSecret = req.headers['x-setup-secret'];
    if (typeof headerSecret === 'string' && headerSecret.length > 0) return headerSecret;
    if (req.method === 'POST' && req.body && typeof req.body.secret === 'string' && req.body.secret.length > 0) {
        return req.body.secret;
    }
    return null;
}

function logSetupAttempt(tag, req, success, reason) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const source = req.headers['x-setup-secret'] ? 'header'
        : (req.method === 'POST' && req.body && req.body.secret ? 'body' : 'none');
    const status = success ? '✅' : '❌';
    console.log(`[${new Date().toISOString()}] [${tag}] ${status} IP: ${ip} | Source: ${source} | ${reason}`);
}

// ============================================================
// MongoDB Connection (original-এর মতোই)
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
            .then((mongooseInstance) => {
                console.log('✅ MongoDB Connected');
                return mongooseInstance;
            })
            .catch((err) => {
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
        // 🔧 FIX: 200 → 503 (সঠিক status)
        return res.status(503).json({
            success: false,
            message: 'Database connection failed. Please try again in a moment.',
        });
    }
};

// ============================================================
// 🔧 FIX: Referral CORS middleware — `*` বাদ, allowlist ব্যবহার
// ============================================================
const referralCorsMiddleware = (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
        res.header('Vary', 'Origin');
        res.header('Access-Control-Allow-Credentials', 'true');
    } else if (ALLOWED_ORIGINS.length === 0 && !IS_PROD) {
        res.header('Access-Control-Allow-Origin', '*');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Auth-Token, X-Setup-Secret, X-HTTP-Method-Override');
    res.header('Access-Control-Expose-Headers', 'Authorization, X-Auth-Token');

    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
};

app.use('/referral', referralCorsMiddleware);
app.use('/api', dbConnectMiddleware);
app.use('/referral', dbConnectMiddleware);

// ============================================================
// POST /setup-admin — Create FIRST admin using SECRET KEY
// ✅ original সব field আছে, শুধু masked response
// ============================================================
const setupAdminHandler = async (req, res) => {
    try {
        await connectDB();
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                success: false,
                message: 'MongoDB not connected yet. Try again in 5 seconds.',
                readyState: mongoose.connection.readyState,
            });
        }

        if (!SETUP_SECRET) {
            console.error('❌ [SETUP-ADMIN] SETUP_SECRET not configured.');
            return res.status(500).json({
                success: false,
                message: 'Setup secret is not configured on the server.',
                hint: 'Add SETUP_SECRET=your_secret_value to your environment variables and redeploy.',
            });
        }

        const providedSecret = extractSetupSecret(req);
        if (!providedSecret) {
            logSetupAttempt('SETUP-ADMIN', req, false, 'No secret provided');
            return res.status(403).json({
                success: false,
                message: '❌ Secret key required.',
                hint: 'Send X-Setup-Secret header (preferred) OR POST body { secret }.',
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
            const existingAdmin = await Admin.findOne({})
                .select('adminId fullName role mobile createdAt').lean();
            console.warn(`[SETUP-ADMIN] Blocked — admin exists: ${maskAdminId(existingAdmin?.adminId)}`);
            return res.status(403).json({
                success: false,
                locked: true,
                message: '🔒 Admin setup is locked. An admin already exists in the system.',
                hint: 'To reset, use /reset-admin first. Then call /setup-admin again.',
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
                return res.status(404).json({
                    success: false,
                    // 🔧 FIX: mobile mask করে দেখানো
                    message: `No active user found with mobile ${maskMobile(targetMobile)}.`,
                });
            }
        } else {
            currentUser = await User.findOne({ isDeleted: false, isBlocked: false })
                .sort({ createdAt: 1 }).select('+password');
            if (!currentUser) {
                return res.status(404).json({
                    success: false,
                    message: 'No active user found in the database.',
                    hint: 'Register a user first, OR provide mobile to specify which user becomes admin.',
                });
            }
        }

        if (currentUser.isDeleted) return res.status(403).json({ success: false, message: 'This user account has been deleted.' });
        if (currentUser.isBlocked) return res.status(403).json({ success: false, message: 'This user account is blocked.' });

        if (!currentUser.walletId || String(currentUser.walletId).trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Selected user has no Wallet ID. Cannot create admin without it.',
            });
        }

        const rawWalletId = String(currentUser.walletId).trim();
        const adminId = rawWalletId.toLowerCase();
        const adminWalletId = rawWalletId.toUpperCase();

        const plainPassword = currentUser.password;
        if (!plainPassword) {
            return res.status(400).json({ success: false, message: 'Selected user has no password set. Please set one first.' });
        }

        const raceCheck = await Admin.findOne({ $or: [{ adminId }, { mobile: currentUser.mobile }] });
        if (raceCheck) {
            return res.status(409).json({
                success: false,
                message: 'An admin with this ID / mobile already exists. /setup-admin is locked.',
                existingAdmin: { adminId: maskAdminId(raceCheck.adminId), role: raceCheck.role },
            });
        }

        // ⚠️ Admin model-এ pre('save') bcrypt hook থাকা বাধ্যতামূলক
        const admin = new Admin({
            adminId,
            walletId: adminWalletId,
            password: plainPassword,
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

        // ✅ original response structure, শুধু sensitive data masked
        return res.json({
            success: true,
            message: '✅ First admin (super_admin) created successfully.',
            sourceUser: {
                fullName: currentUser.fullName,
                mobile: maskMobile(currentUser.mobile),
                email: maskEmail(currentUser.email),
                walletId: maskWallet(currentUser.walletId),
            },
            admin: {
                adminId: maskAdminId(admin.adminId),
                fullName: admin.fullName,
                mobile: maskMobile(admin.mobile),
                telegramId: admin.telegramId ? maskAdminId(String(admin.telegramId)) : null,
                walletId: maskWallet(admin.walletId),
                email: maskEmail(admin.email),
                role: admin.role,
                createdAt: admin.createdAt,
            },
            // 🔧 FIX: full credential echo বন্ধ — masked
            credentials: {
                adminId: maskAdminId(admin.adminId),
                mobile: maskMobile(admin.mobile),
                telegramId: admin.telegramId ? maskAdminId(String(admin.telegramId)) : 'not set',
                walletId: maskWallet(admin.walletId),
                password: '(same as the selected user\'s password)',
            },
            nextSteps: [
                '1. Go to /admin or /rohit (admin panel)',
                '2. Enter your pattern (ADMIN_PATTERN env)',
                `3. Login via Mobile: ${maskMobile(admin.mobile)}`,
                `   OR Telegram ID: ${admin.telegramId ? maskAdminId(String(admin.telegramId)) : 'not set'}`,
                `   OR Wallet ID: ${maskWallet(admin.walletId)}`,
                '4. Password: the selected user\'s existing password',
                '5. ⚠️ Change the password from admin settings after first login.',
            ],
            securityNote: '🔐 Keep your SETUP_SECRET safe.',
        });
    } catch (err) {
        console.error('❌ /setup-admin error:', err.message);
        if (err.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'An admin with this ID / mobile / telegram / wallet already exists. /setup-admin is now locked.',
            });
        }
        // 🔧 FIX: production-এ internal err.message leak বন্ধ
        return res.status(500).json({
            success: false,
            message: IS_PROD ? 'Setup failed. Please try again.' : err.message,
        });
    }
};

// ============================================================
// POST /reset-admin — Wipe ALL admins
// ✅ original সব field আছে
// ============================================================
const resetAdminHandler = async (req, res) => {
    try {
        await connectDB();
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                success: false,
                message: 'MongoDB not connected yet. Try again in 5 seconds.',
                readyState: mongoose.connection.readyState,
            });
        }

        if (!SETUP_SECRET) {
            console.error('❌ [RESET-ADMIN] SETUP_SECRET not configured.');
            return res.status(500).json({
                success: false,
                message: 'Setup secret is not configured on the server.',
                hint: 'Add SETUP_SECRET=your_secret_value to your environment variables and redeploy.',
            });
        }

        // 🔧 FIX: confirm প্রথমে চেক (info leak কমাতে)
        const confirmRaw = (req.body && req.body.confirm) || '';
        const confirm = String(confirmRaw).toUpperCase();
        if (confirm !== 'YES') {
            logSetupAttempt('RESET-ADMIN', req, false, 'Missing confirm=YES');
            return res.status(400).json({
                success: false,
                message: '⚠️ Confirmation required. This will DELETE all admins.',
                hint: 'Send confirm=YES (POST body) to proceed.',
            });
        }

        const providedSecret = extractSetupSecret(req);
        if (!providedSecret) {
            logSetupAttempt('RESET-ADMIN', req, false, 'No secret provided');
            return res.status(403).json({
                success: false,
                message: '❌ Secret key required.',
                hint: 'Send X-Setup-Secret header (preferred) OR POST body { secret }.',
            });
        }
        if (!safeCompareSecret(providedSecret, SETUP_SECRET)) {
            logSetupAttempt('RESET-ADMIN', req, false, 'Invalid secret');
            return res.status(403).json({ success: false, message: '❌ Invalid secret key.' });
        }
        logSetupAttempt('RESET-ADMIN', req, true, 'Secret + confirm verified');

        const Admin = require('./models/Admin');
        const existingAdmins = await Admin.find({})
            .select('adminId fullName role mobile telegramId walletId createdAt').lean();

        const maskedExisting = existingAdmins.map(a => ({
            adminId: maskAdminId(a.adminId),
            role: a.role || 'unknown',
            createdAt: a.createdAt || null,
        }));

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
                ? `✅ Reset successful. Deleted ${deleted} admin(s). Call /setup-admin to create a fresh admin.`
                : 'ℹ️ Reset complete. No admins existed to delete. Call /setup-admin to create a fresh admin.',
            deletedAdminsCount: deleted,
            deletedAdmins: maskedExisting,
            nextSteps: [
                '1. All admin accounts have been removed.',
                '2. Now call POST /setup-admin with X-Setup-Secret header to create a new super_admin.',
                '3. Example: { "mobile": "9477379243" }',
                '4. Then login to /admin with that user\'s credentials.',
            ],
            securityNote: '🔐 /reset-admin does NOT create any admin.',
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
// 🔧 FIX: setup/reset শুধু POST (GET বাদ — URL-এ secret leak হয়)
// secret ছাড়া কেউ চালাতে পারবে না
// ============================================================
app.post('/setup-admin', setupLimiter, setupAdminHandler);
app.post('/reset-admin', setupLimiter, resetAdminHandler);

// ============================================================
// 🔧 FIX: migrate-referral-codes-v2 — setup secret required + rate limit
// (original-এ কোনো auth ছিল না — যে কেউ ডেটা বদলাতে পারত)
// ============================================================
app.post('/migrate-referral-codes-v2', setupLimiter, async (req, res) => {
    try {
        await connectDB();

        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ success: false, message: 'MongoDB not connected yet.' });
        }

        if (!SETUP_SECRET) {
            return res.status(500).json({ success: false, message: 'Setup secret not configured.' });
        }

        const providedSecret = extractSetupSecret(req);
        if (!providedSecret) {
            logSetupAttempt('MIGRATE-V2', req, false, 'No secret provided');
            return res.status(403).json({
                success: false,
                message: '❌ Secret key required.',
                hint: 'Send X-Setup-Secret header.',
            });
        }
        if (!safeCompareSecret(providedSecret, SETUP_SECRET)) {
            logSetupAttempt('MIGRATE-V2', req, false, 'Invalid secret');
            return res.status(403).json({ success: false, message: '❌ Invalid secret key.' });
        }
        logSetupAttempt('MIGRATE-V2', req, true, 'Secret verified');

        const User = require('./models/User');
        console.log('🔵 [migrate-v2] Starting migration...');

        const allUsers = await User.find({ isDeleted: false });
        const results = [];
        const skipped = [];

        for (const user of allUsers) {
            const hasValidCode = user.referralCode &&
                                  typeof user.referralCode === 'string' &&
                                  user.referralCode.length >= 6;

            if (hasValidCode) {
                skipped.push({ mobile: maskMobile(user.mobile), reason: 'Already has code' });
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
                results.push({ mobile: maskMobile(user.mobile), error: 'Failed to generate unique code' });
                continue;
            }

            await User.updateOne({ _id: user._id }, { $set: { referralCode: newCode } });
            results.push({
                mobile: maskMobile(user.mobile),
                fullName: user.fullName,
                newCode, // referral code নিজেই sensitive নয়, তবে চাইলে mask করতে পারেন
                status: 'updated',
            });
        }

        res.json({
            success: true,
            totalUsers: allUsers.length,
            updated: results.length,
            skipped: skipped.length,
            results,
            skippedUsers: skipped,
        });
    } catch (error) {
        console.error('❌ [migrate-v2] Error:', error.message);
        res.status(500).json({
            success: false,
            message: IS_PROD ? 'Migration failed.' : error.message,
        });
    }
});

// ============================================================
// 🔧 FIX: referral-test — setup secret required
// (info leak রোধ)
// ============================================================
app.post('/referral-test', (req, res) => {
    const providedSecret = extractSetupSecret(req);
    if (!providedSecret || !safeCompareSecret(providedSecret, SETUP_SECRET || '')) {
        return res.status(403).json({ success: false, message: '❌ Secret required.' });
    }
    res.json({ success: true, message: 'Referral route is reachable' });
});

// ==================== ALL API ROUTES (original-এর মতোই) ====================
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

// ==================== STATIC FILES (original-এর মতোই) ====================
app.use(express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    index: false,
    // 🔧 FIX: dotfiles deny (নিরাপত্তা)
    dotfiles: 'deny',
}));

// ==================== ROOT & INDEX ====================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/index', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ==================== HTML ROUTES (সব original route) ====================
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

// ==================== FALLBACK ROUTE (original-এর মতোই) ====================
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, message: 'API Endpoint Not Found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== ERROR HANDLER ====================
app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    console.error(`❌ [${status}] ${err.message}`);

    // 🔧 FIX: CORS error আলাদা handle
    if (err.message && err.message.includes('CORS')) {
        return res.status(403).json({ success: false, message: 'CORS not allowed.' });
    }

    // 🔧 FIX: 200 → proper status code, production-এ internal message লুকানো
    res.status(status).json({
        success: false,
        message: IS_PROD ? 'Something went wrong. Please try again.' : err.message,
    });
});

// ==================== CLEANUP CRON JOBS (original-এর মতোই) ====================
const Invoice = require('./models/Invoice');

setInterval(async () => {
    try {
        const result = await Invoice.cleanupExpired();
        if (result.modifiedCount > 0) console.log(`🧹 Cleaned up ${result.modifiedCount} expired invoices`);
    } catch (error) { console.error('❌ Cleanup cron error:', error.message); }
}, 5 * 60 * 1000);

setInterval(() => {
    try {
        if (global.tgIdStore) {
            const now = Date.now();
            let deletedCount = 0;
            for (const [key, value] of global.tgIdStore.entries()) {
                if (value.expires && value.expires < now) { global.tgIdStore.delete(key); deletedCount++; }
            }
            if (deletedCount > 0) console.log(`🧹 Cleaned up ${deletedCount} expired TG ID sessions`);
        }
    } catch (error) { console.error('❌ TG ID cleanup error:', error.message); }
}, 2 * 60 * 1000);

setInterval(() => {
    try {
        if (global.emailOtpStore) {
            const now = Date.now();
            let deletedCount = 0;
            for (const [key, value] of global.emailOtpStore.entries()) {
                if (value.expires && value.expires < now) { global.emailOtpStore.delete(key); deletedCount++; }
            }
            if (deletedCount > 0) console.log(`🧹 Cleaned up ${deletedCount} expired email OTP sessions`);
        }
    } catch (error) { console.error('❌ Email OTP cleanup error:', error.message); }
}, 5 * 60 * 1000);

// ==================== START SERVER ====================
if (!process.env.VERCEL) {
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`🚀 Server Running On Port ${PORT}`);
        // 🔧 FIX: wallet ID leak বন্ধ — শুধু set আছে কি না দেখানো
        console.log(`📌 Admin Wallet ID: ${ADMIN_WALLET_ID ? '✅ set' : '❌ missing'}`);
        console.log(`🔐 /setup-admin: ACTIVE (POST only)`);
        console.log(`🔐 /reset-admin: ACTIVE (POST only)`);
        console.log(`🔐 /migrate-referral-codes-v2: ACTIVE (POST only, secret required)`);
        console.log(`⚠️  SETUP_SECRET: ${SETUP_SECRET ? 'YES ✅' : 'NO ❌'}`);
        console.log(`🌐 ALLOWED_ORIGINS: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : '⚠️ not set (production-এ restricted)'}`);
        console.log(`🔒 Environment: ${IS_PROD ? 'PRODUCTION' : 'development'}`);
    });
}

module.exports = app;