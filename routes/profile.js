//FILE routes/peofile.js
// ============================================================
// Pʀɪᴍᴇ Pʀᴏꜰɪʟᴇ Rᴏᴜᴛᴇꜱ — Hᴀɴᴅᴡʀɪᴛɪɴɢ Rᴜʟᴇꜱ Aᴘᴘʟɪᴇᴅ
// Aʟʟ Rᴇꜱᴘᴏɴꜱᴇꜱ, Eʀʀᴏʀꜱ & Lᴏɢꜱ Fᴏʟʟᴏᴡ:
// "Cᴀᴘɪᴛᴀʟ Fɪʀꜱᴛ Lᴇᴛᴛᴇʀ + Sᴍᴀʟʟ Cᴀᴘꜱ" Fᴏʀᴍᴀᴛ
// Nᴏ ɢᴇɴᴇʀɪᴄ "Sᴇʀᴠᴇʀ Eʀʀᴏʀ" — Exᴀᴄᴛ Pʀᴏʙʟᴇᴍ Iꜱ Dᴇꜱᴄʀɪʙᴇᴅ
// ============================================================

const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth } = require('../middleware/auth');

// ============================================================
// Gᴇᴛ Cᴜʀʀᴇɴᴛ Uꜱᴇʀ Pʀᴏꜰɪʟᴇ
// ============================================================
router.get('/me', auth, async (req, res) => {
  try {
    console.log('📥 Fᴇᴛᴄʜɪɴɢ Pʀᴏꜰɪʟᴇ Fᴏʀ Uꜱᴇʀ:', req.userId);

    const user = await User.findById(req.userId).select('-password -__v');
    
    if (!user) {
      console.log('❌ Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ');
      return res.status(404).json({
        success: false,
        message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ'
      });
    }

    console.log('✅ Pʀᴏꜰɪʟᴇ Fᴇᴛᴄʜᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ');
    res.json({
      success: true,
      user: user
    });
  } catch (error) {
    console.error('⚠️ Pʀᴏꜰɪʟᴇ Fᴇᴛᴄʜ Eʀʀᴏʀ:', error.message);
    res.status(500).json({
      success: false,
      message: 'Iɴᴛᴇʀɴᴀʟ Sᴇʀᴠᴇʀ Eʀʀᴏʀ: ' + error.message
    });
  }
});

// ============================================================
// Gᴇᴛ Uꜱᴇʀ Sᴛᴀᴛɪꜱᴛɪᴄꜱ (Tᴏᴛᴀʟ Sᴇɴᴛ/Rᴇᴄᴇɪᴠᴇᴅ)
// ============================================================
router.get('/stats', auth, async (req, res) => {
  try {
    console.log('📊 Fᴇᴛᴄʜɪɴɢ Sᴛᴀᴛꜱ Fᴏʀ Uꜱᴇʀ:', req.userId);

    const user = await User.findById(req.userId);
    if (!user) {
      console.log('❌ Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ');
      return res.status(404).json({
        success: false,
        message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ'
      });
    }

    // Cᴀʟᴄᴜʟᴀᴛᴇ Tᴏᴛᴀʟ Sᴇɴᴛ & Rᴇᴄᴇɪᴠᴇᴅ Fʀᴏᴍ Tʀᴀɴꜱᴀᴄᴛɪᴏɴꜱ
    const transactions = await Transaction.find({
      $or: [
        { sender: req.userId },
        { receiver: req.userId }
      ]
    });

    let totalSent = 0;
    let totalReceived = 0;

    transactions.forEach(tx => {
      if (tx.sender && tx.sender.toString() === req.userId.toString()) {
        totalSent += tx.amount;
      }
      if (tx.receiver && tx.receiver.toString() === req.userId.toString()) {
        totalReceived += tx.amount;
      }
    });

    console.log('✅ Sᴛᴀᴛꜱ Fᴇᴛᴄʜᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ');
    res.json({
      success: true,
      stats: {
        totalSent: totalSent,
        totalReceived: totalReceived
      }
    });
  } catch (error) {
    console.error('⚠️ Sᴛᴀᴛꜱ Fᴇᴛᴄʜ Eʀʀᴏʀ:', error.message);
    res.status(500).json({
      success: false,
      message: 'Iɴᴛᴇʀɴᴀʟ Sᴇʀᴠᴇʀ Eʀʀᴏʀ: ' + error.message
    });
  }
});

