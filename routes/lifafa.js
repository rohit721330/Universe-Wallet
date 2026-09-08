//FILE routes/lifafa.js
const Router = require('express').Router();
const Jwt = require('jsonwebtoken');
const Crypto = require('crypto');
const Axios = require('axios');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Lifafa = require('../models/Lifafa');

const JwtSecret = process.env.JWT_SECRET;
const BotToken = process.env.BOT_TOKEN;
const AdminTgId = process.env.ADMIN_TG_ID;
const AppUrl = process.env.APP_URL;

const VerifyToken = async (Req, Res, Next) => {
    try {
        const Token = Req.headers.authorization?.split(' ')[1];
        if (!Token) return Res.status(200).json({ success: false, message: 'Nᴏ Tᴏᴋᴇɴ Pʀᴏᴠɪᴅᴇᴅ' });
        const Decoded = Jwt.verify(Token, JwtSecret);
        const UserData = await User.findById(Decoded.userId);
        if (!UserData) return Res.status(200).json({ success: false, message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ' });
        Req.user = UserData;
        Req.userId = UserData._id;
        Next();
    } catch (Error) {
        if (Error.name === 'JsonWebTokenError') return Res.status(200).json({ success: false, message: '𝙸ɴᴠᴀʟ𝙸ᴅ Tᴏᴋᴇɴ' });
        if (Error.name === 'TokenExpiredError') return Res.status(200).json({ success: false, message: 'Tᴏᴋᴇɴ Exᴘ𝙸ʀᴇᴅ' });
        return Res.status(200).json({ success: false, message: 'Aᴜᴛʜ Eʀʀᴏʀ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀ𝙸ɴ.' });
    }
};

function GenerateLifafaTxnId() {
    return 'TXN_LIFAFA_' + Date.now() + Math.floor(Math.random() * 99999);
}

async function SendTelegramMessage(ChatId, Message) {
    if (!BotToken) { console.error('❌ Bᴏᴛ Tᴏᴋᴇɴ Nᴏᴛ Cᴏɴꜰ𝙸ɢᴜʀᴇᴅ'); return { success: false, error: 'BOT_TOKEN not configured' }; }
    try {
        const Url = `https://api.telegram.org/bot${BotToken}/sendMessage`;
        const Response = await Axios.post(Url, { chat_id: ChatId, text: Message, parse_mode: 'HTML' }, { timeout: 15000, headers: { 'Content-Type': 'application/json' } });
        if (Response.data && Response.data.ok) { return { success: true }; }
        else { return { success: false, error: Response.data?.description || 'Uɴᴋɴᴏᴡɴ Eʀʀᴏʀ' }; }
    } catch (Error) { console.error('❌ Tᴇʟᴇɢʀᴀᴍ Mᴇꜱꜱᴀɢᴇ Eʀʀᴏʀ:', Error.message); return { success: false, error: Error.message }; }
}

async function SendNotificationToUser(UserData, Message) {
    if (!UserData || !UserData.telegramId) return null;
    return SendTelegramMessage(UserData.telegramId, Message);
}

async function NotifyAdmin(Message) {
    if (!AdminTgId) return;
    return SendTelegramMessage(AdminTgId, Message);
}

function GenerateLifafaId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function validateChannel(channel) {
    const channelRegex = /^@[a-zA-Z0-9_]{5,}$/;
    return channelRegex.test(channel);
}

function extractChannelUsername(input) {
    if (!input) return null;
    
    let username = input.trim();
    
    if (username.includes('t.me/')) {
        const match = username.match(/t\.me\/([a-zA-Z0-9_]+)/);
        if (match) {
            username = '@' + match[1];
        }
    } else if (!username.startsWith('@')) {
        username = '@' + username;
    }
    
    const channelRegex = /^@[a-zA-Z0-9_]{5,}$/;
    if (!channelRegex.test(username)) {
        return null;
    }
    
    return username;
}

// Helper: Get current time in IST
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

// ==================== চ্যানেল ভ্যালিডেশন ====================
Router.post('/validate-channel', async (Req, Res) => {
    try {
        const { channel } = Req.body;
        
        if (!channel) {
            return Res.status(200).json({ 
                success: false, 
                message: 'Channel username is required' 
            });
        }
        
        const channelUsername = extractChannelUsername(channel);
        if (!channelUsername) {
            return Res.status(200).json({
                success: false,
                message: 'Invalid channel format. Please provide a valid channel link (https://t.me/username) or username (@username)'
            });
        }
        
        const botToken = process.env.BOT_TOKEN;
        if (!botToken) {
            return Res.status(200).json({ 
                success: false, 
                message: 'BOT_TOKEN not configured' 
            });
        }
        
        try {
            const getChatUrl = `https://api.telegram.org/bot${botToken}/getChat`;
            const chatResponse = await Axios.post(getChatUrl, {
                chat_id: channelUsername
            }, {
                timeout: 10000,
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (!chatResponse.data || !chatResponse.data.ok) {
                return Res.status(200).json({
                    success: false,
                    message: 'Channel not found. Please check the channel username.'
                });
            }
            
            const chat = chatResponse.data.result;
            if (chat.type !== 'channel') {
                return Res.status(200).json({
                    success: false,
                    message: 'This is not a channel. Please provide a valid channel.'
                });
            }
            
            if (!chat.username) {
                return Res.status(200).json({
                    success: false,
                    message: 'This channel does not have a username. Only public channels with @username are allowed.'
                });
            }
            
        } catch (error) {
            return Res.status(200).json({
                success: false,
                message: 'Channel not found or bot cannot access it. Make sure the channel exists and is public.'
            });
        }
        
        const botInfo = await Axios.get(`https://api.telegram.org/bot${botToken}/getMe`);
        const botId = botInfo.data.result.id;
        
        try {
            const getMemberUrl = `https://api.telegram.org/bot${botToken}/getChatMember`;
            const memberResponse = await Axios.post(getMemberUrl, {
                chat_id: channelUsername,
                user_id: botId
            }, {
                timeout: 10000,
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (memberResponse.data && memberResponse.data.ok) {
                const status = memberResponse.data.result.status;
                const isAdmin = ['creator', 'administrator'].includes(status);
                
                if (!isAdmin) {
                    return Res.status(200).json({
                        success: false,
                        message: 'Bot is not an admin of this channel. Please make the bot admin first.',
                        details: {
                            status: status,
                            required: 'creator or administrator',
                            channel: channelUsername
                        }
                    });
                }
                
                return Res.status(200).json({
                    success: true,
                    message: 'Channel is valid and bot is admin.',
                    data: {
                        channel: channelUsername,
                        isAdmin: true,
                        status: status
                    }
                });
            } else {
                return Res.status(200).json({
                    success: false,
                    message: memberResponse.data?.description || 'Failed to check bot admin status'
                });
            }
        } catch (error) {
            return Res.status(200).json({
                success: false,
                message: 'Bot is not an admin of this channel. Please make the bot admin first.',
                details: error.response?.data?.description || error.message
            });
        }
    } catch (Error) {
        console.error('❌ Cʜᴀɴɴᴇʟ Vᴀʟɪᴅᴀᴛɪᴏɴ Eʀʀᴏʀ:', Error.message);
        return Res.status(200).json({
            success: false,
            message: 'Failed to validate channel'
        });
    }
});

// ==================== চ্যানেল চেক ====================
Router.post('/check-channels', async (Req, Res) => {
    try {
        const { userId, channels } = Req.body;
        
        if (!userId || !channels || !Array.isArray(channels) || channels.length === 0) {
            return Res.status(200).json({ 
                success: false, 
                message: 'User ID and channels array are required' 
            });
        }

        const invalidChannels = channels.filter(ch => !validateChannel(ch));
        if (invalidChannels.length > 0) {
            return Res.status(200).json({
                success: false,
                message: 'All channels must be public. Channel must start with @',
                invalidChannels: invalidChannels
            });
        }

        const botToken = process.env.BOT_TOKEN;
        if (!botToken) {
            return Res.status(200).json({ 
                success: false, 
                message: 'BOT_TOKEN not configured' 
            });
        }

        const UserData = await User.findById(userId);
        if (!UserData || !UserData.telegramId) {
            return Res.status(200).json({ 
                success: false, 
                message: 'User not found or not verified' 
            });
        }

        const telegramId = UserData.telegramId;
        const results = [];

        for (const channel of channels) {
            try {
                const url = `https://api.telegram.org/bot${botToken}/getChatMember`;
                const response = await Axios.post(url, {
                    chat_id: channel,
                    user_id: telegramId
                }, {
                    timeout: 10000,
                    headers: { 'Content-Type': 'application/json' }
                });

                if (response.data && response.data.ok) {
                    const status = response.data.result.status;
                    const isJoined = ['creator', 'administrator', 'member'].includes(status);
                    results.push({
                        channel: channel,
                        isJoined: isJoined,
                        status: status
                    });
                } else {
                    results.push({
                        channel: channel,
                        isJoined: false,
                        status: 'unknown',
                        error: response.data?.description || 'Unknown error'
                    });
                }
            } catch (error) {
                results.push({
                    channel: channel,
                    isJoined: false,
                    status: 'error',
                    error: error.message
                });
            }
        }

        const allJoined = results.every(r => r.isJoined === true);

        return Res.status(200).json({
            success: true,
            data: {
                results: results,
                allJoined: allJoined
            }
        });
    } catch (Error) {
        console.error('❌ Cʜᴀɴɴᴇʟ Cʜᴇᴄᴋ Eʀʀᴏʀ:', Error.message);
        return Res.status(200).json({
            success: false,
            message: 'Failed to check channels'
        });
    }
});

// ==================== লিফাফা তৈরি ====================
Router.post('/create', VerifyToken, async (Req, Res) => {
    try {
        let { 
            title, 
            totalUsers, 
            perUser, 
            comment, 
            redirectLink, 
            accessCode, 
            specialUsers, 
            channels = [], 
            referAmount = 0, 
            referComment = '', 
            youtubeVideo = '', 
            winChance = null,
            type = 'normal',
            accessEnabled = false,
            channelsEnabled = false,
            referEnabled = false,
            youtubeEnabled = false
        } = Req.body;
        
        const UserData = Req.user;
        
        if (!title || !title.trim()) return Res.status(200).json({ success: false, message: 'Gɪᴠᴇᴀᴡᴀʏ Tɪᴛʟᴇ Iꜱ Rᴇǫᴜɪʀᴇᴅ' });
        if (!totalUsers || totalUsers < 1) return Res.status(200).json({ success: false, message: 'Tᴏᴛᴀʟ Uꜱᴇʀꜱ Mᴜꜱᴛ Bᴇ Aᴛ Lᴇᴀꜱᴛ 1' });
        if (!perUser || perUser < 0.01) return Res.status(200).json({ success: false, message: 'Pᴇʀ Uꜱᴇʀ Aᴍᴏᴜɴᴛ Mᴜꜱᴛ Bᴇ Gʀᴇᴀᴛᴇʀ Tʜᴀɴ 0' });
        
        const allowedTypes = ['normal', 'toss', 'dice', 'scratch'];
        if (!allowedTypes.includes(type)) {
            return Res.status(200).json({ success: false, message: '𝙸ɴᴠᴀʟ𝙸ᴅ Lɪꜰᴀꜰᴀ Tʏᴘᴇ. Aʟʟᴏᴡᴇᴅ: normal, toss, dice, scratch' });
        }
        
        let finalWinChance = winChance;
        if (type !== 'normal') {
            if (winChance === null || winChance === undefined) {
                finalWinChance = 50;
            } else if (winChance < 0 || winChance > 100) {
                return Res.status(200).json({ success: false, message: 'Wɪɴ Cʜᴀɴᴄᴇ Mᴜꜱᴛ Bᴇ Bᴇᴛᴡᴇᴇɴ 0 ᴀɴᴅ 100 Fᴏʀ ' + type.toUpperCase() });
            }
        }
        
        // চ্যানেল ভ্যালিডেশন
        if (channelsEnabled && channels && channels.length > 0) {
            const botToken = process.env.BOT_TOKEN;
            if (!botToken) {
                return Res.status(200).json({ 
                    success: false, 
                    message: 'BOT_TOKEN not configured. Please add bot token to .env file.' 
                });
            }
            
            const processedChannels = [];
            const invalidChannels = [];
            
            for (const channel of channels) {
                const processed = extractChannelUsername(channel);
                if (processed) {
                    processedChannels.push(processed);
                } else {
                    invalidChannels.push(channel);
                }
            }
            
            if (invalidChannels.length > 0) {
                return Res.status(200).json({ 
                    success: false, 
                    message: 'Invalid channel format. Please use @username or https://t.me/username format.',
                    invalidChannels: invalidChannels
                });
            }
            
            let allChannelsValid = true;
            const adminCheckResults = [];
            
            for (const channel of processedChannels) {
                try {
                    const getChatUrl = `https://api.telegram.org/bot${botToken}/getChat`;
                    const chatResponse = await Axios.post(getChatUrl, {
                        chat_id: channel
                    }, {
                        timeout: 10000,
                        headers: { 'Content-Type': 'application/json' }
                    });
                    
                    if (!chatResponse.data || !chatResponse.data.ok) {
                        allChannelsValid = false;
                        adminCheckResults.push({
                            channel: channel,
                            valid: false,
                            error: 'Channel not found or bot cannot access it'
                        });
                        continue;
                    }
                    
                    const botInfo = await Axios.get(`https://api.telegram.org/bot${botToken}/getMe`);
                    const botId = botInfo.data.result.id;
                    
                    const getMemberUrl = `https://api.telegram.org/bot${botToken}/getChatMember`;
                    const memberResponse = await Axios.post(getMemberUrl, {
                        chat_id: channel,
                        user_id: botId
                    }, {
                        timeout: 10000,
                        headers: { 'Content-Type': 'application/json' }
                    });
                    
                    if (memberResponse.data && memberResponse.data.ok) {
                        const status = memberResponse.data.result.status;
                        const isAdmin = ['creator', 'administrator'].includes(status);
                        
                        if (!isAdmin) {
                            allChannelsValid = false;
                            adminCheckResults.push({
                                channel: channel,
                                valid: false,
                                error: 'Bot is not an admin of this channel. Please make the bot admin first.',
                                status: status
                            });
                        } else {
                            adminCheckResults.push({
                                channel: channel,
                                valid: true,
                                status: status
                            });
                        }
                    } else {
                        allChannelsValid = false;
                        adminCheckResults.push({
                            channel: channel,
                            valid: false,
                            error: memberResponse.data?.description || 'Failed to check bot admin status'
                        });
                    }
                } catch (error) {
                    allChannelsValid = false;
                    adminCheckResults.push({
                        channel: channel,
                        valid: false,
                        error: error.response?.data?.description || error.message || 'Unknown error'
                    });
                }
            }
            
            if (!allChannelsValid) {
                return Res.status(200).json({
                    success: false,
                    message: 'Bᴏᴛ ᴍᴜꜱᴛ ʙᴇ ᴀᴅᴍɪɴ ᴏꜰ ᴀʟʟ ᴄʜᴀɴɴᴇʟꜱ ᴛᴏ ᴠᴇʀɪꜰʏ ᴜꜱᴇʀꜱ',
                    details: adminCheckResults
                });
            }
            
            channels = processedChannels;
        }
        
        const TotalAmount = totalUsers * perUser;
        if (UserData.balance < TotalAmount) return Res.status(200).json({ success: false, message: '𝙸ɴꜱᴜꜰꜰɪᴄɪᴇɴᴛ Bᴀʟᴀɴᴄᴇ. Pʟᴇᴀꜱᴇ Aᴅᴅ Fᴜɴᴅꜱ.' });
        
        let LifafaId; let IsUnique = false; let Attempts = 0;
        while (!IsUnique && Attempts < 10) { 
            LifafaId = GenerateLifafaId(); 
            const Existing = await Lifafa.findOne({ lifafaId: LifafaId }); 
            if (!Existing) IsUnique = true; 
            Attempts++; 
        }
        if (!IsUnique) return Res.status(200).json({ success: false, message: 'Fᴀɪʟᴇᴅ Tᴏ Gᴇɴᴇʀᴀᴛᴇ Uɴɪǫᴜᴇ Lɪꜰᴀꜰᴀ Iᴅ' });
        
        const NewLifafa = new Lifafa({ 
            lifafaId: LifafaId, 
            userId: UserData._id, 
            title: title.trim(), 
            type: type, 
            winChance: type !== 'normal' ? finalWinChance : null,
            totalUsers, 
            perUser, 
            totalAmount: TotalAmount, 
            comment: comment || '', 
            redirectLink: redirectLink || '', 
            accessCode: accessEnabled && accessCode ? accessCode : null, 
            specialUsers: specialUsers || null, 
            channels: channelsEnabled ? channels : [], 
            referAmount: referEnabled ? referAmount : 0, 
            referComment: referComment || '', 
            youtubeVideo: youtubeEnabled ? youtubeVideo : '',
            requireRefer: referEnabled,
            requireVerify: true,
            requireYoutube: youtubeEnabled,
            requireChannel: channelsEnabled,
            requireType: true, 
            remainingUsers: totalUsers, 
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            isExpired: false,
            allChannelsHavePermission: channelsEnabled ? true : false
        });
        await NewLifafa.save();
        
        UserData.balance -= TotalAmount; 
        await UserData.save();
        
        const TransactionId = GenerateLifafaTxnId();
        const NewTransaction = new Transaction({ 
            tx_id: TransactionId,
            user_id: UserData._id,
            sender_id: UserData._id,
            receiver_id: null,
            amount: TotalAmount, 
            type: 'lifafa_creation', 
            status: 'success', 
            remark: `Lɪꜰᴀꜰᴀ Cʀᴇᴀᴛᴇᴅ: ${title}`,
            description: `Lɪꜰᴀꜰᴀ Cʀᴇᴀᴛᴇᴅ: ${title}`,
            tx_time: new Date(),
            metadata: { 
                lifafaId: LifafaId, 
                totalUsers, 
                perUser, 
                type, 
                winChance: finalWinChance,
                transactionType: 'debit' 
            } 
        });
        await NewTransaction.save();
        
        const ClaimLink = `${AppUrl}/${type}?id=${LifafaId}`;
        
        let winChanceText = '';
        if (type !== 'normal') {
            winChanceText = `<b>Wɪɴ Cʜᴀɴᴄᴇ:</b> ${finalWinChance}%\n`;
        }
        
        const CreatorMessage = 
`<b>─────────────────</b>
<b>📨 Lɪꜰᴀꜰᴀ Cʀᴇᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${UserData.fullName},</b> Yᴏᴜʀ Lɪꜰᴀꜰᴀ Hᴀꜱ Bᴇᴇɴ Cʀᴇᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ.

📌 <b>Tɪᴛʟᴇ:</b> ${title}
📂 <b>Tʏᴘᴇ:</b> ${type.toUpperCase()}
${winChanceText}👥 <b>Tᴏᴛᴀʟ Uꜱᴇʀꜱ:</b> ${totalUsers}
💰 <b>Pᴇʀ Uꜱᴇʀ:</b> ₹${perUser}
💵 <b>Tᴏᴛᴀʟ Aᴍᴏᴜɴᴛ:</b> ₹${TotalAmount}
🔗 <b>Cʟᴀɪᴍ Lɪɴᴋ:</b> ${ClaimLink}
${accessEnabled ? '🔑 <b>Aᴄᴄᴇꜱꜱ Cᴏᴅᴇ:</b> ' + accessCode + '\n' : ''}
${channelsEnabled ? '📢 <b>Cʜᴀɴɴᴇʟꜱ Rᴇǫᴜɪʀᴇᴅ:</b> ' + channels.length + '\n' : ''}
${referEnabled ? '🎁 <b>Rᴇꜰᴇʀ Bᴏɴᴜꜱ:</b> ₹' + referAmount + '\n' : ''}
${youtubeEnabled ? '📺 <b>YᴏᴜTᴜʙᴇ Vɪᴅᴇᴏ Rᴇǫᴜɪʀᴇᴅ</b>\n' : ''}
───────────────────────
📊 <b>Sᴛᴀᴛᴜꜱ:</b> ${NewLifafa.status.toUpperCase()}
───────────────────────`;
        await SendNotificationToUser(UserData, CreatorMessage);
        
        const AdminMessage = 
`<b>───────────────</b>
<b>📨 Nᴇᴡ Lɪꜰᴀꜰᴀ Cʀᴇᴀᴛᴇᴅ</b>
<b>───────────────</b>

👤 <b>Cʀᴇᴀᴛᴏʀ:</b> ${UserData.fullName}
📱 <b>Mᴏʙɪʟᴇ:</b> ${UserData.mobile}
🆔 <b>Wᴀʟʟᴇᴛ:</b> ${UserData.walletId}
📌 <b>Tɪᴛʟᴇ:</b> ${title}
📂 <b>Tʏᴘᴇ:</b> ${type.toUpperCase()}
${type !== 'normal' ? '🎲 <b>Wɪɴ Cʜᴀɴᴄᴇ:</b> ' + finalWinChance + '%\n' : ''}
👥 <b>Tᴏᴛᴀʟ Uꜱᴇʀꜱ:</b> ${totalUsers}
💰 <b>Pᴇʀ Uꜱᴇʀ:</b> ₹${perUser}
💵 <b>Tᴏᴛᴀʟ Aᴍᴏᴜɴᴛ:</b> ₹${TotalAmount}
🔗 <b>Cʟᴀɪᴍ Lɪɴᴋ:</b> ${ClaimLink}
${accessEnabled ? '🔑 <b>Aᴄᴄᴇꜱꜱ Cᴏᴅᴇ:</b> ' + accessCode + '\n' : ''}
${channelsEnabled ? '📢 <b>Cʜᴀɴɴᴇʟꜱ Rᴇǫᴜɪʀᴇᴅ:</b> ' + channels.length + '\n' : ''}
${referEnabled ? '🎁 <b>Rᴇꜰᴇʀ Bᴏɴᴜꜱ:</b> ₹' + referAmount + '\n' : ''}
${youtubeEnabled ? '📺 <b>YᴏᴜTᴜʙᴇ Vɪᴅᴇᴏ Rᴇǫᴜɪʀᴇᴅ</b>\n' : ''}
───────────────────────
📊 <b>Sᴛᴀᴛᴜꜱ:</b> ${NewLifafa.status.toUpperCase()}
───────────────────────`;
        await NotifyAdmin(AdminMessage);
        
        return Res.status(200).json({ 
            success: true, 
            message: 'Lɪꜰᴀꜰᴀ Cʀᴇᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ!', 
            data: { 
                id: LifafaId, 
                title: NewLifafa.title, 
                type: NewLifafa.type, 
                winChance: NewLifafa.winChance,
                totalUsers: NewLifafa.totalUsers, 
                perUser: NewLifafa.perUser, 
                totalAmount: NewLifafa.totalAmount, 
                remainingUsers: NewLifafa.remainingUsers, 
                accessCode: NewLifafa.accessCode, 
                status: NewLifafa.status, 
                claimLink: ClaimLink, 
                createdAt: NewLifafa.createdAt, 
                expiresAt: NewLifafa.expiresAt 
            } 
        });
    } catch (Error) { 
        console.error('❌ Cʀᴇᴀᴛᴇ Lɪꜰᴀꜰᴀ Eʀʀᴏʀ:', Error); 
        return Res.status(200).json({ success: false, message: 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ Lᴀᴛᴇʀ.' }); 
    }
});

// ==================== লিফাফা এডিট ====================
Router.put('/:id', VerifyToken, async (Req, Res) => {
    try {
        const { id } = Req.params;
        const { 
            totalUsers, 
            perUser, 
            comment, 
            redirectLink, 
            accessCode, 
            specialUsers, 
            channels = [], 
            referAmount = 0, 
            referComment = '', 
            youtubeVideo = '', 
            winChance = null,
            type = 'normal',
            accessEnabled = false,
            channelsEnabled = false,
            referEnabled = false,
            youtubeEnabled = false,
            title
        } = Req.body;
        
        const UserData = Req.user;
        const LifafaData = await Lifafa.findOne({ lifafaId: id });
        
        if (!LifafaData) {
            return Res.status(200).json({ 
                success: false, 
                message: 'Lɪꜰᴀꜰᴀ Nᴏᴛ Fᴏᴜɴᴅ' 
            });
        }
        
        // ✅ শুধুমাত্র ক্রিয়েটর বা এডমিন এডিট করতে পারবে
        const IsCreator = LifafaData.userId.toString() === UserData._id.toString();
        const IsAdmin = UserData.isAdmin === true;
        
        if (!IsCreator && !IsAdmin) {
            return Res.status(200).json({ 
                success: false, 
                message: 'Yᴏᴜ Aʀᴇ Nᴏᴛ Aᴜᴛʜᴏʀɪᴢᴇᴅ Tᴏ Eᴅɪᴛ Tʜɪꜱ Lɪꜰᴀꜰᴀ' 
            });
        }
        
        // ✅ শুধুমাত্র active status এর লিফাফা এডিট করা যাবে
        if (LifafaData.status !== 'active') {
            return Res.status(200).json({ 
                success: false, 
                message: 'Oɴʟʏ Aᴄᴛɪᴠᴇ Lɪꜰᴀꜰᴀ Cᴀɴ Bᴇ Eᴅɪᴛᴇᴅ' 
            });
        }
        
        // ✅ চেক করুন যে ইতিমধ্যে ক্লেইম হয়েছে কিনা
        const claimedCount = LifafaData.claimedUsers.length;
        if (claimedCount > 0) {
            return Res.status(200).json({ 
                success: false, 
                message: 'Cᴀɴɴᴏᴛ Eᴅɪᴛ Lɪꜰᴀꜰᴀ Tʜᴀᴛ Hᴀꜱ Bᴇᴇɴ Cʟᴀɪᴍᴇᴅ' 
            });
        }
        
        // ✅ নতুন টোটাল এমাউন্ট ক্যালকুলেশন
        let newTotalUsers = totalUsers || LifafaData.totalUsers;
        let newPerUser = perUser || LifafaData.perUser;
        let newTotalAmount = newTotalUsers * newPerUser;
        
        // ✅ যদি এমাউন্ট বাড়ে, তাহলে ব্যালেন্স চেক করুন
        if (newTotalAmount > LifafaData.totalAmount) {
            const extraAmount = newTotalAmount - LifafaData.totalAmount;
            if (UserData.balance < extraAmount) {
                return Res.status(200).json({ 
                    success: false, 
                    message: '𝙸ɴꜱᴜꜰꜰɪᴄɪᴇɴᴛ Bᴀʟᴀɴᴄᴇ. Nᴇᴇᴅ ₹' + extraAmount + ' Mᴏʀᴇ' 
                });
            }
            UserData.balance -= extraAmount;
            await UserData.save();
        } 
        // ✅ যদি এমাউন্ট কমে, তাহলে রিফান্ড করুন
        else if (newTotalAmount < LifafaData.totalAmount) {
            const refundAmount = LifafaData.totalAmount - newTotalAmount;
            UserData.balance += refundAmount;
            await UserData.save();
        }
        
        // ✅ চ্যানেল ভ্যালিডেশন (যদি চ্যানেল ইন্যবল করা হয়)
        if (channelsEnabled && channels && channels.length > 0) {
            const botToken = process.env.BOT_TOKEN;
            if (!botToken) {
                return Res.status(200).json({ 
                    success: false, 
                    message: 'BOT_TOKEN not configured' 
                });
            }
            
            const processedChannels = [];
            const invalidChannels = [];
            
            for (const channel of channels) {
                const processed = extractChannelUsername(channel);
                if (processed) {
                    processedChannels.push(processed);
                } else {
                    invalidChannels.push(channel);
                }
            }
            
            if (invalidChannels.length > 0) {
                return Res.status(200).json({ 
                    success: false, 
                    message: 'Invalid channel format. Please use @username or https://t.me/username format.',
                    invalidChannels: invalidChannels
                });
            }
            
            let allChannelsValid = true;
            for (const channel of processedChannels) {
                try {
                    const botInfo = await Axios.get(`https://api.telegram.org/bot${botToken}/getMe`);
                    const botId = botInfo.data.result.id;
                    
                    const getMemberUrl = `https://api.telegram.org/bot${botToken}/getChatMember`;
                    const memberResponse = await Axios.post(getMemberUrl, {
                        chat_id: channel,
                        user_id: botId
                    }, {
                        timeout: 10000,
                        headers: { 'Content-Type': 'application/json' }
                    });
                    
                    if (memberResponse.data && memberResponse.data.ok) {
                        const status = memberResponse.data.result.status;
                        const isAdmin = ['creator', 'administrator'].includes(status);
                        if (!isAdmin) {
                            allChannelsValid = false;
                        }
                    } else {
                        allChannelsValid = false;
                    }
                } catch (error) {
                    allChannelsValid = false;
                }
            }
            
            if (!allChannelsValid) {
                return Res.status(200).json({
                    success: false,
                    message: 'Bᴏᴛ ᴍᴜꜱᴛ ʙᴇ ᴀᴅᴍɪɴ ᴏꜰ ᴀʟʟ ᴄʜᴀɴɴᴇʟꜱ ᴛᴏ ᴠᴇʀɪꜰʏ ᴜꜱᴇʀꜱ'
                });
            }
            
            channels = processedChannels;
        }
        
        // ✅ লিফাফা আপডেট করুন
        const Updates = {
            title: title || LifafaData.title,
            totalUsers: newTotalUsers,
            perUser: newPerUser,
            totalAmount: newTotalAmount,
            remainingUsers: newTotalUsers - LifafaData.claimedUsers.length,
            comment: comment !== undefined ? comment : LifafaData.comment,
            redirectLink: redirectLink !== undefined ? redirectLink : LifafaData.redirectLink,
            accessCode: accessEnabled && accessCode ? accessCode : null,
            specialUsers: specialUsers || null,
            channels: channelsEnabled ? channels : [],
            referAmount: referEnabled ? referAmount : 0,
            referComment: referComment || '',
            youtubeVideo: youtubeEnabled ? youtubeVideo : '',
            requireRefer: referEnabled,
            requireYoutube: youtubeEnabled,
            requireChannel: channelsEnabled,
            allChannelsHavePermission: channelsEnabled ? true : false
        };
        
        // ✅ winChance আপডেট (শুধুমাত্র non-normal টাইপের জন্য)
        if (type !== 'normal') {
            let finalWinChance = winChance;
            if (winChance === null || winChance === undefined) {
                finalWinChance = 50;
            } else if (winChance < 0 || winChance > 100) {
                return Res.status(200).json({ 
                    success: false, 
                    message: 'Wɪɴ Cʜᴀɴᴄᴇ Mᴜꜱᴛ Bᴇ Bᴇᴛᴡᴇᴇɴ 0 ᴀɴᴅ 100' 
                });
            }
            Updates.winChance = finalWinChance;
        }
        
        await LifafaData.updateOne(Updates);
        const UpdatedLifafa = await Lifafa.findOne({ lifafaId: id });
        
        // ✅ টেলিগ্রাম নোটিফিকেশন
        const dateTime = getCurrentDateTime();
        if (UserData.telegramId) {
            const diffAmount = newTotalAmount - LifafaData.totalAmount;
            const diffText = diffAmount > 0 ? `+₹${diffAmount}` : `₹${diffAmount}`;
            
            const EditMessage = 
`<b>─────────────────</b>
<b>✏️ Lɪꜰᴀꜰᴀ Uᴘᴅᴀᴛᴇᴅ</b>
<b>─────────────────</b>

<b>👤 Dᴇᴀʀ ${UserData.fullName},</b> Yᴏᴜʀ Lɪꜰᴀꜰᴀ Hᴀꜱ Bᴇᴇɴ Uᴘᴅᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ.

📌 <b>Tɪᴛʟᴇ:</b> ${UpdatedLifafa.title}
📂 <b>Tʏᴘᴇ:</b> ${UpdatedLifafa.type.toUpperCase()}
${UpdatedLifafa.type !== 'normal' ? '🎲 <b>Wɪɴ Cʜᴀɴᴄᴇ:</b> ' + UpdatedLifafa.winChance + '%\n' : ''}
👥 <b>Uꜱᴇʀꜱ:</b> ${UpdatedLifafa.totalUsers}
💰 <b>Pᴇʀ Uꜱᴇʀ:</b> ₹${UpdatedLifafa.perUser}
💵 <b>Tᴏᴛᴀʟ Aᴍᴏᴜɴᴛ:</b> ₹${UpdatedLifafa.totalAmount}
${diffAmount !== 0 ? '📊 <b>Aᴍᴏᴜɴᴛ Cʜᴀɴɢᴇ:</b> ' + diffText + '\n' : ''}
${UpdatedLifafa.accessCode ? '🔑 <b>Aᴄᴄᴇꜱꜱ Cᴏᴅᴇ:</b> ' + UpdatedLifafa.accessCode + '\n' : ''}
${UpdatedLifafa.channels.length > 0 ? '📢 <b>Cʜᴀɴɴᴇʟꜱ:</b> ' + UpdatedLifafa.channels.length + '\n' : ''}
${UpdatedLifafa.referAmount > 0 ? '🎁 <b>Rᴇꜰᴇʀ Bᴏɴᴜꜱ:</b> ₹' + UpdatedLifafa.referAmount + '\n' : ''}
${UpdatedLifafa.requireYoutube ? '📺 <b>YᴏᴜTᴜʙᴇ Vɪᴅᴇᴏ Rᴇǫᴜɪʀᴇᴅ</b>\n' : ''}
───────────────────────
📊 <b>Sᴛᴀᴛᴜꜱ:</b> ${UpdatedLifafa.status.toUpperCase()}
───────────────────────`;
            await SendNotificationToUser(UserData, EditMessage);
        }
        
        // ✅ এডমিন নোটিফিকেশন
        if (AdminTgId) {
            const diffAmount = newTotalAmount - LifafaData.totalAmount;
            const diffText = diffAmount > 0 ? `+₹${diffAmount}` : `₹${diffAmount}`;
            const AdminEditMessage = 
`<b>─────────────────</b>
<b>✏️ Lɪꜰᴀꜰᴀ Eᴅɪᴛᴇᴅ Bʏ Uꜱᴇʀ</b>
<b>─────────────────</b>

👤 <b>Uꜱᴇʀ:</b> ${UserData.fullName}
📱 <b>Mᴏʙɪʟᴇ:</b> ${UserData.mobile}
🆔 <b>Wᴀʟʟᴇᴛ:</b> ${UserData.walletId}
📌 <b>Tɪᴛʟᴇ:</b> ${UpdatedLifafa.title}
📂 <b>Tʏᴘᴇ:</b> ${UpdatedLifafa.type.toUpperCase()}
${UpdatedLifafa.type !== 'normal' ? '🎲 <b>Wɪɴ Cʜᴀɴᴄᴇ:</b> ' + UpdatedLifafa.winChance + '%\n' : ''}
👥 <b>Uꜱᴇʀꜱ:</b> ${UpdatedLifafa.totalUsers}
💰 <b>Pᴇʀ Uꜱᴇʀ:</b> ₹${UpdatedLifafa.perUser}
💵 <b>Tᴏᴛᴀʟ Aᴍᴏᴜɴᴛ:</b> ₹${UpdatedLifafa.totalAmount}
${diffAmount !== 0 ? '📊 <b>Aᴍᴏᴜɴᴛ Cʜᴀɴɢᴇ:</b> ' + diffText + '\n' : ''}
⏰ <b>Tɪᴍᴇ:</b> ${dateTime}
───────────────────────`;
            await NotifyAdmin(AdminEditMessage);
        }
        
        return Res.status(200).json({ 
            success: true, 
            message: 'Lɪꜰᴀꜰᴀ Uᴘᴅᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ!',
            data: {
                id: UpdatedLifafa.lifafaId,
                title: UpdatedLifafa.title,
                type: UpdatedLifafa.type,
                winChance: UpdatedLifafa.winChance,
                totalUsers: UpdatedLifafa.totalUsers,
                perUser: UpdatedLifafa.perUser,
                totalAmount: UpdatedLifafa.totalAmount,
                remainingUsers: UpdatedLifafa.remainingUsers,
                status: UpdatedLifafa.status
            }
        });
        
    } catch (Error) {
        console.error('❌ Eᴅɪᴛ Lɪꜰᴀꜰᴀ Eʀʀᴏʀ:', Error);
        return Res.status(200).json({ 
            success: false, 
            message: 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ Lᴀᴛᴇʀ.' 
        });
    }
});

// ==================== লিফাফা ডিটেইলস ====================
Router.get('/:type', async (Req, Res) => {
    try {
        const { id } = Req.query;
        const { type } = Req.params;
        
        if (!id) return Res.status(200).json({ success: false, message: 'Lɪꜰᴀꜰᴀ Iᴅ Iꜱ Rᴇǫᴜɪʀᴇᴅ' });
        
        const LifafaData = await Lifafa.findOne({ lifafaId: id });
        if (!LifafaData) return Res.status(200).json({ success: false, message: 'Lɪꜰᴀꜰᴀ Nᴏᴛ Fᴏᴜɴᴅ' });
        
        if (LifafaData.type.toLowerCase() !== type.toLowerCase()) {
            return Res.status(200).json({ 
                success: false, 
                message: 'Iɴᴠᴀʟɪᴅ Lɪꜰᴀꜰᴀ Tʏᴘᴇ. Expected: ' + LifafaData.type + ', Got: ' + type 
            });
        }
        
        if (LifafaData.isExpired && LifafaData.status === 'active') { 
            LifafaData.status = 'expired'; 
            await LifafaData.save(); 
        }
        
        return Res.status(200).json({ 
            success: true, 
            data: { 
                id: LifafaData.lifafaId, 
                title: LifafaData.title, 
                type: LifafaData.type, 
                winChance: LifafaData.winChance || null,
                perUser: LifafaData.perUser, 
                totalUsers: LifafaData.totalUsers, 
                remainingUsers: LifafaData.remainingUsers, 
                claimedCount: LifafaData.claimedUsers.length, 
                status: LifafaData.status, 
                requires: { 
                    refer: LifafaData.requireRefer, 
                    verify: LifafaData.requireVerify, 
                    youtube: LifafaData.requireYoutube, 
                    channel: LifafaData.requireChannel 
                }, 
                youtubeVideo: LifafaData.youtubeVideo || null, 
                channels: LifafaData.channels || [], 
                referAmount: LifafaData.referAmount || 0, 
                redirectLink: LifafaData.redirectLink || null,
                accessCode: LifafaData.accessCode || null,
                requireChannel: LifafaData.requireChannel || false,
                requireYoutube: LifafaData.requireYoutube || false,
                requireRefer: LifafaData.requireRefer || false,
                createdAt: LifafaData.createdAt, 
                expiresAt: LifafaData.expiresAt,
                claimedUsers: LifafaData.claimedUsers.map(function(c) {
                    return {
                        telegramId: c.telegramId,
                        mobile: c.mobile,
                        fingerprint: c.fingerprint,
                        claimedAt: c.claimedAt,
                        winAmount: c.winAmount,
                        isWinner: c.isWinner
                    };
                })
            } 
        });
    } catch (Error) { 
        console.error('❌ Fᴇᴛᴄʜ Lɪꜰᴀꜰᴀ Eʀʀᴏʀ:', Error); 
        return Res.status(200).json({ success: false, message: 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ Lᴀᴛᴇʀ.' }); 
    }
});

// ==================== লিফাফা ক্লেইম ====================
Router.post('/:type/claim', async (Req, Res) => {
    try {
        const { type } = Req.params;
        const { id, mobile, tgid, ref, accessCode, fingerprint, winAmount: clientWinAmount, isWinner: clientIsWinner } = Req.body;
        
        if (!id) return Res.status(200).json({ success: false, message: 'Lɪꜰᴀꜰᴀ Iᴅ Iꜱ Rᴇǫᴜɪʀᴇᴅ' });
        if (!mobile && !tgid) return Res.status(200).json({ success: false, message: 'Mᴏʙɪʟᴇ Oʀ Tᴇʟᴇɢʀᴀᴍ Iᴅ Iꜱ Rᴇǫᴜɪʀᴇᴅ' });
        
        const LifafaData = await Lifafa.findOne({ lifafaId: id });
        if (!LifafaData) return Res.status(200).json({ success: false, message: 'Lɪꜰᴀꜰᴀ Nᴏᴛ Fᴏᴜɴᴅ' });
        
        if (LifafaData.type.toLowerCase() !== type.toLowerCase()) {
            return Res.status(200).json({ 
                success: false, 
                message: 'Iɴᴠᴀʟɪᴅ Lɪꜰᴀꜰᴀ Tʏᴘᴇ. Expected: ' + LifafaData.type + ', Got: ' + type 
            });
        }
        
        if (LifafaData.status !== 'active') return Res.status(200).json({ success: false, message: 'Tʜɪꜱ Lɪꜰᴀꜰᴀ Iꜱ Nᴏ Lᴏɴɢᴇʀ Aᴄᴛɪᴠᴇ' });
        if (LifafaData.isExpired) { 
            LifafaData.status = 'expired'; 
            await LifafaData.save(); 
            return Res.status(200).json({ success: false, message: 'Tʜɪꜱ Lɪꜰᴀꜰᴀ Hᴀꜱ Exᴘɪʀᴇᴅ' }); 
        }
        if (LifafaData.remainingUsers <= 0) { 
            LifafaData.status = 'completed'; 
            await LifafaData.save(); 
            return Res.status(200).json({ success: false, message: 'Aʟʟ Uꜱᴇʀꜱ Hᴀᴠᴇ Aʟʀᴇᴀᴅʏ Cʟᴀɪᴍᴇᴅ Tʜɪꜱ Lɪꜰᴀꜰᴀ' }); 
        }
        
        if (LifafaData.accessCode && LifafaData.accessCode !== accessCode) {
            return Res.status(200).json({ success: false, message: 'Iɴᴠᴀʟɪᴅ Aᴄᴄᴇꜱꜱ Cᴏᴅᴇ' });
        }
        
        var AlreadyClaimed = LifafaData.claimedUsers.some(function(C) { return C.telegramId === tgid; });
        if (AlreadyClaimed) return Res.status(200).json({ success: false, message: 'Yᴏᴜ Hᴀᴠᴇ Aʟʀᴇᴀᴅʏ Cʟᴀɪᴍᴇᴅ Tʜɪꜱ Lɪꜰᴀꜰᴀ' });
        
        if (fingerprint) {
            var DeviceClaimed = LifafaData.claimedUsers.some(function(C) { return C.fingerprint === fingerprint; });
            if (DeviceClaimed) {
                return Res.status(200).json({ 
                    success: false, 
                    message: 'Tʜɪꜱ Dᴇᴠɪᴄᴇ Hᴀꜱ Aʟʀᴇᴀᴅʏ Cʟᴀɪᴍᴇᴅ Tʜɪꜱ Lɪꜰᴀꜰᴀ' 
                });
            }
        }
        
        var ClaimUser = null;
        if (mobile) {
            ClaimUser = await User.findOne({ mobile: mobile });
        }
        if (!ClaimUser && tgid) {
            ClaimUser = await User.findOne({ telegramId: tgid });
        }
        if (!ClaimUser) {
            return Res.status(200).json({ 
                success: false, 
                message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ. Pʟᴇᴀꜱᴇ Vᴇʀɪꜰʏ Yᴏᴜʀ Aᴄᴄᴏᴜɴᴛ.' 
            });
        }
        
        if (LifafaData.specialUsers) {
            var SpecialNumbers = LifafaData.specialUsers.split(',').map(function(S) { return S.trim(); });
            if (!SpecialNumbers.includes(ClaimUser.mobile)) {
                return Res.status(200).json({ success: false, message: 'Yᴏᴜ Aʀᴇ Nᴏᴛ Aᴜᴛʜᴏʀɪᴢᴇᴅ Tᴏ Cʟᴀɪᴍ Tʜɪꜱ Lɪꜰᴀꜰᴀ' });
            }
        }
        
        // চ্যানেল চেক
        if (LifafaData.requireChannel && LifafaData.channels.length > 0) {
            const botToken = process.env.BOT_TOKEN;
            if (botToken && ClaimUser.telegramId) {
                var allJoined = true;
                for (var ci = 0; ci < LifafaData.channels.length; ci++) {
                    var channel = LifafaData.channels[ci];
                    try {
                        var url = 'https://api.telegram.org/bot' + botToken + '/getChatMember';
                        var response = await Axios.post(url, {
                            chat_id: channel,
                            user_id: ClaimUser.telegramId
                        }, {
                            timeout: 10000,
                            headers: { 'Content-Type': 'application/json' }
                        });
                        
                        if (response.data && response.data.ok) {
                            var status = response.data.result.status;
                            var isJoined = ['creator', 'administrator', 'member'].includes(status);
                            if (!isJoined) allJoined = false;
                        } else {
                            allJoined = false;
                        }
                    } catch (error) {
                        allJoined = false;
                    }
                }
                
                if (!allJoined) {
                    return Res.status(200).json({ 
                        success: false, 
                        message: 'Pʟᴇᴀꜱᴇ Jᴏɪɴ Aʟʟ Rᴇǫᴜɪʀᴇᴅ Tᴇʟᴇɢʀᴀᴍ Cʜᴀɴɴᴇʟꜱ Fɪʀꜱᴛ' 
                    });
                }
            } else {
                return Res.status(200).json({ 
                    success: false, 
                    message: 'Pʟᴇᴀꜱᴇ Vᴇʀɪꜰʏ Yᴏᴜʀ Aᴄᴄᴏᴜɴᴛ Tᴏ Cʟᴀɪᴍ' 
                });
            }
        }
        
        var winAmount = 0;
        var isWinner = false;
        
        if (LifafaData.type === 'normal') {
            winAmount = LifafaData.perUser;
            isWinner = true;
        } else if (LifafaData.type === 'dice' || LifafaData.type === 'toss' || LifafaData.type === 'scratch') {
            if (clientIsWinner !== undefined && clientWinAmount !== undefined) {
                isWinner = clientIsWinner;
                winAmount = clientWinAmount;
            } else {
                var winChance = LifafaData.winChance || 50;
                var random = Math.random() * 100;
                isWinner = random <= winChance;
                winAmount = isWinner ? LifafaData.perUser : 0;
            }
        }
        
        var ReferrerId = null;
        if (ref) { 
            var ReferrerUser = await User.findOne({ referralCode: ref }); 
            if (ReferrerUser) ReferrerId = ReferrerUser._id; 
        }
        
        LifafaData.claimedUsers.push({ 
            userId: ClaimUser._id, 
            telegramId: tgid,
            mobile: ClaimUser.mobile,
            fingerprint: fingerprint || null,
            referrerId: ReferrerId, 
            claimedAt: new Date(),
            winAmount: winAmount,
            isWinner: isWinner
        });
        LifafaData.remainingUsers = LifafaData.totalUsers - LifafaData.claimedUsers.length;
        if (LifafaData.remainingUsers <= 0) LifafaData.status = 'completed';
        await LifafaData.save();
        
        if (isWinner && winAmount > 0) {
            ClaimUser.balance += winAmount; 
            await ClaimUser.save();
            
            var ClaimTransactionId = GenerateLifafaTxnId();
            var ClaimTransaction = new Transaction({ 
                tx_id: ClaimTransactionId,
                user_id: ClaimUser._id,
                sender_id: LifafaData.userId,
                receiver_id: ClaimUser._id,
                amount: winAmount, 
                type: 'lifafa_claim', 
                status: 'success', 
                remark: 'Lɪꜰᴀꜰᴀ Cʟᴀɪᴍ: ' + LifafaData.title,
                description: 'Lɪꜰᴀꜰᴀ Cʟᴀɪᴍ: ' + LifafaData.title,
                tx_time: new Date(),
                metadata: { 
                    lifafaId: LifafaData.lifafaId, 
                    type: 'claim', 
                    winAmount: winAmount, 
                    isWinner: isWinner,
                    transactionType: 'credit' 
                } 
            });
            await ClaimTransaction.save();
        }
        
        var winStatus = isWinner ? '✅ Wᴏɴ ₹' + winAmount : '❌ Lᴏꜱᴛ';
        var ClaimerMessage = 
'<b>─────────────────</b>\n' +
(isWinner ? '🎉' : '😔') + ' <b>Lɪꜰᴀꜰᴀ Cʟᴀɪᴍ Rᴇꜱᴜʟᴛ</b>\n' +
'<b>─────────────────</b>\n\n' +
'<b>👤 Dᴇᴀʀ ' + ClaimUser.fullName + ',</b>\n' +
'📌 <b>Tɪᴛʟᴇ:</b> ' + LifafaData.title + '\n' +
'📂 <b>Tʏᴘᴇ:</b> ' + LifafaData.type.toUpperCase() + '\n' +
(LifafaData.type !== 'normal' ? '🎲 <b>Wɪɴ Cʜᴀɴᴄᴇ:</b> ' + LifafaData.winChance + '%\n' : '') +
'💰 <b>Rᴇꜱᴜʟᴛ:</b> ' + winStatus + '\n\n' +
'───────────────────────\n' +
(isWinner ? '✅ Aᴍᴏᴜɴᴛ Cʀᴇᴅɪᴛᴇᴅ Tᴏ Yᴏᴜʀ Wᴀʟʟᴇᴛ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ.' : '😢 Bᴇᴛᴛᴇʀ Lᴜᴄᴋ Nᴇxᴛ Tɪᴍᴇ!') + '\n' +
'───────────────────────';
        await SendNotificationToUser(ClaimUser, ClaimerMessage);
        
        if (ReferrerId && LifafaData.referAmount > 0 && isWinner && winAmount > 0) {
            var Referrer = await User.findById(ReferrerId);
            if (Referrer) {
                Referrer.balance += LifafaData.referAmount; 
                await Referrer.save();
                
                var ReferTxnId = GenerateLifafaTxnId();
                var ReferTransaction = new Transaction({ 
                    tx_id: ReferTxnId,
                    user_id: ReferrerId,
                    sender_id: LifafaData.userId,
                    receiver_id: ReferrerId,
                    amount: LifafaData.referAmount, 
                    type: 'lifafa_referral', 
                    status: 'success', 
                    remark: 'Rᴇꜰᴇʀʀᴀʟ Bᴏɴᴜꜱ Fʀᴏᴍ ' + LifafaData.title,
                    description: 'Rᴇꜰᴇʀʀᴀʟ Bᴏɴᴜꜱ Fʀᴏᴍ ' + LifafaData.title,
                    tx_time: new Date(),
                    metadata: { 
                        lifafaId: LifafaData.lifafaId, 
                        type: 'referral',
                        transactionType: 'credit' 
                    } 
                });
                await ReferTransaction.save();
                
                var ReferrerMessage = 
'<b>─────────────────</b>\n' +
'<b>🎁 Rᴇꜰᴇʀʀᴀʟ Bᴏɴᴜꜱ Rᴇᴄᴇɪᴠᴇᴅ</b>\n' +
'<b>─────────────────</b>\n\n' +
'<b>👤 Dᴇᴀʀ ' + Referrer.fullName + ',</b> Yᴏᴜ Hᴀᴠᴇ Rᴇᴄᴇɪᴠᴇᴅ A Rᴇꜰᴇʀʀᴀʟ Bᴏɴᴜꜱ.\n\n' +
'📌 <b>Lɪꜰᴀꜰᴀ:</b> ' + LifafaData.title + '\n' +
'👤 <b>Rᴇꜰᴇʀʀᴇᴅ Uꜱᴇʀ:</b> ' + ClaimUser.fullName + '\n' +
'💰 <b>Bᴏɴᴜꜱ Aᴍᴏᴜɴᴛ:</b> ₹' + LifafaData.referAmount + '\n\n' +
'───────────────────────────\n' +
'✅ Bᴏɴᴜꜱ Aᴍᴏᴜɴᴛ Cʀᴇᴅɪᴛᴇᴅ Tᴏ Yᴏᴜʀ Wᴀʟʟᴇᴛ.\n' +
'🥳 Kᴇᴇᴘ Rᴇꜰᴇʀʀɪɴɢ Tᴏ Eᴀʀɴ Mᴏʀᴇ Bᴏɴᴜꜱ.\n' +
'───────────────────────────';
                await SendNotificationToUser(Referrer, ReferrerMessage);
            }
        }
        
        return Res.status(200).json({ 
            success: true, 
            message: isWinner ? 'Lɪꜰᴀꜰᴀ Cʟᴀɪᴍᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ!' : 'Lɪꜰᴀꜰᴀ Cʟᴀɪᴍᴇᴅ Bᴜᴛ Nᴏ Wɪɴ', 
            data: { 
                amount: winAmount, 
                isWinner: isWinner,
                winChance: LifafaData.winChance,
                remainingUsers: LifafaData.remainingUsers, 
                status: LifafaData.status, 
                redirectLink: LifafaData.redirectLink || null,
                message: isWinner ? 'Congratulations! You won ₹' + winAmount : 'Sorry! Better luck next time.'
            } 
        });
    } catch (Error) { 
        console.error('❌ Cʟᴀɪᴍ Lɪꜰᴀꜰᴀ Eʀʀᴏʀ:', Error); 
        return Res.status(200).json({ success: false, message: 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ Lᴀᴛᴇʀ.' }); 
    }
});

// ==================== ইউজারের সব লিফাফা ====================
Router.get('/user/all', VerifyToken, async (Req, Res) => {
    try {
        var Lifafas = await Lifafa.find({ userId: Req.userId }).sort({ createdAt: -1 }).limit(50);
        return Res.status(200).json({ 
            success: true, 
            data: Lifafas.map(function(L) {
                return { 
                    id: L.lifafaId, 
                    title: L.title, 
                    type: L.type, 
                    winChance: L.winChance || null,
                    totalUsers: L.totalUsers, 
                    claimedCount: L.claimedUsers.length, 
                    remainingUsers: L.remainingUsers, 
                    totalAmount: L.totalAmount, 
                    status: L.status, 
                    createdAt: L.createdAt, 
                    expiresAt: L.expiresAt, 
                    claimLink: AppUrl + '/' + L.type + '?id=' + L.lifafaId 
                };
            }) 
        });
    } catch (Error) { 
        console.error('❌ Fᴇᴛᴄʜ Lɪꜰᴀꜰᴀꜱ Eʀʀᴏʀ:', Error); 
        return Res.status(200).json({ success: false, message: 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ Lᴀᴛᴇʀ.' }); 
    }
});

// ==================== লিফাফা ডিলিট (শুধু এডমিন) ====================
Router.delete('/:id', VerifyToken, async (Req, Res) => {
    try {
        var LifafaData = await Lifafa.findOne({ lifafaId: Req.params.id });
        if (!LifafaData) return Res.status(200).json({ success: false, message: 'Lɪꜰᴀꜰᴀ Nᴏᴛ Fᴏᴜɴᴅ' });
        
        var UserData = await User.findById(Req.userId);
        var IsAdmin = UserData && UserData.isAdmin === true;
        
        if (!IsAdmin) {
            return Res.status(200).json({ 
                success: false, 
                message: 'Oɴʟʏ Aᴅᴍɪɴ Cᴀɴ Dᴇʟᴇᴛᴇ Lɪꜰᴀꜰᴀ.' 
            });
        }
        
        if (LifafaData.claimedUsers.length > 0) {
            return Res.status(200).json({ 
                success: false, 
                message: 'Cᴀɴɴᴏᴛ Dᴇʟᴇᴛᴇ Lɪꜰᴀꜰᴀ Tʜᴀᴛ Hᴀꜱ Bᴇᴇɴ Cʟᴀɪᴍᴇᴅ' 
            });
        }
        
        var Creator = await User.findById(LifafaData.userId);
        await LifafaData.deleteOne();
        
        if (Creator && Creator.telegramId) {
            var CreatorDeleteMessage = 
'<b>─────────────────</b>\n' +
'<b>🗑️ Lɪꜰᴀꜰᴀ Dᴇʟᴇᴛᴇᴅ Bʏ Aᴅᴍɪɴ</b>\n' +
'<b>─────────────────</b>\n\n' +
'<b>👤 Dᴇᴀʀ ' + Creator.fullName + ',</b> Yᴏᴜʀ Lɪꜰᴀꜰᴀ Hᴀꜱ Bᴇᴇɴ Dᴇʟᴇᴛᴇᴅ Bʏ Aᴅᴍɪɴ.\n\n' +
'📌 <b>Tɪᴛʟᴇ:</b> ' + LifafaData.title + '\n' +
'👤 <b>Dᴇʟᴇᴛᴇᴅ Bʏ:</b> Aᴅᴍɪɴ\n' +
'⚠️ <b>Nᴏ Rᴇꜰᴜɴᴅ Wɪʟʟ Bᴇ Pʀᴏᴠɪᴅᴇᴅ</b>\n' +
'───────────────────────────\n' +
'📊 <b>Sᴛᴀᴛᴜꜱ:</b> Dᴇʟᴇᴛᴇᴅ Bʏ Aᴅᴍɪɴ\n' +
'───────────────────────────';
            await SendNotificationToUser(Creator, CreatorDeleteMessage);
        }
        
        if (AdminTgId) {
            var AdminDeleteMessage = 
'<b>─────────────────</b>\n' +
'<b>🗑️ Lɪꜰᴀꜰᴀ Dᴇʟᴇᴛᴇᴅ Bʏ Aᴅᴍɪɴ</b>\n' +
'<b>─────────────────</b>\n\n' +
'👤 <b>Dᴇʟᴇᴛᴇᴅ Bʏ:</b> Aᴅᴍɪɴ (' + UserData.fullName + ')\n' +
'📌 <b>Tɪᴛʟᴇ:</b> ' + LifafaData.title + '\n' +
'👤 <b>Cʀᴇᴀᴛᴏʀ:</b> ' + (Creator ? Creator.fullName : 'Unknown') + '\n' +
'💰 <b>Tᴏᴛᴀʟ Aᴍᴏᴜɴᴛ:</b> ₹' + LifafaData.totalAmount + '\n' +
'📊 <b>Sᴛᴀᴛᴜꜱ:</b> Dᴇʟᴇᴛᴇᴅ\n' +
'───────────────────────────';
            await NotifyAdmin(AdminDeleteMessage);
        }
        
        return Res.status(200).json({ 
            success: true, 
            message: 'Lɪꜰᴀꜰᴀ Dᴇʟᴇᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ Bʏ Aᴅᴍɪɴ (Nᴏ Rᴇꜰᴜɴᴅ)'
        });
    } catch (Error) { 
        console.error('❌ Dᴇʟᴇᴛᴇ Lɪꜰᴀꜰᴀ Eʀʀᴏʀ:', Error); 
        return Res.status(200).json({ 
            success: false, 
            message: 'Sᴇʀᴠᴇʀ Eʀʀᴏʀ. Pʟᴇᴀꜱᴇ Tʀʏ Aɢᴀɪɴ Lᴀᴛᴇʀ.' 
        }); 
    }
});

module.exports = Router;
