// FILE: routes/wallet.js
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

const JWT_SECRET = process.env.JWT_SECRET;

// ==================== VERIFY TOKEN MIDDLEWARE ====================
const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ success: false, message: 'No Token Provided' });
        }
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.status(401).json({ success: false, message: 'User Not Found' });
        }
        req.user = user;
        next();
    } catch (error) {
        console.error('Token verification error:', error);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ success: false, message: 'Invalid Token. Please Login Again.' });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Token Expired. Please Login Again.' });
        }
        return res.status(500).json({ success: false, message: 'Authentication Error' });
    }
};

// ============================================
// HELPER: Determine Transaction Method
// ============================================
function getTransactionMethod(tx) {
    if (tx.metadata && tx.metadata.method) return tx.metadata.method;
    if (tx.type === 'api') return 'API Transfer';
    if (tx.type === 'invoice_pay_send' || tx.type === 'invoice_pay_receive' || 
        tx.type === 'invoice_payment' || tx.type === 'invoice_pay') return 'Invoice';
    if (tx.type === 'deposit' || tx.type === 'manual-deposit' || 
        tx.type === 'auto-deposit' || tx.type === 'web-deposit') return 'Deposit';
    if (tx.type === 'withdraw' || tx.type === 'withdrawal') return 'Withdrawal';
    if (tx.type === 'admin_add' || tx.type === 'admin_deduct') return 'Admin';
    if (tx.type === 'game_win' || tx.type === 'game_loss') return 'Game';
    if (tx.type === 'lifafa_creation' || tx.type === 'lifafa_claim') return 'Lifafa';
    if (tx.type === 'gift') return 'Gift';
    return 'Transfer';
}

// ============================================
// HELPER: Determine Transaction Category
// ============================================
function getTransactionCategory(tx) {
    if (tx.metadata && tx.metadata.category) return tx.metadata.category;
    if (tx.type === 'transfer_send') return 'P2P sent';
    if (tx.type === 'transfer_receive') return 'P2P received';
    if (tx.type === 'api') return 'P2P';
    if (tx.type === 'invoice_pay_send') return 'Invoice sent';
    if (tx.type === 'invoice_pay_receive') return 'Invoice received';
    if (tx.type === 'deposit' || tx.type === 'manual-deposit' || 
        tx.type === 'auto-deposit' || tx.type === 'web-deposit') return 'Deposit';
    if (tx.type === 'withdraw' || tx.type === 'withdrawal') return 'Withdrawal';
    if (tx.type === 'admin_add') return 'Admin credit';
    if (tx.type === 'admin_deduct') return 'Admin debit';
    if (tx.type === 'game_win') return 'Game win';
    if (tx.type === 'game_loss') return 'Game loss';
    if (tx.type === 'lifafa_creation') return 'Lifafa created';
    if (tx.type === 'lifafa_claim') return 'Lifafa claimed';
    if (tx.type === 'gift') return 'Gift';
    return 'transfer';
}

// ============================================
// HELPER: Transform Transaction for Frontend
// ============================================
function transformTransaction(txObj, user) {
    let transactionType = txObj.type || 'unknown';
    
    const isSender = txObj.sender_id && txObj.sender_id._id && 
                   txObj.sender_id._id.toString() === user._id.toString();
    const isReceiver = txObj.receiver_id && txObj.receiver_id._id && 
                     txObj.receiver_id._id.toString() === user._id.toString();
    
    // ===== TRANSFER =====
    if (txObj.type === 'transfer_send' || txObj.type === 'transfer_receive') {
        if (txObj.type === 'transfer_send') transactionType = 'payment_sent';
        else if (txObj.type === 'transfer_receive') transactionType = 'payment_received';
    }
    // ===== INVOICE PAYMENT =====
    else if (txObj.type === 'invoice_payment' || txObj.type === 'invoice_pay' ||
        txObj.type === 'invoice_pay_send' || txObj.type === 'invoice_pay_receive') {
        if (txObj.type === 'invoice_pay_receive' || isReceiver) transactionType = 'invoice_received';
        else if (txObj.type === 'invoice_pay_send' || isSender) transactionType = 'invoice_paid';
        else transactionType = 'invoice_payment';
    }
    else if (isSender && (txObj.type === 'transfer' || txObj.type === 'api' || txObj.type === 'withdraw')) {
        transactionType = 'payment_sent';
    } else if (isReceiver && (txObj.type === 'transfer' || txObj.type === 'api' || txObj.type === 'deposit')) {
        transactionType = 'payment_received';
    } else if (txObj.type === 'deposit') {
        transactionType = 'payment_received';
    } else if (txObj.type === 'withdraw' || txObj.type === 'withdrawal') {
        transactionType = 'payment_sent';
    }
    
    if (transactionType === txObj.type && txObj.metadata && txObj.metadata.transactionType) {
        transactionType = txObj.metadata.transactionType;
    }
    
    return {
        _id: txObj._id,
        tx_id: txObj.tx_id,
        user_id: txObj.user_id,
        sender_id: txObj.sender_id,
        receiver_id: txObj.receiver_id,
        sender: txObj.sender_id,
        receiver: txObj.receiver_id,
        amount: txObj.amount,
        fee: txObj.fee || 0,
        type: txObj.type,
        transactionType: transactionType,
        status: txObj.status || 'success',
        remark: txObj.remark,
        description: txObj.description,
        tx_time: txObj.tx_time,
        createdAt: txObj.createdAt,
        metadata: txObj.metadata || {},
        method: getTransactionMethod(txObj),
        category: getTransactionCategory(txObj),
        balanceAfter: (txObj.metadata && txObj.metadata.balanceAfter !== undefined && txObj.metadata.balanceAfter !== null)
            ? txObj.metadata.balanceAfter 
            : null
    };
}