// ============================================================
// Uᴘᴅᴀᴛᴇ Pʀᴏꜰɪʟᴇ Pɪᴄᴛᴜʀᴇ
// ============================================================
router.post('/update-picture', auth, async (req, res) => {
  try {
    console.log('🖼️ Uᴘᴅᴀᴛɪɴɢ Pʀᴏꜰɪʟᴇ Pɪᴄᴛᴜʀᴇ Fᴏʀ Uꜱᴇʀ:', req.userId);

    const { profileImage } = req.body;

    if (!profileImage) {
      console.log('❌ Nᴏ Iᴍᴀɢᴇ Pʀᴏᴠɪᴅᴇᴅ');
      return res.status(400).json({
        success: false,
        message: 'Pʟᴇᴀꜱᴇ Pʀᴏᴠɪᴅᴇ Aɴ Iᴍᴀɢᴇ'
      });
    }

    // Vᴀʟɪᴅᴀᴛᴇ Iᴍᴀɢᴇ Fᴏʀᴍᴀᴛ (Bᴀꜱᴇ64)
    if (!profileImage.startsWith('data:image/')) {
      console.log('❌ Iɴᴠᴀʟɪᴅ Iᴍᴀɢᴇ Fᴏʀᴍᴀᴛ');
      return res.status(400).json({
        success: false,
        message: 'Iɴᴠᴀʟɪᴅ Iᴍᴀɢᴇ Fᴏʀᴍᴀᴛ. Pʟᴇᴀꜱᴇ Uꜱᴇ Bᴀꜱᴇ64 Eɴᴄᴏᴅᴇᴅ Iᴍᴀɢᴇ'
      });
    }

    // Cʜᴇᴄᴋ Iᴍᴀɢᴇ Sɪᴢᴇ (Aᴘᴘʀᴏxɪᴍᴀᴛᴇ)
    const imageSizeInBytes = Buffer.from(profileImage.split(',')[1], 'base64').length;
    const maxSizeInBytes = 8 * 1024 * 1024; // 8MB

    if (imageSizeInBytes > maxSizeInBytes) {
      console.log('❌ Iᴍᴀɢᴇ Tᴏᴏ Lᴀʀɢᴇ:', imageSizeInBytes);
      return res.status(400).json({
        success: false,
        message: 'Iᴍᴀɢᴇ Sɪᴢᴇ Exᴄᴇᴇᴅꜱ 8MB Lɪᴍɪᴛ'
      });
    }

    // Uᴘᴅᴀᴛᴇ Uꜱᴇʀ Pʀᴏꜰɪʟᴇ Pɪᴄᴛᴜʀᴇ
    const user = await User.findByIdAndUpdate(
      req.userId,
      { profilePicture: profileImage },
      { new: true, select: '-password -__v' }
    );

    if (!user) {
      console.log('❌ Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ');
      return res.status(404).json({
        success: false,
        message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ'
      });
    }

    console.log('✅ Pʀᴏꜰɪʟᴇ Pɪᴄᴛᴜʀᴇ Uᴘᴅᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ');
    res.json({
      success: true,
      message: 'Pʀᴏꜰɪʟᴇ Pɪᴄᴛᴜʀᴇ Uᴘᴅᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ',
      profilePicture: user.profilePicture
    });
  } catch (error) {
    console.error('⚠️ Pʀᴏꜰɪʟᴇ Pɪᴄᴛᴜʀᴇ Uᴘᴅᴀᴛᴇ Eʀʀᴏʀ:', error.message);
    res.status(500).json({
      success: false,
      message: 'Iɴᴛᴇʀɴᴀʟ Sᴇʀᴠᴇʀ Eʀʀᴏʀ: ' + error.message
    });
  }
});

