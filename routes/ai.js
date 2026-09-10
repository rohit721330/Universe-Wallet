// FILE: routes/ai.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
require('dotenv').config();

// ============================================
// AI CONFIGURATION
// ============================================
const AI_API_KEY = process.env.AI_API_KEY;
const AI_API_URL = process.env.AI_API_URL;
const AI_MODEL = process.env.AI_MODEL || 'llama-3.3-70b-versatile';

// ============================================
// SYSTEM PROMPT
// ============================================
const SYSTEM_PROMPT = `You are Universal Wallet AI Assistant — a helpful, friendly, and knowledgeable assistant for the Universal Wallet digital wallet platform.

You help users with:
- Wallet features and how to use them
- Lifafa (gift envelope) system
- Deposit and withdrawal process
- Transfer issues and troubleshooting
- Gift code redemption
- Account security best practices
- PIN and OTP safety
- General questions about Universal Wallet

IMPORTANT RULES:
1. Be helpful, concise, and friendly
2. Answer in the same language the user asks (Hindi, English, or Hinglish)
3. If you don't know something specific, guide them to contact support
4. Never ask for PIN, OTP, or password
5. Keep responses under 200 words unless detailed explanation is needed
6. Use bullet points for step-by-step instructions
7. If user asks about non-wallet topics, politely redirect to wallet-related help`;

// ============================================
// RULE-BASED FALLBACK RESPONSES
// ============================================
function getRuleBasedReply(message) {
    const lowerMsg = message.toLowerCase().trim();

    // Greetings
    if (/^(hi|hello|hey|hii|hlo|namaste|नमस्ते)/i.test(lowerMsg)) {
        return `Hello! 👋 I'm Universal Wallet AI.\n\nHow can I help you today?\n\nAsk me about:\n• Wallet features\n• Deposit & withdrawal\n• Lifafa system\n• Transfer help\n• Account security`;
    }

    // Features
    if (lowerMsg.includes('feature') || lowerMsg.includes('what can') || lowerMsg.includes('kya kar') || lowerMsg.includes('क्या कर')) {
        return `Universal Wallet offers:\n\n• Instant money transfers\n• Lifafa (gift envelope) system\n• Gift code redemption\n• Zero-fee withdrawals\n• Secure PIN protection\n• Task-based earning\n• Telegram notifications\n• API integration\n\nWhat would you like to know more about?`;
    }

    // Lifafa
    if (lowerMsg.includes('lifafa') || lowerMsg.includes('envelope') || lowerMsg.includes('लिफाफा')) {
        return `The Lifafa system lets you send gift envelopes:\n\n1. Go to Lifafa section\n2. Set total amount and number of users\n3. Add optional conditions (channel join, etc.)\n4. Share the link\n5. Users claim their share\n\nEach user can claim a specific Lifafa only once.\n\nWant to create one? Go to Lifafa page!`;
    }

    // Deposit
    if (lowerMsg.includes('deposit') || lowerMsg.includes('add money') || lowerMsg.includes('paisa') || lowerMsg.includes('पैसा') || lowerMsg.includes('recharge')) {
        return `To deposit money:\n\n1. Go to Deposit section\n2. Enter amount (min ₹1, max ₹5000)\n3. Pay via UPI to the shown ID\n4. Submit UTR/Transaction number\n5. Wait for admin approval (up to 24 hours)\n\nYour balance updates after verification.`;
    }

    // Withdraw
    if (lowerMsg.includes('withdraw') || lowerMsg.includes('निकाल')) {
        return `To withdraw money:\n\n1. Go to Withdraw section\n2. Enter amount\n3. Enter UPI ID (verified)\n4. Submit request\n5. Processing within 48 hours\n\n✅ Zero fees — you receive the exact amount requested!`;
    }

    // Transfer
    if (lowerMsg.includes('transfer') || lowerMsg.includes('send money') || lowerMsg.includes('भेज')) {
        return `To send money:\n\n1. Go to Transfer section\n2. Enter receiver's mobile number\n3. Enter amount\n4. Add optional note\n5. Confirm with your PIN\n\nMoney is instantly credited to receiver's wallet.`;
    }

    // Transfer fail
    if (lowerMsg.includes('fail') || lowerMsg.includes('error') || lowerMsg.includes('problem') || lowerMsg.includes('issue')) {
        return `If a transfer fails:\n\n1. Check your balance is sufficient\n2. Verify receiver's mobile number\n3. Check your internet connection\n4. Wait 5 minutes and retry\n\nIf still failing:\n• Note down the transaction ID\n• Contact support with details\n• Response within 48 hours`;
    }

    // Gift
    if (lowerMsg.includes('gift') || lowerMsg.includes('code') || lowerMsg.includes('गिफ्ट')) {
        return `Gift codes:\n\n• Enter code to redeem wallet credits\n• Each code is single-use\n• May have expiry date\n• Non-transferable\n\nWhere to get codes:\n• Promotions\n• Campaigns\n• Admin giveaway\n\nHave a code? Go to Gift page!`;
    }

    // Security
    if (lowerMsg.includes('security') || lowerMsg.includes('safe') || lowerMsg.includes('secure') || lowerMsg.includes('सुरक्षा')) {
        return `Security tips:\n\n🔐 Never share your PIN or OTP\n🔒 Use a strong password\n📱 Enable device lock\n🚫 Don't click suspicious links\n🔄 Change password regularly\n\n⚠️ Universal Wallet NEVER asks for:\n• Your password\n• Your PIN\n• Your OTP\n\nIf someone asks — report immediately!`;
    }

    // PIN
    if (lowerMsg.includes('pin')) {
        return `About PIN:\n\n• 4-digit PIN protects your wallet\n• Required for transfers & withdrawals\n• Never share with anyone\n\nForgot PIN?\n1. Go to PIN screen\n2. Click "Forgot PIN"\n3. Enter Telegram ID\n4. Get OTP\n5. Reset PIN`;
    }

    // OTP
    if (lowerMsg.includes('otp')) {
        return `About OTP:\n\n• OTP = One Time Password\n• Sent to your Telegram\n• Valid for 5 minutes\n• Used for verification\n\n⚠️ Never share OTP with anyone!\nUniversal Wallet never asks for OTP.`;
    }

    // Account
    if (lowerMsg.includes('account') || lowerMsg.includes('profile') || lowerMsg.includes('खाता')) {
        return `Account features:\n\n• One account per mobile number\n• Multiple accounts = ban\n• View profile, balance, history\n• Update settings anytime\n\nNeed to change something?\nGo to Profile page!`;
    }

    // Balance
    if (lowerMsg.includes('balance') || lowerMsg.includes('बैलेंस')) {
        return `Your balance:\n\n• Shown on Dashboard\n• Updates in real-time\n• Includes all credits\n• Used for transfers & withdrawals\n\nRefresh button on Dashboard to sync balance.`;
    }

    // Thanks
    if (lowerMsg.includes('thank') || lowerMsg.includes('thanks') || lowerMsg.includes('धन्यवाद')) {
        return `You're welcome! 😊\n\nAnything else I can help you with?\n\nFeel free to ask about:\n• Wallet features\n• Deposit & withdrawal\n• Lifafa system\n• Account security`;
    }

    // Bye
    if (lowerMsg.includes('bye') || lowerMsg.includes('goodbye') || lowerMsg.includes('अलविदा')) {
        return `Goodbye! 👋\n\nHave a great day using Universal Wallet!\n\nCome back anytime you need help.`;
    }

    // Help
    if (lowerMsg.includes('help') || lowerMsg.includes('मदद')) {
        return `Here's how I can help:\n\n💼 Wallet features\n💰 Deposit guide\n💸 Withdrawal process\n🧧 Lifafa system\n📤 Transfer help\n🎁 Gift codes\n🔐 Security tips\n\nJust type your question!`;
    }

    // Default
    return `I'm here to help with Universal Wallet!\n\nYou can ask me about:\n\n• Wallet features\n• Deposit process\n• Withdrawal process\n• Lifafa system\n• Transfer issues\n• Gift codes\n• Account security\n• PIN & OTP safety\n\nType your question or use the quick options.`;
}

