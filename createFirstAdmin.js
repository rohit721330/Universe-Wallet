//FILE createFirstAdmin.js
const mongoose = require('mongoose');
const Admin = require('./models/Admin');
require('dotenv').config();

async function createSuperAdmin() {
    try {
        console.log('🔌 Connecting to MongoDB...');
        console.log('URI:', process.env.MONGODB_URI ? 'Found ✅' : 'MISSING ❌');
        
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ MongoDB connected');

        const existing = await Admin.findOne({ role: 'super_admin' });
        if (existing) {
            console.log('');
            console.log('⚠️  Super admin already exists:');
            console.log('   Admin ID :', existing.adminId);
            console.log('   Mobile   :', existing.mobile);
            console.log('   Role     :', existing.role);
            console.log('');
            console.log('💡 Try logging in with this Admin ID');
            process.exit(0);
        }

        const superAdmin = new Admin({
            adminId: 'superadmin',
            password: 'ChangeMe123!',
            fullName: 'Super Admin',
            mobile: '9999999999',
            email: 'admin@universewallet.com',
            role: 'super_admin',
            isActive: true,
            isBlocked: false
        });

        await superAdmin.save();

        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✅ SUPER ADMIN CREATED!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('   Admin ID : superadmin');
        console.log('   Password : ChangeMe123!');
        console.log('   Mobile   : 9999999999');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        console.log('⚠️  Now login on Vercel with these credentials!');
        console.log('');

        process.exit(0);
    } catch (err) {
        console.error('');
        console.error('❌ ERROR:', err.message);
        console.error('');
        if (err.message.includes('ECONNREFUSED') || err.message.includes('ENOTFOUND')) {
            console.error('💡 MONGODB_URI is wrong or no internet connection');
        }
        if (err.code === 11000) {
            console.error('💡 Admin already exists with that adminId/mobile');
        }
        process.exit(1);
    }
}

createSuperAdmin();
