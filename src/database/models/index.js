import ScreenModel from "./screen";
import PlaylistModel from "./playlist";
import ChannelModel from "./channel";
import StatisticModel from "./statistic";
import FileModel from "./file"

const MODEL_POOL = {};

function getModelForContext(model, type, context) {
    let poolKey = `${context}/${type}`;

    if (!MODEL_POOL[poolKey]) {
        // some bug in babel requires this instead of normal import
        MODEL_POOL[poolKey] = model(require('../').getSubConnectionToDatabase(context));
    }
    return MODEL_POOL[poolKey];
}

export const Screen = (context) => getModelForContext(ScreenModel, "screen", context);
export const Statistic = (context) => getModelForContext(StatisticModel, "statistic", context);
export const Playlist = (context) => getModelForContext(PlaylistModel, "playlist", context);
export const Channel = (context) => getModelForContext(ChannelModel, "channel", context);
export const File = (context) => getModelForContext(FileModel, "file", context);
