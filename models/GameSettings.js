// FILE: models/GameSettings.js
const mongoose = require('mongoose');

const GameSettingsSchema = new mongoose.Schema({
    // ============================================================
    // 🪙 Cᴏ𝙸ɴ Fʟ𝙸ᴘ Sᴇᴛᴛ𝙸ɴɢꜱ
    // ============================================================
    coinFlip: {
        winChance: {
            type: Number,
            default: 50,
            min: 0,
            max: 100,
            description: 'W𝙸ɴɴ𝙸ɴɢ Cʜᴀɴᴄᴇ 𝙸ɴ Pᴇʀᴄᴇɴᴛᴀɢᴇ (0-100)'
        },
        minBet: {
            type: Number,
            default: 5,
            min: 1,
            description: 'M𝙸ɴ𝙸ᴍᴜᴍ Bᴇᴛ Aᴍᴏᴜɴᴛ 𝙸ɴ Rᴜᴘᴇᴇꜱ'
        },
        maxBet: {
            type: Number,
            default: 10000,
            min: 1,
            description: 'Mᴀx𝙸ᴍᴜᴍ Bᴇᴛ Aᴍᴏᴜɴᴛ 𝙸ɴ Rᴜᴘᴇᴇꜱ'
        },
        payout: {
            type: Number,
            default: 2,
            min: 1.1,
            max: 10,
            description: 'Pᴀʏᴏᴜᴛ Mᴜʟᴛ𝙸ᴘʟ𝙸ᴇʀ (E.ɢ., 2 = 2x Bᴇᴛ)'
        },
        enabled: {
            type: Boolean,
            default: true,
            description: 'Wʜᴇᴛʜᴇʀ Tʜᴇ Gᴀᴍᴇ 𝙸ꜱ Eɴᴀʙʟᴇᴅ'
        }
    },

    // ============================================================
    // 🎯 Rᴇᴅ / Gʀᴇᴇɴ Sᴇᴛᴛ𝙸ɴɢꜱ
    // ============================================================
    redGreen: {
        winChance: {
            type: Number,
            default: 50,
            min: 0,
            max: 100,
            description: 'W𝙸ɴɴ𝙸ɴɢ Cʜᴀɴᴄᴇ 𝙸ɴ Pᴇʀᴄᴇɴᴛᴀɢᴇ (0-100)'
        },
        minBet: {
            type: Number,
            default: 5,
            min: 1,
            description: 'M𝙸ɴ𝙸ᴍᴜᴍ Bᴇᴛ Aᴍᴏᴜɴᴛ 𝙸ɴ Rᴜᴘᴇᴇꜱ'
        },
        maxBet: {
            type: Number,
            default: 10000,
            min: 1,
            description: 'Mᴀx𝙸ᴍᴜᴍ Bᴇᴛ Aᴍᴏᴜɴᴛ 𝙸ɴ Rᴜᴘᴇᴇꜱ'
        },
        payout: {
            type: Number,
            default: 2,
            min: 1.1,
            max: 10,
            description: 'Pᴀʏᴏᴜᴛ Mᴜʟᴛ𝙸ᴘʟ𝙸ᴇʀ (E.ɢ., 2 = 2x Bᴇᴛ)'
        },
        enabled: {
            type: Boolean,
            default: true,
            description: 'Wʜᴇᴛʜᴇʀ Tʜᴇ Gᴀᴍᴇ 𝙸ꜱ Eɴᴀʙʟᴇᴅ'
        }
    },

    // ============================================================
    // ✈️ Aᴠ𝙸ᴀᴛᴏʀ Sᴇᴛᴛ𝙸ɴɢꜱ
    // ============================================================
    aviator: {
        winChance: {
            type: Number,
            default: 40,
            min: 0,
            max: 100,
            description: 'W𝙸ɴɴ𝙸ɴɢ Cʜᴀɴᴄᴇ 𝙸ɴ Pᴇʀᴄᴇɴᴛᴀɢᴇ (0-100)'
        },
        minBet: {
            type: Number,
            default: 5,
            min: 1,
            description: 'M𝙸ɴ𝙸ᴍᴜᴍ Bᴇᴛ Aᴍᴏᴜɴᴛ 𝙸ɴ Rᴜᴘᴇᴇꜱ'
        },
        maxBet: {
            type: Number,
            default: 10000,
            min: 1,
            description: 'Mᴀx𝙸ᴍᴜᴍ Bᴇᴛ Aᴍᴏᴜɴᴛ 𝙸ɴ Rᴜᴘᴇᴇꜱ'
        },
        maxMultiplier: {
            type: Number,
            default: 10,
            min: 1.1,
            max: 100,
            description: 'Mᴀx𝙸ᴍᴜᴍ Aʟʟᴏᴡᴇᴅ Cᴀꜱʜᴏᴜᴛ Mᴜʟᴛ𝙸ᴘʟ𝙸ᴇʀ'
        },
        crashSpeed: {
            type: Number,
            default: 0.07,
            min: 0.01,
            max: 0.5,
            description: 'Sᴘᴇᴇᴅ Oꜰ Mᴜʟᴛ𝙸ᴘʟ𝙸ᴇʀ 𝙸ɴᴄʀᴇᴀꜱᴇ'
        },
        enabled: {
            type: Boolean,
            default: true,
            description: 'Wʜᴇᴛʜᴇʀ Tʜᴇ Gᴀᴍᴇ 𝙸ꜱ Eɴᴀʙʟᴇᴅ'
        }
    },

    // ============================================================
    // 🔧 Gʟᴏʙᴀʟ Sᴇᴛᴛ𝙸ɴɢꜱ (Fᴏʀ Bᴀᴄᴋᴡᴀʀᴅ Cᴏᴍᴘᴀᴛ𝙸ʙ𝙸ʟ𝙸ᴛʏ)
    // ============================================================
    global: {
        minBet: {
            type: Number,
            default: 5,
            min: 1,
            description: 'Gʟᴏʙᴀʟ M𝙸ɴ𝙸ᴍᴜᴍ Bᴇᴛ (Uꜱᴇᴅ Aꜱ Fᴀʟʟʙᴀᴄᴋ)'
        },
        maxBet: {
            type: Number,
            default: 10000,
            min: 1,
            description: 'Gʟᴏʙᴀʟ Mᴀx𝙸ᴍᴜᴍ Bᴇᴛ (Uꜱᴇᴅ Aꜱ Fᴀʟʟʙᴀᴄᴋ)'
        },
        payoutMultiplier: {
            type: Number,
            default: 2,
            min: 1.1,
            max: 10,
            description: 'Gʟᴏʙᴀʟ Pᴀʏᴏᴜᴛ Mᴜʟᴛ𝙸ᴘʟ𝙸ᴇʀ (Uꜱᴇᴅ Aꜱ Fᴀʟʟʙᴀᴄᴋ)'
        },
        defaultWinChance: {
            type: Number,
            default: 50,
            min: 0,
            max: 100,
            description: 'Gʟᴏʙᴀʟ Dᴇꜰᴀᴜʟᴛ W𝙸ɴ Cʜᴀɴᴄᴇ (Uꜱᴇᴅ Aꜱ Fᴀʟʟʙᴀᴄᴋ)'
        }
    },

    // ============================================================
    // 📊 L𝙸ᴠᴇ Fᴇᴇᴅ Sᴇᴛᴛ𝙸ɴɢꜱ
    // ============================================================
    liveFeed: {
        maxItems: {
            type: Number,
            default: 50,
            min: 10,
            max: 200,
            description: 'Mᴀx𝙸ᴍᴜᴍ 𝙸ᴛᴇᴍꜱ 𝙸ɴ L𝙸ᴠᴇ Fᴇᴇᴅ'
        },
        refreshInterval: {
            type: Number,
            default: 10000,
            min: 3000,
            max: 60000,
            description: 'Rᴇꜰʀᴇꜱʜ 𝙸ɴᴛᴇʀᴠᴀʟ 𝙸ɴ M𝙸ʟʟ𝙸ꜱᴇᴄᴏɴᴅꜱ'
        },
        showAllUsers: {
            type: Boolean,
            default: true,
            description: 'Sʜᴏᴡ Aʟʟ Uꜱᴇʀꜱ Oʀ Oɴʟʏ Aᴄᴛ𝙸ᴠᴇ Oɴᴇꜱ'
        }
    },

    // ============================================================
    // 🔒 Mᴀ𝙸ɴᴛᴇɴᴀɴᴄᴇ Sᴇᴛᴛ𝙸ɴɢꜱ
    // ============================================================
    maintenance: {
        mode: {
            type: Boolean,
            default: false,
            description: 'Mᴀ𝙸ɴᴛᴇɴᴀɴᴄᴇ Mᴏᴅᴇ - Aʟʟ Gᴀᴍᴇꜱ D𝙸ꜱᴀʙʟᴇᴅ'
        },
        message: {
            type: String,
            default: 'Gᴀᴍᴇꜱ Aʀᴇ Uɴᴅᴇʀ Mᴀ𝙸ɴᴛᴇɴᴀɴᴄᴇ. Pʟᴇᴀꜱᴇ Cʜᴇᴄᴋ Bᴀᴄᴋ Lᴀᴛᴇʀ.',
            description: 'Mᴇꜱꜱᴀɢᴇ Sʜᴏᴡɴ Dᴜʀ𝙸ɴɢ Mᴀ𝙸ɴᴛᴇɴᴀɴᴄᴇ'
        }
    },

    // ============================================================
    // 📝 Mᴇᴛᴀᴅᴀᴛᴀ
    // ============================================================
    updatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        description: 'Lᴀꜱᴛ Uꜱᴇʀ Wʜᴏ Uᴘᴅᴀᴛᴇᴅ Sᴇᴛᴛ𝙸ɴɢꜱ'
    },
    version: {
        type: Number,
        default: 1,
        description: 'Sᴇᴛᴛ𝙸ɴɢꜱ Vᴇʀꜱ𝙸ᴏɴ Fᴏʀ Tʀᴀᴄᴋ𝙸ɴɢ Cʜᴀɴɢᴇꜱ'
    }
}, {
    timestamps: true,
    collection: 'gamesettings'
});

