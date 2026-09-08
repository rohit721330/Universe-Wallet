// FILE: middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET || 'k9xjtwX5rP2mQ8vR4sT7wY3uA1fD6gH9jK2lZ5nM';

const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    console.log('🔍 Auth Header:', authHeader); // লগ যোগ করুন

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ No Bearer token found');
      return res.status(401).json({ error: '𝐔ɴᴀᴜᴛʜᴏʀɪᴢᴇᴅ. 𝐓ᴏᴋᴇɴ 𝐌ɪꜱꜱɪɴɢ' });
    }

    const token = authHeader.split(' ')[1];
    console.log('🔍 Token received:', token.substring(0, 20) + '...'); // লগ যোগ করুন

    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('🔍 Decoded token:', decoded); // লগ যোগ করুন

    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      console.log('❌ User not found for ID:', decoded.userId);
      return res.status(401).json({ error: '𝐔ꜱᴇʀ 𝐍ᴏᴛ 𝐅ᴏᴜɴᴅ' });
    }

    if (user.isBlocked) {
      return res.status(403).json({ error: '𝐘ᴏᴜʀ 𝐀ᴄᴄᴏᴜɴᴛ ɪꜱ 𝐁ʟᴏᴄᴋᴇᴅ' });
    }

    // ✅ সঠিকভাবে req.userId সেট করা হচ্ছে কিনা চেক করুন
    req.user = user;
    req.userId = user._id; // এটি সঠিকভাবে সেট হচ্ছে
    console.log('✅ Auth success for user:', user.fullName, 'ID:', req.userId); // লগ যোগ করুন
    next();
  } catch (error) {
    console.error('❌ Auth Error:', error.name, error.message);
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: '𝐈ɴᴠᴀʟɪᴅ 𝐓ᴏᴋᴇɴ' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '𝐓ᴏᴋᴇɴ 𝐄xᴘɪʀᴇᴅ' });
    }
    res.status(500).json({ error: error.message });
  }
};

module.exports = { auth };
