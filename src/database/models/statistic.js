import mongoose from "mongoose";

const StatisticSchema = new mongoose.Schema({
    screen: { type: mongoose.Schema.Types.ObjectId, ref: 'screen', index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    when: { type: Date, default: Date.now, index: true },
    
    // potential indexable statistic values
    file: { type: mongoose.Schema.Types.ObjectId, ref: 'file', index: true },
    playlist: { type: mongoose.Schema.Types.ObjectId, ref: 'playlist', index: true },
    channel: { type: mongoose.Schema.Types.ObjectId, ref: 'channel', index: true }
});

export default mongoose.model("statistic", StatisticSchema);