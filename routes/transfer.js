// FILE: routes/transfer.js
const router = require('express').Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const axios = require('axios');
require('dotenv').config();

// CONSTANTS
const JWT_SECRET = process.env.JWT_SECRET;
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_TG = process.env.ADMIN_TG_ID;

// ============================================
// HELPER: Generate Unique Transaction ID
// ============================================
async function generateUniqueTransactionId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
        const length = Math.floor(Math.random() * 9) + 12;
        let result = 'TXN';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        const existing = await Transaction.findOne({ tx_id: result });
        if (!existing) {
            return result;
        }
        
        attempts++;
        console.log(`⚠️ Dᴜᴘʟɪᴄᴀᴛᴇ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ Fᴏᴜɴᴅ: ${result}, Rᴇᴛʀʏɪɴɢ...`);
    }
    
    const timestamp = Date.now().toString(36).toUpperCase();
    return `TXN${timestamp}${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

// ============================================
// VERIFY TOKEN MIDDLEWARE
// ============================================
const verifyToken = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        
        if (!token) {
            console.log('❌ Nᴏ Tᴏᴋᴇɴ Pʀᴏᴠɪᴅᴇᴅ');
            return res.status(401).json({ 
                success: false, 
                message: 'Nᴏ Tᴏᴋᴇɴ Pʀᴏᴠɪᴅᴇᴅ' 
            });
        }
        
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId);
        
        if (!user) {
            console.log('❌ Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ');
            return res.status(401).json({ 
                success: false, 
                message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ' 
            });
        }
        
        req.user = user;
        next();
    } catch (error) {
        console.error('❌ Tᴏᴋᴇɴ Vᴇʀɪꜰɪᴄᴀᴛɪᴏɴ Eʀʀᴏʀ:', error.message);
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Iɴᴠᴀʟɪᴅ Tᴏᴋᴇɴ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ Aɢᴀɪɴ.' 
            });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false, 
                message: 'Tᴏᴋᴇɴ Exᴘɪʀᴇᴅ. Pʟᴇᴀꜱᴇ Lᴏɢɪɴ Aɢᴀɪɴ.' 
            });
        }
        return res.status(500).json({ 
            success: false, 
            message: 'Aᴜᴛʜᴇɴᴛɪᴄᴀᴛɪᴏɴ Eʀʀᴏʀ' 
        });
    }
};

// ============================================
// HELPER: Send Message Via Telegram
// ============================================
async function sendTelegramMessage(chatId, message) {
    if (!BOT_TOKEN) {
        console.log('⚠️ Bᴏᴛ Tᴏᴋᴇɴ Nᴏᴛ Cᴏɴꜰɪɢᴜʀᴇᴅ');
        return { success: false, error: 'BOT_TOKEN not configured' };
    }

    try {
        const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
        
        console.log('📤 Sᴇɴᴅɪɴɢ Tᴇʟᴇɢʀᴀᴍ Mᴇꜱꜱᴀɢᴇ Tᴏ Cʜᴀᴛ:', chatId);
        
        const response = await axios.post(url, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        }, {
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data && response.data.ok) {
            console.log('✅ Tᴇʟᴇɢʀᴀᴍ Mᴇꜱꜱᴀɢᴇ Sᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ Tᴏ Cʜᴀᴛ:', chatId);
            return { success: true };
        } else {
            console.error('❌ Tᴇʟᴇɢʀᴀᴍ API Rᴇꜱᴘᴏɴꜱᴇ:', response.data?.description || 'Uɴᴋɴᴏᴡɴ Eʀʀᴏʀ');
            return { success: false, error: response.data?.description || 'Uɴᴋɴᴏᴡɴ Eʀʀᴏʀ' };
        }
    } catch (error) {
        console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Tᴇʟᴇɢʀᴀᴍ Mᴇꜱꜱᴀɢᴇ:', error.message);
        if (error.response) {
            console.error('Tᴇʟᴇɢʀᴀᴍ API Rᴇꜱᴘᴏɴꜱᴇ:', error.response.data);
        }
        if (error.code === 'ECONNABORTED') {
            return { success: false, error: 'Tᴇʟᴇɢʀᴀᴍ API Tɪᴍᴇ Oᴜᴛ' };
        }
        return { success: false, error: error.message };
    }
}

// ============================================
// HELPER: Send Notification To Admin
// ============================================
async function notifyAdmin(message) {
    if (!ADMIN_TG) {
        console.log('⚠️ Aᴅᴍɪɴ Tᴇʟᴇɢʀᴀᴍ Iᴅ Nᴏᴛ Cᴏɴꜰɪɢᴜʀᴇᴅ');
        return;
    }
    try {
        await sendTelegramMessage(ADMIN_TG, message);
        console.log('✅ Aᴅᴍɪɴ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Sᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ');
    } catch (error) {
        console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Aᴅᴍɪɴ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ:', error.message);
    }
}

// ============================================
// HELPER: Send Notification To User
// ============================================
async function notifyUser(chatId, message) {
    if (!chatId) return;
    try {
        await sendTelegramMessage(chatId, message);
        console.log('✅ Uꜱᴇʀ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Sᴇɴᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ');
    } catch (error) {
        console.error('❌ Fᴀɪʟᴇᴅ Tᴏ Sᴇɴᴅ Uꜱᴇʀ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ:', error.message);
    }
}

// ============================================
// HELPER: Get Current Date And Time In IST
// ============================================
function getCurrentDateTime() {
    const now = new Date();
    const options = {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    };
    return now.toLocaleString('en-IN', options);
}

// ============================================
// HELPER: Get Client IP
// ============================================
function getClientIp(req) {
    return req.headers['x-forwarded-for'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress || 
           req.ip || 
           'Unknown';
}

// ============================================
// VIEW USER DETAILS - GET /api/transfer/view
// ============================================
router.get('/view', verifyToken, async (req, res) => {
    try {
        const { number } = req.query;
        const currentUser = req.user;
        
        console.log('🔍 Uꜱᴇʀ Lᴏᴏᴋᴜᴘ Rᴇǫᴜᴇꜱᴛ:', number);
        
        if (!number) {
            console.log('❌ Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ Rᴇǫᴜɪʀᴇᴅ');
            return res.status(400).json({
                status: 'error',
                error: 'Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ Iꜱ Rᴇǫᴜɪʀᴇᴅ'
            });
        }
        
        if (!/^\d{10}$/.test(number)) {
            console.log('❌ Iɴᴠᴀʟɪᴅ Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ');
            return res.status(400).json({
                status: 'error',
                error: 'Iɴᴠᴀʟɪᴅ Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ. Mᴜꜱᴛ Bᴇ 10 Dɪɢɪᴛꜱ.'
            });
        }
        
        if (currentUser.mobile === number) {
            console.log('❌ Sᴇʟꜰ Lᴏᴏᴋᴜᴘ Aᴛᴛᴇᴍᴘᴛ');
            return res.status(400).json({
                status: 'error',
                error: 'Yᴏᴜ Cᴀɴɴᴏᴛ Vɪᴇᴡ Yᴏᴜʀ Oᴡɴ Dᴇᴛᴀɪʟꜱ Hᴇʀᴇ'
            });
        }
        
        const user = await User.findOne({ mobile: number });
        if (!user) {
            console.log('❌ Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ:', number);
            return res.status(404).json({
                status: 'error',
                error: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ'
            });
        }
        
        if (user.isBlocked) {
            console.log('❌ Uꜱᴇʀ Aᴄᴄᴏᴜɴᴛ Bʟᴏᴄᴋᴇᴅ');
            return res.status(403).json({
                status: 'error',
                error: 'Tʜɪꜱ Uꜱᴇʀ Aᴄᴄᴏᴜɴᴛ Iꜱ Bʟᴏᴄᴋᴇᴅ'
            });
        }
        
        console.log('✅ Uꜱᴇʀ Fᴏᴜɴᴅ:', user.fullName);
        
        res.json({
            status: 'success',
            name: user.fullName,
            mobile: user.mobile,
            walletId: user.walletId,
            isVerified: true
        });
        
    } catch (error) {
        console.error('❌ Vɪᴇᴡ Uꜱᴇʀ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            status: 'error',
            error: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Uꜱᴇʀ Dᴇᴛᴀɪʟꜱ'
        });
    }
});

// ============================================
// GET BALANCE - GET /api/transfer/balance
// ============================================
router.get('/balance', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        
        console.log('💰 Bᴀʟᴀɴᴄᴇ Cʜᴇᴄᴋ Fᴏʀ:', user.mobile);
        
        res.json({
            status: 'success',
            balance: user.balance,
            walletId: user.walletId,
            fullName: user.fullName
        });
        
    } catch (error) {
        console.error('❌ Bᴀʟᴀɴᴄᴇ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            status: 'error',
            error: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Bᴀʟᴀɴᴄᴇ'
        });
    }
});

// ============================================
// SEND MONEY (TRANSFER) - POST /api/transfer/
// ============================================
router.post('/', verifyToken, async (req, res) => {
    try {
        const { mobile, amount, note } = req.body;
        const sender = req.user;
        const dateTime = getCurrentDateTime();
        const clientIp = getClientIp(req);
        
        console.log('📤 Tʀᴀɴꜱꜰᴇʀ Rᴇǫᴜᴇꜱᴛ:', { 
            Sᴇɴᴅᴇʀ: sender.mobile, 
            Rᴇᴄᴇɪᴠᴇʀ: mobile, 
            Aᴍᴏᴜɴᴛ: amount 
        });
        
        // Validation
        if (!mobile || !mobile.toString().trim()) {
            console.log('❌ Rᴇᴄᴇɪᴠᴇʀ Mᴏʙɪʟᴇ Rᴇǫᴜɪʀᴇᴅ');
            return res.status(400).json({ 
                success: false, 
                error: 'Rᴇᴄᴇɪᴠᴇʀ Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ Iꜱ Rᴇǫᴜɪʀᴇᴅ' 
            });
        }
        
        const mobileNumber = mobile.toString().trim();
        
        if (mobileNumber.length !== 10 || !/^\d{10}$/.test(mobileNumber)) {
            console.log('❌ Iɴᴠᴀʟɪᴅ Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ');
            return res.status(400).json({ 
                success: false, 
                error: 'Pʟᴇᴀꜱᴇ Eɴᴛᴇʀ A Vᴀʟɪᴅ 10-Dɪɢɪᴛ Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ' 
            });
        }
        
        const transferAmount = parseFloat(amount);
        if (isNaN(transferAmount) || transferAmount < 1) {
            console.log('❌ Iɴᴠᴀʟɪᴅ Aᴍᴏᴜɴᴛ');
            return res.status(400).json({ 
                success: false, 
                error: 'Mɪɴɪᴍᴜᴍ Tʀᴀɴꜱꜰᴇʀ Aᴍᴏᴜɴᴛ Iꜱ ₹1' 
            });
        }
        
        if (transferAmount > 5000) {
            console.log('❌ Mᴀxɪᴍᴜᴍ Aᴍᴏᴜɴᴛ Exᴄᴇᴇᴅᴇᴅ');
            return res.status(400).json({ 
                success: false, 
                error: 'Mᴀxɪᴍᴜᴍ Tʀᴀɴꜱꜰᴇʀ Aᴍᴏᴜɴᴛ Iꜱ ₹5,000' 
            });
        }
        
        if (sender.mobile === mobileNumber) {
            console.log('❌ Sᴇʟꜰ Tʀᴀɴꜱꜰᴇʀ Aᴛᴛᴇᴍᴘᴛ');
            return res.status(400).json({ 
                success: false, 
                error: 'Yᴏᴜ Cᴀɴɴᴏᴛ Sᴇɴᴅ Mᴏɴᴇʏ Tᴏ Yᴏᴜʀꜱᴇʟꜰ' 
            });
        }
        
        const receiver = await User.findOne({ mobile: mobileNumber });
        
        if (!receiver) {
            console.log('❌ Rᴇᴄᴇɪᴠᴇʀ Nᴏᴛ Fᴏᴜɴᴅ:', mobileNumber);
            return res.status(404).json({ 
                success: false, 
                error: 'Rᴇᴄᴇɪᴠᴇʀ Nᴏᴛ Fᴏᴜɴᴅ. Pʟᴇᴀꜱᴇ Vᴇʀɪꜰʏ Tʜᴇ Mᴏʙɪʟᴇ Nᴜᴍʙᴇʀ' 
            });
        }
        
        if (receiver.isBlocked) {
            console.log('❌ Rᴇᴄᴇɪᴠᴇʀ Aᴄᴄᴏᴜɴᴛ Bʟᴏᴄᴋᴇᴅ');
            return res.status(403).json({ 
                success: false, 
                error: 'Rᴇᴄᴇɪᴠᴇʀ Aᴄᴄᴏᴜɴᴛ Iꜱ Bʟᴏᴄᴋᴇᴅ' 
            });
        }
        
        if (sender.balance < transferAmount) {
            console.log('❌ Iɴꜱᴜꜰꜰɪᴄɪᴇɴᴛ Bᴀʟᴀɴᴄᴇ:', sender.balance);
            return res.status(400).json({ 
                success: false, 
                error: `Iɴꜱᴜꜰꜰɪᴄɪᴇɴᴛ Bᴀʟᴀɴᴄᴇ. Yᴏᴜʀ Cᴜʀʀᴇɴᴛ Bᴀʟᴀɴᴄᴇ Iꜱ ₹${sender.balance.toFixed(2)}` 
            });
        }
        
        // Start Transaction
        const session = await User.startSession();
        session.startTransaction();
        
        try {
            console.log('🔄 Pʀᴏᴄᴇꜱꜱɪɴɢ Tʀᴀɴꜱꜰᴇʀ...');
            
            sender.balance -= transferAmount;
            receiver.balance += transferAmount;
            
            await sender.save({ session });
            await receiver.save({ session });
            
            console.log('✅ Sᴇɴᴅᴇʀ Bᴀʟᴀɴᴄᴇ Uᴘᴅᴀᴛᴇᴅ:', sender.balance);
            console.log('✅ Rᴇᴄᴇɪᴠᴇʀ Bᴀʟᴀɴᴄᴇ Uᴘᴅᴀᴛᴇᴅ:', receiver.balance);
            
            const transactionId = await generateUniqueTransactionId();
            
            // Sender Transaction - transfer_send (debit)
            await Transaction.create([{
                tx_id: transactionId,
                user_id: sender._id,
                sender_id: sender._id,
                receiver_id: receiver._id,
                amount: transferAmount,
                type: 'transfer_send',
                status: 'success',
                remark: note || 'Mᴏɴᴇʏ Tʀᴀɴꜱꜰᴇʀ',
                description: note || 'Mᴏɴᴇʏ Tʀᴀɴꜱꜰᴇʀ',
                tx_time: new Date(),
                metadata: {
                    senderMobile: sender.mobile,
                    receiverMobile: receiver.mobile,
                    senderName: sender.fullName,
                    receiverName: receiver.fullName,
                    ipAddress: clientIp,
                    timestamp: new Date(),
                    transactionType: 'payment_sent'
                }
            }], { session });
            
            // Receiver Transaction - transfer_receive (credit)
            await Transaction.create([{
                tx_id: transactionId,
                user_id: receiver._id,
                sender_id: sender._id,
                receiver_id: receiver._id,
                amount: transferAmount,
                type: 'transfer_receive',
                status: 'success',
                remark: note || 'Mᴏɴᴇʏ Rᴇᴄᴇɪᴠᴇᴅ',
                description: note || 'Mᴏɴᴇʏ Rᴇᴄᴇɪᴠᴇᴅ',
                tx_time: new Date(),
                metadata: {
                    senderMobile: sender.mobile,
                    receiverMobile: receiver.mobile,
                    senderName: sender.fullName,
                    receiverName: receiver.fullName,
                    ipAddress: clientIp,
                    timestamp: new Date(),
                    transactionType: 'payment_received'
                }
            }], { session });
            
            await session.commitTransaction();
            session.endSession();
            
            console.log('✅ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Cʀᴇᴀᴛᴇᴅ:', transactionId);
            
            // ==================== SEND TELEGRAM NOTIFICATIONS ====================
            
            // Notify Receiver
            if (receiver.telegramId) {
                const receiverMessage = 
`<b>─────────────────</b>
<b>💰 Nᴇᴡ Pᴀʏᴍᴇɴᴛ Rᴇᴄᴇɪᴠᴇᴅ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${receiver.fullName || receiver.username},</b> Yᴏᴜ Hᴀᴠᴇ Jᴜꜱᴛ Rᴇᴄᴇɪᴠᴇᴅ A Pᴀʏᴍᴇɴᴛ Iɴ Yᴏᴜʀ Wᴀʟʟᴇᴛ.

💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${transferAmount.toFixed(2)}
👤 <b>Fʀᴏᴍ:</b> ${sender.fullName || sender.username}
🆔 <b>Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ:</b> ${transactionId}
📝 <b>Nᴏᴛᴇ:</b> ${note || 'N/A'}
📅 <code>${dateTime}</code>

───────────────────────
✅ Aᴍᴏᴜɴᴛ Cʀᴇᴅɪᴛᴇᴅ Tᴏ Yᴏᴜʀ Wᴀʟʟᴇᴛ
───────────────────────`;
                
                await notifyUser(receiver.telegramId, receiverMessage);
                console.log('✅ Rᴇᴄᴇɪᴠᴇʀ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Sᴇɴᴛ');
            }
            
            // Notify Sender
            if (sender.telegramId) {
                const senderMessage = 
`<b>─────────────────</b>
<b>💸 Pᴀʏᴍᴇɴᴛ Cᴏᴍᴘʟᴇᴛᴇᴅ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${sender.fullName || sender.username},</b> Yᴏᴜʀ Pᴀʏᴍᴇɴᴛ Hᴀꜱ Bᴇᴇɴ Pʀᴏᴄᴇꜱꜱᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ.

💰 <b>Aᴍᴏᴜɴᴛ:</b> ₹${transferAmount.toFixed(2)}
👤 <b>Tᴏ:</b> ${receiver.fullName || receiver.username} (${receiver.mobile})
🆔 <b>Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ:</b> ${transactionId}
💳 <b>Nᴇᴡ Bᴀʟᴀɴᴄᴇ:</b> ₹${sender.balance.toFixed(2)}
📝 <b>Nᴏᴛᴇ:</b> ${note || 'N/A'}