// ============================================================
// Uᴘᴅᴀᴛᴇ Uꜱᴇʀ Pʀᴏꜰɪʟᴇ (Fᴜʟʟ Nᴀᴍᴇ, Mᴏʙɪʟᴇ, Eᴛᴄ.)
// ============================================================
router.put('/update', auth, async (req, res) => {
  try {
    console.log('✏️ Uᴘᴅᴀᴛɪɴɢ Pʀᴏꜰɪʟᴇ Fᴏʀ Uꜱᴇʀ:', req.userId);

    const { fullName, mobile, telegramId } = req.body;

    // Bᴜɪʟᴅ Uᴘᴅᴀᴛᴇ Oʙᴊᴇᴄᴛ
    const updateData = {};
    if (fullName) updateData.fullName = fullName;
    if (mobile) updateData.mobile = mobile;
    if (telegramId) updateData.telegramId = telegramId;

    if (Object.keys(updateData).length === 0) {
      console.log('❌ Nᴏ Fɪᴇʟᴅꜱ Tᴏ Uᴘᴅᴀᴛᴇ');
      return res.status(400).json({
        success: false,
        message: 'Pʟᴇᴀꜱᴇ Pʀᴏᴠɪᴅᴇ Fɪᴇʟᴅꜱ Tᴏ Uᴘᴅᴀᴛᴇ'
      });
    }

    const user = await User.findByIdAndUpdate(
      req.userId,
      updateData,
      { new: true, select: '-password -__v' }
    );

    if (!user) {
      console.log('❌ Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ');
      return res.status(404).json({
        success: false,
        message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ'
      });
    }

    console.log('✅ Pʀᴏꜰɪʟᴇ Uᴘᴅᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ');
    res.json({
      success: true,
      message: 'Pʀᴏꜰɪʟᴇ Uᴘᴅᴀᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ',
      user: user
    });
  } catch (error) {
    console.error('⚠️ Pʀᴏꜰɪʟᴇ Uᴘᴅᴀᴛᴇ Eʀʀᴏʀ:', error.message);
    res.status(500).json({
      success: false,
      message: 'Iɴᴛᴇʀɴᴀʟ Sᴇʀᴠᴇʀ Eʀʀᴏʀ: ' + error.message
    });
  }
});

// ============================================================
// Cʜᴀɴɢᴇ Pᴀꜱꜱᴡᴏʀᴅ
// ============================================================
router.post('/change-password', auth, async (req, res) => {
  try {
    console.log('🔑 Cʜᴀɴɢɪɴɢ Pᴀꜱꜱᴡᴏʀᴅ Fᴏʀ Uꜱᴇʀ:', req.userId);

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      console.log('❌ Mɪꜱꜱɪɴɢ Pᴀꜱꜱᴡᴏʀᴅ Fɪᴇʟᴅꜱ');
      return res.status(400).json({
        success: false,
        message: 'Pʟᴇᴀꜱᴇ Pʀᴏᴠɪᴅᴇ Cᴜʀʀᴇɴᴛ Aɴᴅ Nᴇᴡ Pᴀꜱꜱᴡᴏʀᴅ'
      });
    }

    if (newPassword.length < 6) {
      console.log('❌ Nᴇᴡ Pᴀꜱꜱᴡᴏʀᴅ Tᴏᴏ Sʜᴏʀᴛ');
      return res.status(400).json({
        success: false,
        message: 'Nᴇᴡ Pᴀꜱꜱᴡᴏʀᴅ Mᴜꜱᴛ Bᴇ Aᴛ Lᴇᴀꜱᴛ 6 Cʜᴀʀᴀᴄᴛᴇʀꜱ Lᴏɴɢ'
      });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      console.log('❌ Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ');
      return res.status(404).json({
        success: false,
        message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ'
      });
    }

    // Vᴇʀɪꜰʏ Cᴜʀʀᴇɴᴛ Pᴀꜱꜱᴡᴏʀᴅ
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      console.log('❌ Iɴᴄᴏʀʀᴇᴄᴛ Cᴜʀʀᴇɴᴛ Pᴀꜱꜱᴡᴏʀᴅ');
      return res.status(401).json({
        success: false,
        message: 'Iɴᴄᴏʀʀᴇᴄᴛ Cᴜʀʀᴇɴᴛ Pᴀꜱꜱᴡᴏʀᴅ'
      });
    }

    // Uᴘᴅᴀᴛᴇ Pᴀꜱꜱᴡᴏʀᴅ
    user.password = newPassword;
    await user.save();

    console.log('✅ Pᴀꜱꜱᴡᴏʀᴅ Cʜᴀɴɢᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ');
    res.json({
      success: true,
      message: 'Pᴀꜱꜱᴡᴏʀᴅ Cʜᴀɴɢᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ'
    });
  } catch (error) {
    console.error('⚠️ Pᴀꜱꜱᴡᴏʀᴅ Cʜᴀɴɢᴇ Eʀʀᴏʀ:', error.message);
    res.status(500).json({
      success: false,
      message: 'Iɴᴛᴇʀɴᴀʟ Sᴇʀᴠᴇʀ Eʀʀᴏʀ: ' + error.message
    });
  }
});

