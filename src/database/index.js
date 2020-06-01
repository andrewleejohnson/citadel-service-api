import mongoose from "mongoose";
import fs from "fs";

import logger from "../logger";
import config from "../config.json";

module.exports = {
    getConnectionToDatabase: async (callback) => {
        let queryParamString = `${Object.keys(config.database.params).map(key => `${key}=${config.database.params[key]}`).join('&')}`;
        let mongoDB = `mongodb://${config.database.username}:${config.database.password}@${config.database.host}:${config.database.port}/${config.database.table}?${queryParamString}`;
        let dbConnection;
        let connected = false;
        logger.debug(`Attempting to connect to database (${config.database.username}@${config.database.host}:${config.database.port}/${config.database.table})...`);

        do {
            try {

                mongoose.set('useFindAndModify', false);
                mongoose.set('useCreateIndex', true);

                let connectionConfig = {
                    useNewUrlParser: true,
                    useUnifiedTopology: false
                };

                if (config.database.params && config.database.params['ssl']) {
                    connectionConfig['sslCA'] = fs.readFileSync(config.database.params['ssl_ca_certs'])
                }

                await mongoose.connect(mongoDB, connectionConfig);
                mongoose.Promise = global.Promise;
                dbConnection = mongoose.connection;

                connected = true;
            } catch (e) {
                logger.warn(`Could not connect to database (${config.database.username}@${config.database.host}:${config.database.port}/${config.database.table}) (error - ${e.toString()}) retrying...`);
                logger.warn(`Connection string: ${mongoDB}`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        } while (!connected);

        logger.debug(`Successfully connected to database (${config.database.username}@${config.database.host}:${config.database.port}/${config.database.table})`);
        callback(dbConnection);
    }
};