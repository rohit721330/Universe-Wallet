// FILE: routes/profile.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth } = require('../middleware/auth');

// ============================================================
// GET CURRENT USER PROFILE
// ============================================================
router.get('/me', auth, async (req, res) => {
    try {
        console.log('📥 Fetching Profile For User:', req.userId);
        const user = await User.findById(req.userId).select('-password -__v');
        if (!user) {
            console.log('❌ User Not Found');
            return res.status(404).json({ success: false, message: 'User Not Found' });
        }
        console.log('✅ Profile Fetched Successfully');
        res.json({ success: true, user: user });
    } catch (error) {
        console.error('⚠️ Profile Fetch Error:', error.message);
        res.status(500).json({ success: false, message: 'Internal Server Error: ' + error.message });
    }
});

// ============================================================
// GET USER STATISTICS
// ============================================================
router.get('/stats', auth, async (req, res) => {
    try {
        console.log('📊 Fetching Stats For User:', req.userId);
        const user = await User.findById(req.userId);
        if (!user) {
            console.log('❌ User Not Found');
            return res.status(404).json({ success: false, message: 'User Not Found' });
        }
        const transactions = await Transaction.find({
            $or: [{ sender: req.userId }, { receiver: req.userId }]
        });
        let totalSent = 0, totalReceived = 0;
        transactions.forEach(tx => {
            if (tx.sender && tx.sender.toString() === req.userId.toString()) totalSent += tx.amount;
            if (tx.receiver && tx.receiver.toString() === req.userId.toString()) totalReceived += tx.amount;
        });
        console.log('✅ Stats Fetched Successfully');
        res.json({ success: true, stats: { totalSent, totalReceived } });
    } catch (error) {
        console.error('⚠️ Stats Fetch Error:', error.message);
        res.status(500).json({ success: false, message: 'Internal Server Error: ' + error.message });
    }
});

// ============================================================
// UPDATE PROFILE PICTURE
// ============================================================
router.post('/update-picture', auth, async (req, res) => {
    try {
        console.log('🖼️ Updating Profile Picture For User:', req.userId);
        const { profileImage } = req.body;
        if (!profileImage) {
            console.log('❌ No Image Provided');
            return res.status(400).json({ success: false, message: 'Please Provide An Image' });
        }
        if (!profileImage.startsWith('data:image/')) {
            console.log('❌ Invalid Image Format');
            return res.status(400).json({ success: false, message: 'Invalid Image Format. Please Use Base64 Encoded Image' });
        }
        const imageSizeInBytes = Buffer.from(profileImage.split(',')[1], 'base64').length;
        const maxSizeInBytes = 8 * 1024 * 1024;
        if (imageSizeInBytes > maxSizeInBytes) {
            console.log('❌ Image Too Large:', imageSizeInBytes);
            return res.status(400).json({ success: false, message: 'Image Size Exceeds 8MB Limit' });
        }
        const user = await User.findByIdAndUpdate(
            req.userId,
            { profilePicture: profileImage },
            { new: true, select: '-password -__v' }
        );
        if (!user) {
            console.log('❌ User Not Found');
            return res.status(404).json({ success: false, message: 'User Not Found' });
        }
        console.log('✅ Profile Picture Updated Successfully');
        res.json({ success: true, message: 'Profile Picture Updated Successfully', profilePicture: user.profilePicture });
    } catch (error) {
        console.error('⚠️ Profile Picture Update Error:', error.message);
        res.status(500).json({ success: false, message: 'Internal Server Error: ' + error.message });
    }
});