// ============================================
// POST /ai/chat — Main Chat Endpoint
// ============================================
router.post('/chat', async (req, res) => {
    try {
        const { message, history } = req.body;

        console.log('📥 AI Chat Request:', {
            message: message?.substring(0, 50),
            historyLength: history?.length || 0
        });

        // Validate message
        if (!message || !message.trim()) {
            return res.status(400).json({
                status: 'error',
                message: 'Message is required'
            });
        }

        // Limit message length
        if (message.length > 1000) {
            return res.status(400).json({
                status: 'error',
                message: 'Message is too long (max 1000 characters)'
            });
        }

        // ============================================
        // TRY REAL AI FIRST (if API configured)
        // ============================================
        if (AI_API_KEY && AI_API_URL) {
            try {
                const messages = [
                    { role: 'system', content: SYSTEM_PROMPT },
                    ...(Array.isArray(history) ? history.slice(-10) : []),
                    { role: 'user', content: message }
                ];

                const aiResponse = await axios.post(
                    AI_API_URL,
                    {
                        model: AI_MODEL,
                        messages: messages,
                        temperature: 0.7,
                        max_tokens: 1024,
                        stream: false
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${AI_API_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 30000
                    }
                );

                const reply = aiResponse.data?.choices?.[0]?.message?.content;

                if (reply) {
                    console.log('✅ AI Response received');
                    return res.json({
                        status: 'success',
                        reply: reply.trim(),
                        model: aiResponse.data?.model || AI_MODEL
                    });
                }
            } catch (apiError) {
                console.error('❌ AI API Error:', apiError.message);
                if (apiError.response) {
                    console.error('API Response:', apiError.response.data);
                }
                // Fall through to rule-based
            }
        }

        // ============================================
        // FALLBACK: RULE-BASED RESPONSE
        // ============================================
        console.log('📋 Using rule-based fallback');
        const reply = getRuleBasedReply(message);

        return res.json({
            status: 'success',
            reply: reply,
            model: 'Rule-Based'
        });

    } catch (error) {
        console.error('❌ AI Chat Error:', error.message);
        return res.status(500).json({
            status: 'error',
            message: 'AI service temporarily unavailable. Please try again.'
        });
    }
});

// ============================================
// GET /ai/health — Health Check
// ============================================
router.get('/health', (req, res) => {
    res.json({
        status: 'success',
        service: 'Universal Wallet AI',
        aiConfigured: !!(AI_API_KEY && AI_API_URL),
        model: AI_API_KEY && AI_API_URL ? AI_MODEL : 'Rule-Based',
        timestamp: new Date().toISOString()
    });
});

// ============================================
// EXPORT
// ============================================
module.exports = router;
