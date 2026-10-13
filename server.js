// FILE: server.js
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
app.set('trust proxy', 1);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ✅ PORT
const PORT = process.env.PORT || "3000";

// ✅ ADMIN_WALLET_ID
const ADMIN_WALLET_ID = process.env.ADMIN_WALLET_ID;

// ✅ SETUP SECRET (from env) — NEVER log this value anywhere
const SETUP_SECRET = process.env.SETUP_SECRET;

// ✅ Global OTP & TG ID Stores
global.loginOtpStore = new Map();
global.regOtpStore = new Map();
global.resetOtpStore = new Map();
global.tgIdStore = new Map();
global.emailOtpStore = new Map();

const MONGO_URI = process.env.MONGODB_URI;

// =========================================================
// ✅ HELPER: Mask an admin ID for display
// =========================================================
function maskAdminId(adminId) {
    if (!adminId || typeof adminId !== 'string') return 'unknown';
    const id = adminId.trim();
    if (id.length <= 4) {
        return '*'.repeat(id.length || 4);
    }
    const firstTwo = id.slice(0, 2);
    const lastTwo = id.slice(-2);
    const maskLength = Math.max(id.length - 4, 3);
    return firstTwo + '*'.repeat(maskLength) + lastTwo;
}

// =========================================================
// ✅ HELPER: Timing-safe secret comparison
// =========================================================
function safeCompareSecret(provided, expected) {
    if (typeof provided !== 'string' || typeof expected !== 'string') return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length) {
        crypto.timingSafeEqual(b, b);
        return false;
    }
    try {
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

// =========================================================
// ✅ HELPER: Extract setup secret WITHOUT ever logging it
// =========================================================
function extractSetupSecret(req) {
    const headerSecret = req.headers['x-setup-secret'];
    if (typeof headerSecret === 'string' && headerSecret.length > 0) {
        return headerSecret;
    }
    if (req.body && typeof req.body.secret === 'string' && req.body.secret.length > 0) {
        return req.body.secret;
    }
    if (req.query && typeof req.query.secret === 'string' && req.query.secret.length > 0) {
        return req.query.secret;
    }
    return null;
}

// =========================================================
// ✅ HELPER: Safe logging — never prints the secret
// =========================================================
function logSetupAttempt(tag, req, success, reason) {
    const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const source = req.headers['x-setup-secret']
        ? 'header'
        : (req.body && req.body.secret)
            ? 'body'
            : req.query && req.query.secret
                ? 'query'
                : 'none';
    const status = success ? '✅' : '❌';
    console.log(`[${new Date().toISOString()}] [${tag}] ${status} IP: ${ip} | Source: ${source} | ${reason}`);
}

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
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Auth-Token, X-Setup-Secret, X-HTTP-Method-Override');
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
// ✅ POST /setup-admin — Create FIRST admin using SECRET KEY
// ⚠️ Only works if NO admin exists yet.
// Admin ID = User's real Wallet ID (lowercase)
// Wallet ID = User's real Wallet ID (uppercase)
//
// Usage (POST with header — secret never in URL logs):
//   POST /setup-admin
//   Headers: X-Setup-Secret: YOUR_SETUP_SECRET
//   Body: { "mobile": "9477379243" }
// ============================================================
const setupAdminHandler = async (req, res) => {
    try {
        await connectDB();

        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                success: false,
                message: 'MongoDB not connected yet. Try again in 5 seconds.',
                readyState: mongoose.connection.readyState
            });
        }

        // ---------- 0. SECRET KEY CHECK ----------
        if (!SETUP_SECRET) {
            console.error('❌ [SETUP-ADMIN] SETUP_SECRET is not configured in environment variables.');
            return res.status(500).json({
                success: false,
                message: 'Setup secret is not configured on the server.',
                hint: 'Add SETUP_SECRET=your_secret_value to your environment variables and redeploy.'
            });
        }

        const providedSecret = extractSetupSecret(req);

        if (!providedSecret) {
            logSetupAttempt('SETUP-ADMIN', req, false, 'No secret provided');
            return res.status(403).json({
                success: false,
                message: '❌ Secret key required.',
                hint: 'Send X-Setup-Secret header (preferred) OR ?secret= query param.'
            });
        }

        if (!safeCompareSecret(providedSecret, SETUP_SECRET)) {
            logSetupAttempt('SETUP-ADMIN', req, false, 'Invalid secret');
            return res.status(403).json({
                success: false,
                message: '❌ Invalid secret key.'
            });
        }

        logSetupAttempt('SETUP-ADMIN', req, true, 'Secret verified');

        // ---------- 1. LOCK CHECK: No admin must exist ----------
        const Admin = require('./models/Admin');
        const User = require('./models/User');

        const existingAdminCount = await Admin.countDocuments({});
        if (existingAdminCount > 0) {
            const existingAdmin = await Admin.findOne({})
                .select('adminId fullName role mobile createdAt')
                .lean();

            console.warn(`[SETUP-ADMIN] Blocked — admin already exists: ${maskAdminId(existingAdmin?.adminId)}`);

            return res.status(403).json({
                success: false,
                locked: true,
                message: '🔒 Admin setup is locked. An admin already exists in the system.',
                hint: 'To reset, use /reset-admin first. Then call /setup-admin again.',
                existingAdmin: {
                    adminId: maskAdminId(existingAdmin?.adminId),
                    role: existingAdmin?.role || 'unknown',
                    createdAt: existingAdmin?.createdAt || null
                }
            });
        }

        // ---------- 2. Get mobile input ----------
        const targetMobileRaw =
            (req.body && req.body.mobile) ||
            (req.query && req.query.mobile) ||
            null;
        const targetMobile = targetMobileRaw ? String(targetMobileRaw).trim() : null;

        // ---------- 3. Find the user who will become admin ----------
        let currentUser = null;

        if (targetMobile) {
            if (!/^[0-9]{10}$/.test(targetMobile)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid mobile — must be 10 digits.'
                });
            }
            currentUser = await User.findOne({ mobile: targetMobile, isDeleted: false }).select('+password');
            if (!currentUser) {
                return res.status(404).json({
                    success: false,
                    message: `No active user found with mobile ${targetMobile}.`
                });
            }
        } else {
            currentUser = await User.findOne({
                isDeleted: false,
                isBlocked: false
            })
            .sort({ createdAt: 1 })
            .select('+password');

            if (!currentUser) {
                return res.status(404).json({
                    success: false,
                    message: 'No active user found in the database.',
                    hint: 'Register a user first, OR provide mobile to specify which user becomes admin.'
                });
            }
        }

        if (currentUser.isDeleted) {
            return res.status(403).json({ success: false, message: 'This user account has been deleted.' });
        }
        if (currentUser.isBlocked) {
            return res.status(403).json({ success: false, message: 'This user account is blocked.' });
        }

        // ---------- 4. Build admin data — Admin ID = User's real Wallet ID ----------
        if (!currentUser.walletId || String(currentUser.walletId).trim() === '') {
            return res.status(400).json({
                success: false,
                message: 'Selected user has no Wallet ID. Cannot create admin without it.'
            });
        }

        const rawWalletId = String(currentUser.walletId).trim();
        const adminId = rawWalletId.toLowerCase();
        const adminWalletId = rawWalletId.toUpperCase();

        const plainPassword = currentUser.password;
        if (!plainPassword) {
            return res.status(400).json({
                success: false,
                message: 'Selected user has no password set. Please set one first.'
            });
        }

        // ---------- 5. Race-condition double-check ----------
        const raceCheck = await Admin.findOne({
            $or: [{ adminId }, { mobile: currentUser.mobile }]
        });
        if (raceCheck) {
            return res.status(409).json({
                success: false,
                message: 'An admin with this ID / mobile already exists. /setup-admin is locked.',
                existingAdmin: {
                    adminId: maskAdminId(raceCheck.adminId),
                    role: raceCheck.role
                }
            });
        }

        // ---------- 6. Create the FIRST admin ----------
        const admin = new Admin({
            adminId: adminId,
            walletId: adminWalletId,
            password: plainPassword,
            fullName: currentUser.fullName,
            mobile: currentUser.mobile,
            telegramId: currentUser.telegramId || undefined,
            email: currentUser.email,
            role: 'super_admin',
            isActive: true,
            isBlocked: false,
            createdBy: 'setup-admin-route'
        });

        await admin.save();

        if (!currentUser.isAdmin) {
            currentUser.isAdmin = true;
            await currentUser.save();
        }

        console.log(`✅ [SETUP-ADMIN] First super_admin created: ${maskAdminId(admin.adminId)} (from user ${currentUser.mobile})`);

        return res.json({
            success: true,
            message: '✅ First admin (super_admin) created successfully.',
            sourceUser: {
                fullName: currentUser.fullName,
                mobile: currentUser.mobile,
                email: currentUser.email,
                walletId: currentUser.walletId
            },
            admin: {
                adminId: admin.adminId,
                fullName: admin.fullName,
                mobile: admin.mobile,
                telegramId: admin.telegramId,
                walletId: admin.walletId,
                email: admin.email,
                role: admin.role,
                createdAt: admin.createdAt
            },
            credentials: {
                adminId: admin.adminId,
                mobile: admin.mobile,
                telegramId: admin.telegramId || 'not set',
                walletId: admin.walletId,
                password: '(same as the selected user\'s password)'
            },
            nextSteps: [
                '1. Go to /admin or /rohit (admin panel)',
                '2. Enter your pattern (ADMIN_PATTERN env)',
                `3. Login via Mobile: ${admin.mobile}`,
                `   OR Telegram ID: ${admin.telegramId || 'not set'}`,
                `   OR Wallet ID: ${admin.walletId}`,
                '4. Password: the selected user\'s existing password',
                '5. ⚠️ Change the password from admin settings after first login.'
            ],
            securityNote: '🔐 Keep your SETUP_SECRET safe. Change it in env variables if compromised.'
        });

    } catch (err) {
        console.error('❌ /setup-admin error:', err.message);

        if (err.code === 11000) {
            return res.status(409).json({
                success: false,
                message: 'An admin with this ID / mobile / telegram / wallet already exists. /setup-admin is now locked.'
            });
        }

        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// Preferred: POST (secret via header — safe)
app.post('/setup-admin', setupAdminHandler);

// Backward-compatible: GET (secret via query — less safe, kept for convenience)
app.get('/setup-admin', setupAdminHandler);

// ============================================================
// ✅ POST /reset-admin — Wipe ALL admins (delete only, NO new admin created)
// ⚠️ DANGEROUS. Requires secret + explicit confirm=YES
//
// After this, call /setup-admin to create a fresh admin.
//
// Usage (POST with header — secret never in URL logs):
//   POST /reset-admin
//   Headers: X-Setup-Secret: YOUR_SETUP_SECRET
//   Body: { "confirm": "YES" }
// ============================================================
const resetAdminHandler = async (req, res) => {
    try {
        await connectDB();

        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                success: false,
                message: 'MongoDB not connected yet. Try again in 5 seconds.',
                readyState: mongoose.connection.readyState
            });
        }

        // ---------- 0. SECRET KEY CHECK ----------
        if (!SETUP_SECRET) {
            console.error('❌ [RESET-ADMIN] SETUP_SECRET is not configured in environment variables.');
            return res.status(500).json({
                success: false,
                message: 'Setup secret is not configured on the server.',
                hint: 'Add SETUP_SECRET=your_secret_value to your environment variables and redeploy.'
            });
        }

        const providedSecret = extractSetupSecret(req);

        if (!providedSecret) {
            logSetupAttempt('RESET-ADMIN', req, false, 'No secret provided');
            return res.status(403).json({
                success: false,
                message: '❌ Secret key required.',
                hint: 'Send X-Setup-Secret header (preferred) OR ?secret= query param.'
            });
        }

        if (!safeCompareSecret(providedSecret, SETUP_SECRET)) {
            logSetupAttempt('RESET-ADMIN', req, false, 'Invalid secret');
            return res.status(403).json({
                success: false,
                message: '❌ Invalid secret key.'
            });
        }

        // ---------- 1. CONFIRMATION CHECK ----------
        const confirmRaw =
            (req.body && req.body.confirm) ||
            (req.query && req.query.confirm) ||
            '';
        const confirm = String(confirmRaw).toUpperCase();

        if (confirm !== 'YES') {
            logSetupAttempt('RESET-ADMIN', req, false, 'Missing confirm=YES');
            return res.status(400).json({
                success: false,
                message: '⚠️ Confirmation required. This will DELETE all admins.',
                hint: 'Send confirm=YES (body or query) to proceed.'
            });
        }

        logSetupAttempt('RESET-ADMIN', req, true, 'Secret + confirm verified');

        const Admin = require('./models/Admin');

        // ---------- 2. Snapshot existing admins (masked, for response) ----------
        const existingAdmins = await Admin.find({})
            .select('adminId fullName role mobile telegramId walletId createdAt')
            .lean();

        const maskedExisting = existingAdmins.map(a => ({
            adminId: maskAdminId(a.adminId),
            role: a.role || 'unknown',
            createdAt: a.createdAt || null
        }));

        const deletedCount = existingAdmins.length;

        // ---------- 3. DELETE all admins (mobile, telegram, wallet — সব রিমুভ) ----------
        let deleted = 0;
        if (deletedCount > 0) {
            const delResult = await Admin.deleteMany({});
            deleted = delResult.deletedCount || 0;
            console.log(`🗑️  [RESET-ADMIN] Deleted ${deleted} existing admin(s) with all details.`);
        } else {
            console.log('ℹ️  [RESET-ADMIN] No admins found to delete.');
        }

        // ---------- 4. Return result (NO new admin created) ----------
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
                '4. Then login to /admin with that user\'s credentials.'
            ],
            securityNote: '🔐 /reset-admin does NOT create any admin. Setup and Reset are separate operations.'
        });

    } catch (err) {
        console.error('❌ /reset-admin error:', err.message);

        return res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// Preferred: POST (secret via header — safe)
app.post('/reset-admin', resetAdminHandler);

// Backward-compatible: GET (secret via query — less safe, kept for convenience)
app.get('/reset-admin', resetAdminHandler);

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
        console.log(`🔐 /setup-admin route is ACTIVE (secret required)`);
        console.log(`⚠️  /reset-admin route is ACTIVE (secret + confirm=YES required)`);
        console.log(`⚠️  SETUP_SECRET configured: ${SETUP_SECRET ? 'YES ✅' : 'NO ❌'}`);
        console.log(`🔒 Secret value is never logged.`);
    });
}

module.exports = app;