───────────────────────
✅ Tʀᴀɴꜱꜰᴇʀ Cᴏᴍᴘʟᴇᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ
───────────────────────`;
                
                await notifyUser(sender.telegramId, senderMessage);
                console.log('✅ Sᴇɴᴅᴇʀ Nᴏᴛɪꜰɪᴄᴀᴛɪᴏɴ Sᴇɴᴛ');
            }
            
            // Notify Admin
            const adminMessage = 
`<b>─────────────────</b>
<b>💸 Tʀᴀɴꜱꜰᴇʀ Cᴏᴍᴘʟᴇᴛᴇᴅ</b>
<b>─────────────────</b>

👤 Sᴇɴᴅᴇʀ Nᴀᴍᴇ: <code>${sender.fullName || sender.username}</code>
📱 Sᴇɴᴅᴇʀ Mᴏʙɪʟᴇ: <code>${sender.mobile}</code>
👤 Rᴇᴄᴇɪᴠᴇʀ Nᴀᴍᴇ: <code>${receiver.fullName || receiver.username}</code>
📱 Rᴇᴄᴇɪᴠᴇʀ Mᴏʙɪʟᴇ: <code>${receiver.mobile}</code>
💵 Aᴍᴏᴜɴᴛ: <b>₹${transferAmount.toFixed(2)}</b>
🆔 Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Iᴅ: <code>${transactionId}</code>
📝 Nᴏᴛᴇ: ${note || 'Nᴏ Cᴏᴍᴍᴇɴᴛ'}

