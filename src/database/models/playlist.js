import mongoose from "mongoose";

const PlaylistSchema = new mongoose.Schema({
    // meta
    name: String,
    searchToken: String,
    created: { type: Date, default: Date.now },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    usersWithAccess: [{ type: mongoose.Schema.Types.ObjectId, ref: 'user' }],
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: 'tag' }],
    notes: String,
    deleted: Date,

    // playback
    type: { type: String, enum: ['user', 'system'] },
    videos: [{ type: mongoose.Schema.Types.ObjectId, ref: 'file' }],
    duration: Number,

    playbackMethod: {
        type: String,
        enum: ['sequential', 'shuffle', 'weighted']
    },

    weights: [{
        video: { type: mongoose.Schema.Types.ObjectId, ref: 'file' },
        weight: Number
    }]
});

export default (connection) => connection.model("playlist", PlaylistSchema);