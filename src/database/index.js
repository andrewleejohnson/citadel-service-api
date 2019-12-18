import mongoose from 'mongoose';
import config from '../config';

module.exports = {
    getConnectionToDatabase: () => {
        let connectionString = `mongodb://${config.database.username}:${config.database.password}@${config.database.host}:${config.database.port}/${config.database.table}?authSource=${config.database.authSource}`;


        mongoose.set('useFindAndModify', false);
        mongoose.set('useCreateIndex', true);

        mongoose.connect(connectionString, { useNewUrlParser: true });
        mongoose.Promise = global.Promise;
        return mongoose.connection;
    }
};