// ============================================================
// 🔍 𝙸ɴᴅᴇxᴇꜱ
// ============================================================
GameSettingsSchema.index({ updatedAt: -1 });
GameSettingsSchema.index({ 'coinFlip.enabled': 1 });
GameSettingsSchema.index({ 'redGreen.enabled': 1 });
GameSettingsSchema.index({ 'aviator.enabled': 1 });

// ============================================================
// 📌 Sᴛᴀᴛ𝙸ᴄ Mᴇᴛʜᴏᴅꜱ
// ============================================================

// Gᴇᴛ S𝙸ɴɢʟᴇ Sᴇᴛᴛ𝙸ɴɢꜱ Dᴏᴄᴜᴍᴇɴᴛ (Oɴʟʏ Oɴᴇ Sʜᴏᴜʟᴅ Ex𝙸ꜱᴛ)
GameSettingsSchema.statics.getSettings = async function() {
    let settings = await this.findOne();
    if (!settings) {
        settings = new this();
        await settings.save();
    }
    return settings;
};

// Gᴇᴛ Sᴇᴛᴛ𝙸ɴɢꜱ Fᴏʀ A Sᴘᴇᴄ𝙸ꜰ𝙸ᴄ Gᴀᴍᴇ
GameSettingsSchema.statics.getGameSettings = async function(gameName) {
    const settings = await this.getSettings();
    const gameMap = {
        'coinflip': 'coinFlip',
        'redgreen': 'redGreen',
        'aviator': 'aviator'
    };
    
    const gameKey = gameMap[gameName.toLowerCase()];
    if (!gameKey || !settings[gameKey]) {
        return null;
    }
    
    return {
        ...settings[gameKey].toObject(),
        global: settings.global
    };
};