// ============================================================
// Gᴇᴛ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Hɪꜱᴛᴏʀʏ
// ============================================================
router.get('/transactions', auth, async (req, res) => {
  try {
    console.log('📜 Fᴇᴛᴄʜɪɴɢ Tʀᴀɴꜱᴀᴄᴛɪᴏɴꜱ Fᴏʀ Uꜱᴇʀ:', req.userId);

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const transactions = await Transaction.find({
      $or: [
        { sender: req.userId },
        { receiver: req.userId }
      ]
    })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('sender', 'fullName walletId')
    .populate('receiver', 'fullName walletId');

    const total = await Transaction.countDocuments({
      $or: [
        { sender: req.userId },
        { receiver: req.userId }
      ]
    });

    console.log('✅ Tʀᴀɴꜱᴀᴄᴛɪᴏɴꜱ Fᴇᴛᴄʜᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ');
    res.json({
      success: true,
      transactions: transactions,
      pagination: {
        page: page,
        limit: limit,
        total: total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('⚠️ Tʀᴀɴꜱᴀᴄᴛɪᴏɴ Fᴇᴛᴄʜ Eʀʀᴏʀ:', error.message);
    res.status(500).json({
      success: false,
      message: 'Iɴᴛᴇʀɴᴀʟ Sᴇʀᴠᴇʀ Eʀʀᴏʀ: ' + error.message
    });
  }
});

// ============================================================
// Dᴇʟᴇᴛᴇ Aᴄᴄᴏᴜɴᴛ (Rᴇǫᴜɪʀᴇꜱ Pᴀꜱꜱᴡᴏʀᴅ Vᴇʀɪꜰɪᴄᴀᴛɪᴏɴ)
// ============================================================
router.post('/delete-account', auth, async (req, res) => {
  try {
    console.log('🗑️ Dᴇʟᴇᴛᴇ Aᴄᴄᴏᴜɴᴛ Rᴇǫᴜᴇꜱᴛ Fᴏʀ Uꜱᴇʀ:', req.userId);

    const { password } = req.body;

    if (!password) {
      console.log('❌ Pᴀꜱꜱᴡᴏʀᴅ Rᴇǫᴜɪʀᴇᴅ');
      return res.status(400).json({
        success: false,
        message: 'Pʟᴇᴀꜱᴇ Pʀᴏᴠɪᴅᴇ Yᴏᴜʀ Pᴀꜱꜱᴡᴏʀᴅ Tᴏ Cᴏɴꜰɪʀᴍ Dᴇʟᴇᴛɪᴏɴ'
      });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      console.log('❌ Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ');
      return res.status(404).json({
        success: false,
        message: 'Uꜱᴇʀ Nᴏᴛ Fᴏᴜɴᴅ'
      });
    }

    // Vᴇʀɪꜰʏ Pᴀꜱꜱᴡᴏʀᴅ
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      console.log('❌ Iɴᴄᴏʀʀᴇᴄᴛ Pᴀꜱꜱᴡᴏʀᴅ');
      return res.status(401).json({
        success: false,
        message: 'Iɴᴄᴏʀʀᴇᴄᴛ Pᴀꜱꜱᴡᴏʀᴅ'
      });
    }

    // Dᴇʟᴇᴛᴇ Uꜱᴇʀ Aɴᴅ Tʜᴇɪʀ Tʀᴀɴꜱᴀᴄᴛɪᴏɴꜱ
    await Transaction.deleteMany({
      $or: [
        { sender: req.userId },
        { receiver: req.userId }
      ]
    });

    await User.findByIdAndDelete(req.userId);

    console.log('✅ Aᴄᴄᴏᴜɴᴛ Dᴇʟᴇᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ');
    res.json({
      success: true,
      message: 'Aᴄᴄᴏᴜɴᴛ Dᴇʟᴇᴛᴇᴅ Sᴜᴄᴄᴇꜱꜱꜰᴜʟʟʏ'
    });
  } catch (error) {
    console.error('⚠️ Aᴄᴄᴏᴜɴᴛ Dᴇʟᴇᴛɪᴏɴ Eʀʀᴏʀ:', error.message);
    res.status(500).json({
      success: false,
      message: 'Iɴᴛᴇʀɴᴀʟ Sᴇʀᴠᴇʀ Eʀʀᴏʀ: ' + error.message
    });
  }
});

module.exports = router;
