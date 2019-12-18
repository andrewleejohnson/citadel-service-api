import mongoose from 'mongoose';
import logger from '../logger';
import config from '../config';

module.exports = {
    getConnectionToDatabase: async (callback) => {
        let mongoDB = `mongodb://${config.database.username}:${config.database.password}@${config.database.host}:${config.database.port}/${config.database.table}?authSource=${config.database.authSource}`;
        let dbConnection;
        let connected = false;
        do {
            try {
    
                mongoose.set('useFindAndModify', false);
                mongoose.set('useCreateIndex', true);
    
                mongoose.connect(mongoDB, { useNewUrlParser: true });
                mongoose.Promise = global.Promise;
                dbConnection = mongoose.connection;
    
                connected = true;
            } catch (e) {
                logger.warn(`Could not connect to database (${config.database.username}@${config.database.host}:${config.database.port}/${config.database.table}) retrying...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        } while (!connected);
    
        logger.info(`Successfully connected to database (${config.database.username}@${config.database.host}:${config.database.port}/${config.database.table})`);
        callback(dbConnection);
    }
};