// Cʜᴇᴄᴋ 𝙸ꜰ A Gᴀᴍᴇ 𝙸ꜱ Eɴᴀʙʟᴇᴅ
GameSettingsSchema.statics.isGameEnabled = async function(gameName) {
    const settings = await this.getSettings();
    const gameMap = {
        'coinflip': 'coinFlip',
        'redgreen': 'redGreen',
        'aviator': 'aviator'
    };
    
    const gameKey = gameMap[gameName.toLowerCase()];
    if (!gameKey || !settings[gameKey]) {
        return false;
    }
    
    return settings[gameKey].enabled && !settings.maintenance.mode;
};

// Gᴇᴛ Aʟʟ Eɴᴀʙʟᴇᴅ Gᴀᴍᴇꜱ
GameSettingsSchema.statics.getEnabledGames = async function() {
    const settings = await this.getSettings();
    const enabled = [];
    
    if (settings.coinFlip.enabled && !settings.maintenance.mode) {
        enabled.push('coinflip');
    }
    if (settings.redGreen.enabled && !settings.maintenance.mode) {
        enabled.push('redgreen');
    }
    if (settings.aviator.enabled && !settings.maintenance.mode) {
        enabled.push('aviator');
    }
    
    return enabled;
};

// ============================================================
// 📌 𝙸ɴꜱᴛᴀɴᴄᴇ Mᴇᴛʜᴏᴅꜱ
// ============================================================