───────────────────────
📅 <code>${dateTime}</code>
───────────────────────`;
            
            await notifyAdmin(adminMessage);
            
            res.json({
                success: true,
                message: `✅ Tʀᴀɴꜱꜰᴇʀ Sᴜᴄᴄᴇꜱꜱꜰᴜʟ! ₹${transferAmount.toFixed(2)} Sᴇɴᴛ Tᴏ ${receiver.fullName || receiver.username}`,
                txnId: transactionId,
                amount: transferAmount,
                newBalance: sender.balance
            });
            
        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            console.error('❌ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Fᴀɪʟᴇᴅ:', error.message);
            throw error;
        }
        
    } catch (error) {
        console.error('❌ Tʀᴀɴꜱꜰᴇʀ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ 
            success: false, 
            error: error.message || 'Tʀᴀɴꜱꜰᴇʀ Fᴀɪʟᴇᴅ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ' 
        });
    }
});

// ============================================
// GET TRANSACTION HISTORY - GET /api/transfer/history
// ============================================
router.get('/history', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        const { limit = 50, page = 1 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        console.log('📋 Fᴇᴛᴄʜɪɴɢ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Hɪꜱᴛᴏʀʏ Fᴏʀ:', user.mobile);
        
        const transactions = await Transaction.find({
            $or: [
                { sender_id: user._id },
                { receiver_id: user._id }
            ]
        })
        .populate('sender_id', 'fullName username mobile')
        .populate('receiver_id', 'fullName username mobile')
        .sort({ tx_time: -1 })
        .skip(skip)
        .limit(parseInt(limit));
        
        const total = await Transaction.countDocuments({
            $or: [
                { sender_id: user._id },
                { receiver_id: user._id }
            ]
        });
        
        console.log('✅ Fᴏᴜɴᴅ', transactions.length, 'Tʀᴀɴꜱᴀᴄᴛɪᴏɴꜱ');
        
        res.json({
            status: 'success',
            transactions,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('❌ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Hɪꜱᴛᴏʀʏ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ 
            status: 'error', 
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Hɪꜱᴛᴏʀʏ' 
        });
    }
});

// ============================================
// GET SINGLE TRANSACTION DETAILS - GET /api/transfer/transaction/:txnId
// ============================================
router.get('/transaction/:txnId', verifyToken, async (req, res) => {
    try {
        const { txnId } = req.params;
        const user = req.user;
        
        console.log('🔍 Fᴇᴛᴄʜɪɴɢ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Dᴇᴛᴀɪʟꜱ:', txnId);
        
        const transaction = await Transaction.findOne({ tx_id: txnId })
            .populate('sender_id', 'fullName username mobile walletId')
            .populate('receiver_id', 'fullName username mobile walletId')
            .populate('user_id', 'fullName username mobile walletId');
        
        if (!transaction) {
            console.log('❌ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Nᴏᴛ Fᴏᴜɴᴅ:', txnId);
            return res.status(404).json({ 
                status: 'error', 
                message: 'Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Nᴏᴛ Fᴏᴜɴᴅ' 
            });
        }
        
        // Check if user is authorized
        const isAuthorized = 
            transaction.sender_id?._id?.toString() === user._id.toString() || 
            transaction.receiver_id?._id?.toString() === user._id.toString() ||
            transaction.user_id?._id?.toString() === user._id.toString();
        
        if (!isAuthorized) {
            console.log('❌ Uɴᴀᴜᴛʜᴏʀɪᴢᴇᴅ Aᴄᴄᴇꜱꜱ Tᴏ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ');
            return res.status(403).json({ 
                status: 'error', 
                message: 'Uɴᴀᴜᴛʜᴏʀɪᴢᴇᴅ Tᴏ Vɪᴇᴡ Tʜɪꜱ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ' 
            });
        }
        
        console.log('✅ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Fᴏᴜɴᴅ');
        
        res.json({
            status: 'success',
            transaction
        });
        
    } catch (error) {
        console.error('❌ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Dᴇᴛᴀɪʟꜱ Eʀʀᴏʀ:', error.message);
        res.status(500).json({ 
            status: 'error', 
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Dᴇᴛᴀɪʟꜱ' 
        });
    }
});

// ============================================
// PUBLIC: GET SINGLE TRANSACTION (NO AUTH)
// ============================================
router.get('/public/transaction/:txnId', async (req, res) => {
    try {
        const { txnId } = req.params;
        
        console.log('🔍 Pᴜʙʟɪᴄ Fᴇᴛᴄʜɪɴɢ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ:', txnId);
        
        const transaction = await Transaction.findOne({ tx_id: txnId })
            .populate('sender_id', 'fullName username walletId')
            .populate('receiver_id', 'fullName username walletId')
            .populate('user_id', 'fullName username walletId');
        
        if (!transaction) {
            return res.status(200).json({
                success: false,
                message: 'Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Nᴏᴛ Fᴏᴜɴᴅ'
            });
        }
        
        const txnObj = transaction.toObject();
        delete txnObj.metadata?.senderApiKey;
        delete txnObj.metadata?.receiverApiKey;
        
        console.log('✅ Pᴜʙʟɪᴄ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Fᴏᴜɴᴅ');
        
        res.status(200).json({
            success: true,
            transaction: txnObj
        });
        
    } catch (error) {
        console.error('❌ Pᴜʙʟɪᴄ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Dᴇᴛᴀɪʟꜱ'
        });
    }
});

// ============================================
// GET MY API KEY - GET /api/transfer/my-apikey
// ============================================
router.get('/my-apikey', verifyToken, async (req, res) => {
    try {
        const user = req.user;
        
        if (!user.apiKey) {
            return res.status(404).json({
                success: false,
                message: 'API Kᴇʏ Nᴏᴛ Fᴏᴜɴᴅ'
            });
        }
        
        res.json({
            success: true,
            apiKey: user.apiKey,
            walletId: user.walletId,
            fullName: user.fullName,
            mobile: user.mobile
        });
        
    } catch (error) {
        console.error('❌ Gᴇᴛ API Kᴇʏ Eʀʀᴏʀ:', error.message);
        res.status(500).json({
            success: false,
            message: 'Fᴀɪʟᴇᴅ Tᴏ Fᴇᴛᴄʜ API Kᴇʏ'
        });
    }
});

module.exports = router;
