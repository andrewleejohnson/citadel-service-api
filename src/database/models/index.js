import ScreenModel from "./screen";
import StatisticModel from "./statistic";

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
