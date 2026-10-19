// FILE: middleware/auth.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const JWT_SECRET = process.env.JWT_SECRET;

const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'Unauthorised Entry. Token Missing.' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
      return res.status(401).json({ error: 'User Not Found.' });
    }

    if (user.isBlocked) {
      return res.status(403).json({ error: 'Your Account Is Blocked.' });
    }

    req.user = user;
    req.userId = user._id;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid Token.' });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token Expired.' });
    }

    res.status(500).json({ error: error.message });
  }
};

module.exports = { auth };