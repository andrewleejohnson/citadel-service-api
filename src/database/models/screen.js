import mongoose from 'mongoose';

const ScreenSchema = new mongoose.Schema({
    name: String,
    searchToken: String,
    deviceModel: String,
    remoteName: String,
    systemUUID: String,
    created: { type: Date, default: Date.now },
    lastPing: { type: Date, default: Date.now },
    pin: String,
    ip: String,
    limits: [{
        type: { type: String },
        value: mongoose.Schema.Types.Mixed
    }],
    config: [{
        type: { type: String },
        value: mongoose.Schema.Types.Mixed
    }],
    location: {
        history: [{
            when: Date,
            latitude: Number,
            longitude: Number,
            summary: String,
        }],
        valid: Boolean,
        lastUpdate: Date
    },
    notes: String,
    status: {
        type: String,
        enum: ['pending', 'offline', 'online', 'n/a']
    },
    type: {
        type: String,
        enum: ['user', 'showcase']
    },
    version: String,
    channels: [{ type: mongoose.Schema.Types.ObjectId, ref: 'channel' }],
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: 'tag' }],
    usersWithAccess: [{ type: mongoose.Schema.Types.ObjectId, ref: 'user' }],
    deleted: Date
});

module.exports = mongoose.model("screen", ScreenSchema);