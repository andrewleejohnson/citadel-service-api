import mongoose from "mongoose";

const ChannelSchema = new mongoose.Schema({
    name: String,
    searchToken: String,
    created: { type: Date, default: Date.now },
    slots: [{
        type: {
            type: String,
            enum: ['video', 'playlist', 'file', 'ad']
        },
        resource: { type: mongoose.Schema.Types.ObjectId }
    }],
    timedSlots: [{
        type: {
            type: String,
            enum: ['video', 'playlist', 'file', 'ad']
        },
        resource: { type: mongoose.Schema.Types.ObjectId },
        time: String
    }],
    type: {
        type: String,
        enum: ['user', 'system']
    },
    notes: String,
    thumbnail: { type: mongoose.Schema.Types.ObjectId, ref: 'file' },
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: 'tag' }],
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    usersWithAccess: [{ type: mongoose.Schema.Types.ObjectId, ref: 'user' }],
    deleted: Date
});

export default (connection) => connection.model("channel", ChannelSchema);