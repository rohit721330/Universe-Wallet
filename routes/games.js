// FILE: routes/games.js
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

// ==================== ENVIRONMENT VARIABLES ====================
const JWT_SECRET = process.env.JWT_SECRET;

// ==================== VERIFY TOKEN MIDDLEWARE ====================
const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ success: false, message: 'Nᴏ Tᴏᴋᴇɴ Pʀᴏᴠɪᴅᴇᴅ' });
        }
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ' });
        }
        req.user = user;
        next();
    } catch (error) {
        console.error('Tᴏᴋᴇɴ Vᴇʀɪꜰɪᴄᴀᴛɪᴏɴ Eʀʀᴏʀ:', error);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ success: false, message: 'Iɴᴠᴀʟɪᴅ Tᴏᴋᴇɴ' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Tᴏᴋᴇɴ Exᴘɪʀᴇᴅ' });
        }
        return res.status(401).json({ success: false, message: 'Aᴜᴛʜᴇɴᴛɪᴄᴀᴛɪᴏɴ Fᴀɪʟᴇᴅ' });
    }
};

// ============================================================
// 📊 Gᴇᴛ Gᴀᴍᴇ Sᴇᴛᴛɪɴɢꜱ
// ============================================================
router.get('/settings', async (req, res) => {
    try {
        res.json({
            success: true,
            minBet: 5,
            maxBet: 100000,
            maxMultiplier: 100,
            payoutMultiplier: 2
        });
    } catch (error) {
        console.error('Gᴇᴛ Sᴇᴛᴛɪɴɢꜱ Eʀʀᴏʀ:', error);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Sᴇᴛᴛɪɴɢꜱ' });
    }
});

// ============================================================
// 🪙 Cᴏɪɴ Fʟɪᴘ Gᴀᴍᴇ
// ============================================================
router.post('/headtail', verifyToken, async (req, res) => {
    try {
        console.log('📥 Coin Flip Request Received');
        console.log('📦 Request Body:', req.body);
        
        const user = req.user;
        const { amount, choice } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Vᴀʟɪᴅ Aᴍᴏᴜɴᴛ Rᴇǫᴜɪʀᴇᴅ' 
            });
        }

        const minBet = 5;
        if (amount < minBet) {
            return res.status(400).json({
                success: false,
                message: `Mɪɴɪᴍᴜᴍ Bᴇᴛ Iꜱ ₹${minBet}`
            });
        }

        const maxBet = 100000;
        if (amount > maxBet) {
            return res.status(400).json({
                success: false,
                message: `Mᴀxɪᴍᴜᴍ Bᴇᴛ Iꜱ ₹${maxBet}`
            });
        }

        if (!choice || !['heads', 'head', 'tails', 'tail'].includes(choice.toLowerCase())) {
            return res.status(400).json({ 
                success: false, 
                message: 'Pʟᴇᴀꜱᴇ Cʜᴏᴏꜱᴇ Hᴇᴀᴅ Oʀ Tᴀɪʟ' 
            });
        }

        const normalizedChoice = choice.toLowerCase() === 'heads' || choice.toLowerCase() === 'head' ? 'heads' : 'tails';
        const betAmount = parseFloat(amount);

        if (user.balance < betAmount) {
            return res.status(400).json({
                success: false,
                message: `Iɴꜱᴜꜰꜰɪᴄɪᴇɴᴛ Bᴀʟᴀɴᴄᴇ. Cᴜʀʀᴇɴᴛ: ₹${user.balance.toFixed(2)}`
            });
        }

        const outcome = Math.random() < 0.5 ? 'heads' : 'tails';
        const isWin = normalizedChoice === outcome;
        const payoutMultiplier = 2;
        
        let winAmount = 0;
        let newBalance = user.balance;

        if (isWin) {
            winAmount = betAmount * payoutMultiplier;
            newBalance = user.balance + winAmount;
            user.balance = newBalance;
            await user.save();

            await Transaction.create({
                user_id: user._id,
                sender_id: user._id,
                receiver_id: user._id,
                amount: winAmount,
                type: 'game_win',
                status: 'success',
                remark: `Cᴏɪɴ Fʟɪᴘ Wɪɴ: ${normalizedChoice.toUpperCase()} → ${outcome.toUpperCase()} (${payoutMultiplier}x)`,
                description: `Cᴏɪɴ Fʟɪᴘ Gᴀᴍᴇ Wɪɴ (${normalizedChoice} → ${outcome})`,
                tx_time: new Date()
            });

        } else {
            newBalance = user.balance - betAmount;
            user.balance = newBalance;
            await user.save();

            await Transaction.create({
                user_id: user._id,
                sender_id: user._id,
                receiver_id: user._id,
                amount: betAmount,
                type: 'game_loss',
                status: 'success',
                remark: `Cᴏɪɴ Fʟɪᴘ Lᴏꜱꜱ: ${normalizedChoice.toUpperCase()} → ${outcome.toUpperCase()}`,
                description: `Cᴏɪɴ Fʟɪᴘ Gᴀᴍᴇ Lᴏꜱꜱ (${normalizedChoice} → ${outcome})`,
                tx_time: new Date()
            });
        }

        return res.json({
            success: true,
            result: isWin ? 'win' : 'loss',
            choice: normalizedChoice,
            outcome: outcome,
            winAmount: isWin ? winAmount : 0,
            betAmount: betAmount,
            newBalance: newBalance,
            payoutMultiplier: payoutMultiplier,
            message: isWin ? `🎉 Yᴏᴜ Wɪɴ ₹${winAmount}!` : `😢 Yᴏᴜ Lᴏꜱᴛ ₹${betAmount}!`
        });

    } catch (error) {
        console.error('Cᴏɪɴ Fʟɪᴘ Eʀʀᴏʀ:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Gᴀᴍᴇ Pʀᴏᴄᴇꜱꜱɪɴɢ Fᴀɪʟᴇᴅ: ' + error.message 
        });
    }
});