// Gᴇᴛ Vᴀʟ𝙸ᴅ M𝙸ɴ Bᴇᴛ Fᴏʀ A Gᴀᴍᴇ
GameSettingsSchema.methods.getMinBet = function(gameName) {
    const gameMap = {
        'coinflip': 'coinFlip',
        'redgreen': 'redGreen',
        'aviator': 'aviator'
    };
    
    const gameKey = gameMap[gameName.toLowerCase()];
    if (gameKey && this[gameKey]) {
        return this[gameKey].minBet || this.global.minBet || 5;
    }
    return this.global.minBet || 5;
};

// Gᴇᴛ Vᴀʟ𝙸ᴅ Mᴀx Bᴇᴛ Fᴏʀ A Gᴀᴍᴇ
GameSettingsSchema.methods.getMaxBet = function(gameName) {
    const gameMap = {
        'coinflip': 'coinFlip',
        'redgreen': 'redGreen',
        'aviator': 'aviator'
    };
    
    const gameKey = gameMap[gameName.toLowerCase()];
    if (gameKey && this[gameKey]) {
        return this[gameKey].maxBet || this.global.maxBet || 10000;
    }
    return this.global.maxBet || 10000;
};

// Gᴇᴛ Pᴀʏᴏᴜᴛ Mᴜʟᴛ𝙸ᴘʟ𝙸ᴇʀ Fᴏʀ A Gᴀᴍᴇ
GameSettingsSchema.methods.getPayout = function(gameName) {
    const gameMap = {
        'coinflip': 'coinFlip',
        'redgreen': 'redGreen'
    };
    
    const gameKey = gameMap[gameName.toLowerCase()];
    if (gameKey && this[gameKey]) {
        return this[gameKey].payout || this.global.payoutMultiplier || 2;
    }
    return this.global.payoutMultiplier || 2;
};

// Gᴇᴛ W𝙸ɴ Cʜᴀɴᴄᴇ Fᴏʀ A Gᴀᴍᴇ
GameSettingsSchema.methods.getWinChance = function(gameName) {
    const gameMap = {
        'coinflip': 'coinFlip',
        'redgreen': 'redGreen',
        'aviator': 'aviator'
    };
    
    const gameKey = gameMap[gameName.toLowerCase()];
    if (gameKey && this[gameKey]) {
        return this[gameKey].winChance || this.global.defaultWinChance || 50;
    }
    return this.global.defaultWinChance || 50;
};

// ============================================================
// 📌 V𝙸ʀᴛᴜᴀʟꜱ
// ============================================================

// Gᴇᴛ Tᴏᴛᴀʟ Nᴜᴍʙᴇʀ Oꜰ Eɴᴀʙʟᴇᴅ Gᴀᴍᴇꜱ
GameSettingsSchema.virtual('enabledGamesCount').get(function() {
    let count = 0;
    if (this.coinFlip.enabled) count++;
    if (this.redGreen.enabled) count++;
    if (this.aviator.enabled) count++;
    return count;
});

// Cʜᴇᴄᴋ 𝙸ꜰ Aɴʏ Gᴀᴍᴇ 𝙸ꜱ Eɴᴀʙʟᴇᴅ
GameSettingsSchema.virtual('hasEnabledGames').get(function() {
    return this.coinFlip.enabled || this.redGreen.enabled || this.aviator.enabled;
});

// Gᴇᴛ L𝙸ꜱᴛ Oꜰ Eɴᴀʙʟᴇᴅ Gᴀᴍᴇ Nᴀᴍᴇꜱ
GameSettingsSchema.virtual('enabledGameNames').get(function() {
    const names = [];
    if (this.coinFlip.enabled) names.push('Coin Flip');
    if (this.redGreen.enabled) names.push('Red/Green');
    if (this.aviator.enabled) names.push('Aviator');
    return names;
});

// ============================================================
// 📌 M𝙸ᴅᴅʟᴇᴡᴀʀᴇ
// ============================================================

// Aᴜᴛᴏ-𝙸ɴᴄʀᴇᴍᴇɴᴛ Vᴇʀꜱ𝙸ᴏɴ Oɴ Uᴘᴅᴀᴛᴇ
GameSettingsSchema.pre('save', function(next) {
    if (this.isModified()) {
        this.version += 1;
    }
    next();
});

// ============================================================
// 🔧 Tᴏ Jꜱᴏɴ Tʀᴀɴꜱꜰᴏʀᴍ
// ============================================================
GameSettingsSchema.set('toJSON', {
    virtuals: true,
    transform: function(doc, ret) {
        delete ret.__v;
        delete ret._id;
        return ret;
    }
});

// ============================================================
// 📦 Exᴘᴏʀᴛ
// ============================================================
const GameSettings = mongoose.model('GameSettings', GameSettingsSchema);
module.exports = GameSettings;
