// FILE: middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET;

const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: '𝐔ɴᴀᴜᴛʜᴏʀɪᴢᴇᴅ. 𝐓ᴏᴋᴇɴ 𝐌ɪꜱꜱɪɴɢ' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
      return res.status(401).json({ error: '𝐔ꜱᴇʀ 𝐍ᴏᴛ 𝐅ᴏᴜɴᴅ' });
    }

    if (user.isBlocked) {
      return res.status(403).json({ error: '𝐘ᴏᴜʀ 𝐀ᴄᴄᴏᴜɴᴛ ɪꜱ 𝐁ʟᴏᴄᴋᴇᴅ' });
    }

    req.user = user;
    req.userId = user._id;
    next();
  } catch (error) {
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