// ============================================================
// 🎮 Rᴇᴅ / Gʀᴇᴇɴ Gᴀᴍᴇ
// ============================================================
router.post('/redgreen', verifyToken, async (req, res) => {
    try {
        console.log('📥 Red/Green Request Received');
        console.log('📦 Request Body:', req.body);
        
        const user = req.user;
        const { amount, choice } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Vᴀʟɪᴅ Aᴍᴏᴜɴᴛ Rᴇǫᴜɪʀᴇᴅ' 
            });
        }

        const minBet = 5;
        if (amount < minBet) {
            return res.status(400).json({
                success: false,
                message: `Mɪɴɪᴍᴜᴍ Bᴇᴛ Iꜱ ₹${minBet}`
            });
        }

        const maxBet = 100000;
        if (amount > maxBet) {
            return res.status(400).json({
                success: false,
                message: `Mᴀxɪᴍᴜᴍ Bᴇᴛ Iꜱ ₹${maxBet}`
            });
        }

        if (!choice || !['red', 'green'].includes(choice)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Pʟᴇᴀꜱᴇ Cʜᴏᴏꜱᴇ Rᴇᴅ Oʀ Gʀᴇᴇɴ' 
            });
        }

        const betAmount = parseFloat(amount);

        if (user.balance < betAmount) {
            return res.status(400).json({
                success: false,
                message: `Iɴꜱᴜꜰꜰɪᴄɪᴇɴᴛ Bᴀʟᴀɴᴄᴇ. Cᴜʀʀᴇɴᴛ: ₹${user.balance.toFixed(2)}`
            });
        }

        const outcome = Math.random() < 0.5 ? 'red' : 'green';
        const isWin = choice === outcome;
        const payoutMultiplier = 2;
        
        let winAmount = 0;
        let newBalance = user.balance;

        if (isWin) {
            winAmount = betAmount * payoutMultiplier;
            newBalance = user.balance + winAmount;
            user.balance = newBalance;
            await user.save();

            await Transaction.create({
                user_id: user._id,
                sender_id: user._id,
                receiver_id: user._id,
                amount: winAmount,
                type: 'game_win',
                status: 'success',
                remark: `Rᴇᴅ/Gʀᴇᴇɴ Wɪɴ: ${choice.toUpperCase()} → ${outcome.toUpperCase()} (${payoutMultiplier}x)`,
                description: `Rᴇᴅ/Gʀᴇᴇɴ Gᴀᴍᴇ Wɪɴ (${choice} → ${outcome})`,
                tx_time: new Date()
            });

        } else {
            newBalance = user.balance - betAmount;
            user.balance = newBalance;
            await user.save();

            await Transaction.create({
                user_id: user._id,
                sender_id: user._id,
                receiver_id: user._id,
                amount: betAmount,
                type: 'game_loss',
                status: 'success',
                remark: `Rᴇᴅ/Gʀᴇᴇɴ Lᴏꜱꜱ: ${choice.toUpperCase()} → ${outcome.toUpperCase()}`,
                description: `Rᴇᴅ/Gʀᴇᴇɴ Gᴀᴍᴇ Lᴏꜱꜱ (${choice} → ${outcome})`,
                tx_time: new Date()
            });
        }

        return res.json({
            success: true,
            result: isWin ? 'win' : 'loss',
            choice: choice,
            outcome: outcome,
            winAmount: isWin ? winAmount : 0,
            betAmount: betAmount,
            newBalance: newBalance,
            payoutMultiplier: payoutMultiplier,
            message: isWin ? `🎉 Yᴏᴜ Wɪɴ ₹${winAmount}!` : `😢 Yᴏᴜ Lᴏꜱᴛ ₹${betAmount}!`
        });

    } catch (error) {
        console.error('Rᴇᴅ/Gʀᴇᴇɴ Eʀʀᴏʀ:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Gᴀᴍᴇ Pʀᴏᴄᴇꜱꜱɪɴɢ Fᴀɪʟᴇᴅ: ' + error.message 
        });
    }
});