// ============================================
// GET WALLET BALANCE
// ============================================
router.get('/balance', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        res.json({
            status: 'success',
            data: {
                balance: user.balance || 0,
                walletId: user.walletId,
                fullName: user.fullName,
                mobile: user.mobile,
                email: user.email
            }
        });
    } catch (error) {
        console.error('Get balance error:', error);
        res.status(500).json({ status: 'error', message: 'Failed To Fetch Balance' });
    }
});

// ============================================
// CREATE TRANSACTION (For Games)
// ============================================
router.post('/transaction', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        const { type, amount, remark, status = 'success', metadata = {} } = req.body;
        
        if (!type || !amount || amount <= 0) {
            return res.status(400).json({ status: 'error', message: 'Invalid Transaction Data' });
        }
        
        let newBalance = parseFloat(user.balance) || 0;
        const parsedAmount = parseFloat(amount);
        
        if (type === 'game_win' || type === 'win') {
            newBalance = newBalance + parsedAmount;
            user.balance = newBalance;
        } else if (type === 'game_loss' || type === 'loss') {
            newBalance = newBalance - parsedAmount;
            user.balance = newBalance;
        }
        
        await user.save();
        
        const transaction = new Transaction({
            user_id: user._id,
            sender_id: user._id,
            receiver_id: user._id,
            amount: parsedAmount,
            type: type,
            status: status || 'success',
            remark: remark || '',
            description: remark || '',
            tx_time: new Date(),
            metadata: {
                ...metadata,
                transactionType: type,
                source: 'game',
                balanceAfter: newBalance,
                method: type === 'game_win' || type === 'game_loss' ? 'Game' : 'Transfer',
                category: type === 'game_win' ? 'Game win' : (type === 'game_loss' ? 'Game loss' : 'transfer')
            }
        });
        
        await transaction.save();
        
        res.json({
            status: 'success',
            transaction: {
                _id: transaction._id,
                amount: transaction.amount,
                type: transaction.type,
                remark: transaction.remark,
                tx_time: transaction.tx_time
            },
            newBalance: parseFloat(user.balance) || 0
        });
        
    } catch (error) {
        console.error('❌ Create transaction error:', error);
        res.status(500).json({ status: 'error', message: 'Failed To Create Transaction: ' + error.message });
    }
});

// ============================================
// GET TRANSACTIONS
// ============================================
router.get('/transactions', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        const { limit = 50, page = 1, type, status } = req.query;
        const skip = (page - 1) * limit;
        
        let query = {
            $or: [
                { user_id: user._id },
                { sender_id: user._id },
                { receiver_id: user._id }
            ]
        };
        
        if (type) query.type = type;
        if (status) query.status = status;
        
        const transactions = await Transaction.find(query)
            .populate('sender_id', 'fullName username mobile walletId email')
            .populate('receiver_id', 'fullName username mobile walletId email')
            .sort({ tx_time: -1 })
            .skip(parseInt(skip))
            .limit(parseInt(limit));
        
        const total = await Transaction.countDocuments(query);
        
        const transformedTransactions = transactions.map(tx => {
            const txObj = tx.toObject ? tx.toObject() : tx;
            return transformTransaction(txObj, user);
        });
        
        res.json({
            status: 'success',
            transactions: transformedTransactions,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('❌ Get Transactions Error:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed To Fetch Transactions: ' + error.message });
    }
});

// ============================================
// GET SINGLE TRANSACTION
// ============================================
router.get('/transaction/:id', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        const { id } = req.params;
        
        const transaction = await Transaction.findOne({
            _id: id,
            $or: [{ sender_id: user._id }, { receiver_id: user._id }]
        })
        .populate('sender_id', 'fullName username mobile walletId email')
        .populate('receiver_id', 'fullName username mobile walletId email');
        
        if (!transaction) {
            return res.status(404).json({ status: 'error', message: 'Transaction Not Found' });
        }
        
        res.json({ status: 'success', transaction });
    } catch (error) {
        console.error('Get transaction error:', error);
        res.status(500).json({ status: 'error', message: 'Failed To Fetch Transaction' });
    }
});

// ============================================
// GET RECENT TRANSACTIONS (For Dashboard)
// ============================================
router.get('/recent', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        const { limit = 5 } = req.query;
        
        const query = {
            $or: [
                { user_id: user._id },
                { sender_id: user._id },
                { receiver_id: user._id }
            ]
        };
        
        const transactions = await Transaction.find(query)
            .populate('sender_id', 'fullName username mobile walletId email')
            .populate('receiver_id', 'fullName username mobile walletId email')
            .sort({ tx_time: -1 })
            .limit(parseInt(limit));
        
        const transformedTransactions = transactions.map(tx => {
            const txObj = tx.toObject ? tx.toObject() : tx;
            return transformTransaction(txObj, user);
        });
        
        res.json({ status: 'success', transactions: transformedTransactions });
    } catch (error) {
        console.error('❌ Get Recent Transactions Error:', error.message);
        res.status(500).json({ status: 'error', message: 'Failed To Fetch Recent Transactions' });
    }
});

module.exports = router;