// ============================================================
// UPDATE USER PROFILE (Full Name, Mobile, Email, Telegram)
// ============================================================
router.put('/update', auth, async (req, res) => {
    try {
        console.log('✏️ Updating Profile For User:', req.userId);
        const { fullName, mobile, email, telegramId } = req.body;
        const updateData = {};
        if (fullName) updateData.fullName = fullName;
        if (mobile) updateData.mobile = mobile;
        if (email) updateData.email = email;
        if (telegramId) updateData.telegramId = telegramId;
        if (Object.keys(updateData).length === 0) {
            console.log('❌ No Fields To Update');
            return res.status(400).json({ success: false, message: 'Please Provide Fields To Update' });
        }
        // Check if email is already used by another user
        if (email) {
            const existingUser = await User.findOne({ email: email, _id: { $ne: req.userId } });
            if (existingUser) {
                return res.status(400).json({ success: false, message: 'Email Already In Use' });
            }
        }
        // Check if mobile is already used by another user
        if (mobile) {
            const existingUser = await User.findOne({ mobile: mobile, _id: { $ne: req.userId } });
            if (existingUser) {
                return res.status(400).json({ success: false, message: 'Mobile Number Already In Use' });
            }
        }
        const user = await User.findByIdAndUpdate(
            req.userId,
            updateData,
            { new: true, select: '-password -__v' }
        );
        if (!user) {
            console.log('❌ User Not Found');
            return res.status(404).json({ success: false, message: 'User Not Found' });
        }
        console.log('✅ Profile Updated Successfully');
        res.json({ success: true, message: 'Profile Updated Successfully', user: user });
    } catch (error) {
        console.error('⚠️ Profile Update Error:', error.message);
        res.status(500).json({ success: false, message: 'Internal Server Error: ' + error.message });
    }
});

// ============================================================
// CHANGE PASSWORD
// ============================================================
router.post('/change-password', auth, async (req, res) => {
    try {
        console.log('🔑 Changing Password For User:', req.userId);
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) {
            console.log('❌ Missing Password Fields');
            return res.status(400).json({ success: false, message: 'Please Provide Current And New Password' });
        }
        if (newPassword.length < 8 || newPassword.length > 15) {
            console.log('❌ New Password Invalid Length');
            return res.status(400).json({ success: false, message: 'New Password Must Be 8-15 Characters Long' });
        }
        const hasUppercase = /[A-Z]/.test(newPassword);
        const hasLowercase = /[a-z]/.test(newPassword);
        const hasNumber = /[0-9]/.test(newPassword);
        if (!hasUppercase || !hasLowercase || !hasNumber) {
            return res.status(400).json({ success: false, message: 'New Password Must Contain Uppercase, Lowercase And Number' });
        }
        const user = await User.findById(req.userId);
        if (!user) {
            console.log('❌ User Not Found');
            return res.status(404).json({ success: false, message: 'User Not Found' });
        }
        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            console.log('❌ Incorrect Current Password');
            return res.status(401).json({ success: false, message: 'Incorrect Current Password' });
        }
        user.password = newPassword;
        await user.save();
        console.log('✅ Password Changed Successfully');
        res.json({ success: true, message: 'Password Changed Successfully' });
    } catch (error) {
        console.error('⚠️ Password Change Error:', error.message);
        res.status(500).json({ success: false, message: 'Internal Server Error: ' + error.message });
    }
});

// ============================================================
// GET TRANSACTION HISTORY
// ============================================================
router.get('/transactions', auth, async (req, res) => {
    try {
        console.log('📜 Fetching Transactions For User:', req.userId);
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const transactions = await Transaction.find({
            $or: [{ sender: req.userId }, { receiver: req.userId }]
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('sender', 'fullName walletId')
        .populate('receiver', 'fullName walletId');
        const total = await Transaction.countDocuments({
            $or: [{ sender: req.userId }, { receiver: req.userId }]
        });
        console.log('✅ Transactions Fetched Successfully');
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
        console.error('⚠️ Transaction Fetch Error:', error.message);
        res.status(500).json({ success: false, message: 'Internal Server Error: ' + error.message });
    }
});

// ============================================================
// DELETE ACCOUNT (Requires Password Verification)
// ============================================================
router.post('/delete-account', auth, async (req, res) => {
    try {
        console.log('🗑️ Delete Account Request For User:', req.userId);
        const { password } = req.body;
        if (!password) {
            console.log('❌ Password Required');
            return res.status(400).json({ success: false, message: 'Please Provide Your Password To Confirm Deletion' });
        }
        const user = await User.findById(req.userId);
        if (!user) {
            console.log('❌ User Not Found');
            return res.status(404).json({ success: false, message: 'User Not Found' });
        }
        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            console.log('❌ Incorrect Password');
            return res.status(401).json({ success: false, message: 'Incorrect Password' });
        }
        await Transaction.deleteMany({ $or: [{ sender: req.userId }, { receiver: req.userId }] });
        await User.findByIdAndDelete(req.userId);
        console.log('✅ Account Deleted Successfully');
        res.json({ success: true, message: 'Account Deleted Successfully' });
    } catch (error) {
        console.error('⚠️ Account Deletion Error:', error.message);
        res.status(500).json({ success: false, message: 'Internal Server Error: ' + error.message });
    }
});

module.exports = router;