// ============================================================
// ✈️ Aᴠɪᴀᴛᴏʀ Gᴀᴍᴇ - Pʟᴀʏ
// ============================================================
router.post('/aviator/play', verifyToken, async (req, res) => {
    try {
        console.log('📥 Aviator Play Request Received');
        console.log('📦 Request Body:', req.body);
        
        const user = req.user;
        const { amount, cashout } = req.body;

        if (!amount || amount <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Vᴀʟɪᴅ Aᴍᴏᴜɴᴛ Rᴇǫᴜɪʀᴇᴅ' 
            });
        }

        const minBet = 5;
        if (amount < minBet) {
            return res.status(400).json({
                success: false,
                message: `Mɪɴɪᴍᴜᴍ Bᴇᴛ Iꜱ ₹${minBet}`
            });
        }

        const maxBet = 100000;
        if (amount > maxBet) {
            return res.status(400).json({
                success: false,
                message: `Mᴀxɪᴍᴜᴍ Bᴇᴛ Iꜱ ₹${maxBet}`
            });
        }

        if (!cashout || cashout < 1.01) {
            return res.status(400).json({
                success: false,
                message: 'Cᴀsʜᴏᴜᴛ Mᴜʟᴛɪᴘʟɪᴇʀ Mɪɴ 1.01x'
            });
        }

        if (cashout > 100) {
            return res.status(400).json({
                success: false,
                message: 'Mᴀx Cᴀsʜᴏᴜᴛ Mᴜʟᴛɪᴘʟɪᴇʀ Iꜱ 100x'
            });
        }

        const betAmount = parseFloat(amount);

        if (user.balance < betAmount) {
            return res.status(400).json({
                success: false,
                message: `Iɴꜱᴜꜰꜰɪᴄɪᴇɴᴛ Bᴀʟᴀɴᴄᴇ. Cᴜʀʀᴇɴᴛ: ₹${user.balance.toFixed(2)}`
            });
        }

        // Generate random crash point between 1.01 and 100
        const crashPoint = Math.round((Math.random() * 98.99 + 1.01) * 100) / 100;
        
        // Player wins if cashout is LESS than crash point
        const isWin = cashout < crashPoint;
        
        let winAmount = 0;
        let newBalance = user.balance;

        if (isWin) {
            winAmount = betAmount * cashout;
            newBalance = user.balance + winAmount;
            user.balance = newBalance;
            await user.save();

            await Transaction.create({
                user_id: user._id,
                sender_id: user._id,
                receiver_id: user._id,
                amount: winAmount,
                type: 'game_win',
                status: 'success',
                remark: `Aᴠɪᴀᴛᴏʀ Wɪɴ: ${cashout}x (Cʀᴀsʜ: ${crashPoint.toFixed(2)}x)`,
                description: `Aᴠɪᴀᴛᴏʀ Gᴀᴍᴇ Wɪɴ (${cashout}x)`,
                tx_time: new Date()
            });

        } else {
            newBalance = user.balance - betAmount;
            user.balance = newBalance;
            await user.save();

            await Transaction.create({
                user_id: user._id,
                sender_id: user._id,
                receiver_id: user._id,
                amount: betAmount,
                type: 'game_loss',
                status: 'success',
                remark: `Aᴠɪᴀᴛᴏʀ Lᴏꜱꜱ: Cʀᴀsʜ ᴀᴛ ${crashPoint.toFixed(2)}x (Cᴀsʜᴏᴜᴛ: ${cashout}x)`,
                description: `Aᴠɪᴀᴛᴏʀ Gᴀᴍᴇ Lᴏꜱꜱ`,
                tx_time: new Date()
            });
        }

        return res.json({
            success: true,
            result: isWin ? 'win' : 'loss',
            cashout: cashout,
            crashPoint: crashPoint,
            winAmount: isWin ? winAmount : 0,
            betAmount: betAmount,
            newBalance: newBalance,
            message: isWin ? `🎉 Yᴏᴜ Wɪɴ ₹${winAmount}!` : `😢 Yᴏᴜ Lᴏꜱᴛ ₹${betAmount}! Cʀᴀsʜ ᴀᴛ ${crashPoint.toFixed(2)}x`
        });

    } catch (error) {
        console.error('Aᴠɪᴀᴛᴏʀ Pʟᴀʏ Eʀʀᴏʀ:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Gᴀᴍᴇ Pʀᴏᴄᴇꜱꜱɪɴɢ Fᴀɪʟᴇᴅ: ' + error.message 
        });
    }
});

