import mongoose from 'mongoose';

const FileSchema = new mongoose.Schema({
    created: { type: Date, default: Date.now },
    lastModified: Date,
    name: String,
    size: Number,
    extension: String,
    cdnUrl: String,
    mimeType: String,
    meta: [{
        key: String,
        value: String,
        required: { type: Boolean, default: true },
        readOnly: { type: Boolean, default: true }
    }],
    parent: { type: mongoose.Schema.Types.ObjectId, ref: 'directory' },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    tags: [{ type: mongoose.Schema.Types.ObjectId, ref: 'tag' }],
    deleted: Date
});

module.exports = mongoose.model("file", FileSchema);