import mongoose from "mongoose";

const ScreenStatusSchema = new mongoose.Schema({
    screen: { type: mongoose.Schema.Types.ObjectId, ref: 'screen', index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'user' },
    when: { type: Date, default: Date.now, index: true },
    
    // potential indexable statistic values
    value: { type: String, index: true }
});

export default mongoose.model("screenstatus", ScreenStatusSchema);