// ============================================================
// ✈️ Aᴠɪᴀᴛᴏʀ Gᴀᴍᴇ - Hɪꜱᴛᴏʀʏ
// ============================================================
router.get('/aviator/history', verifyToken, async (req, res) => {
    try {
        const history = await Transaction.find({
            user_id: req.user._id,
            type: { $in: ['game_win', 'game_loss'] },
            'remark': { $regex: 'Aᴠɪᴀᴛᴏʀ', $options: 'i' }
        })
        .sort({ tx_time: -1 })
        .limit(20);

        const formatted = history.map(tx => {
            const isWin = tx.type === 'game_win';
            return {
                amount: tx.amount,
                isWin: isWin,
                remark: tx.remark || '',
                time: tx.tx_time || tx.createdAt
            };
        });

        res.json({
            success: true,
            history: formatted
        });
    } catch (error) {
        console.error('Aᴠɪᴀᴛᴏʀ Hɪꜱᴛᴏʀʏ Eʀʀᴏʀ:', error);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Hɪꜱᴛᴏʀʏ' });
    }
});

// ============================================================
// 📊 Lɪᴠᴇ Fᴇᴇᴅ - Gᴇᴛ Rᴇᴄᴇɴᴛ Gᴀᴍᴇ Aᴄᴛɪᴠɪᴛʏ
// ============================================================
router.get('/live-feed', verifyToken, async (req, res) => {
    try {
        const activities = await Transaction.find({
            type: { $in: ['game_win', 'game_loss'] }
        })
        .sort({ tx_time: -1 })
        .limit(50)
        .populate('user_id', 'name username');

        const formatted = activities.map(tx => {
            const user = tx.user_id || {};
            return {
                id: tx._id,
                user: user.name || user.username || 'User',
                userName: user.name || user.username || 'User',
                type: tx.type,
                amount: tx.amount,
                betAmount: tx.amount,
                remark: tx.remark || tx.description || 'Game',
                tx_time: tx.tx_time || tx.createdAt,
                createdAt: tx.createdAt || tx.tx_time
            };
        });

        res.json({
            success: true,
            activities: formatted
        });
    } catch (error) {
        console.error('Lɪᴠᴇ Fᴇᴇᴅ Eʀʀᴏʀ:', error);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Lᴏᴀᴅ Fᴇᴇᴅ' });
    }
});

// ============================================================
// 📊 Gᴇᴛ Tᴏᴅᴀʏ's Sᴛᴀᴛꜱ
// ============================================================
router.get('/stats', verifyToken, async (req, res) => {
    try {
        const user = req.user;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const todayTxs = await Transaction.find({
            user_id: user._id,
            type: { $in: ['game_win', 'game_loss'] },
            tx_time: { $gte: today, $lt: tomorrow }
        });

        let totalWinAmount = 0;
        let totalLossAmount = 0;
        let totalWins = 0;
        let totalLosses = 0;

        todayTxs.forEach(tx => {
            if (tx.type === 'game_win') {
                totalWinAmount += tx.amount;
                totalWins++;
            } else {
                totalLossAmount += tx.amount;
                totalLosses++;
            }
        });

        const profit = totalWinAmount - totalLossAmount;

        res.json({
            success: true,
            stats: {
                totalWins: totalWins || 0,
                totalLosses: totalLosses || 0,
                totalWinAmount: totalWinAmount || 0,
                totalLossAmount: totalLossAmount || 0,
                totalProfit: profit || 0
            }
        });

    } catch (error) {
        console.error('Gᴀᴍᴇ Sᴛᴀᴛꜱ Eʀʀᴏʀ:', error);
        res.status(500).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Sᴛᴀᴛꜱ' });
    }
});

module.exports = router;
