import mongoose from 'mongoose';

const StatisticSchema = new mongoose.Schema({
    resource: {
        id: { type: mongoose.Schema.Types.ObjectId },
        type: { type: String }
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    type: { type: String },
    when: { type: Date, default: Date.now },
    value: String,
    assets: [{
        id: { type: mongoose.Schema.Types.ObjectId },
        type: { type: String },
        name: { type: String }
    }]
});

module.exports = mongoose.model("statistic", StatisticSchema);