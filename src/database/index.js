import mongoose from "mongoose";
import fs from "fs";
import tunnel from "tunnel-ssh";

import logger from "../logger";
import config from "../config.json";

module.exports = {
    executeConnection: async (mongoDB, callback) => {
        let dbConnection;
        let connected = false;
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
    },

    getConnectionToDatabase: async (callback) => {
        let queryParamString = `${Object.keys(config.database.params).map(key => `${key}=${config.database.params[key]}`).join('&')}`;

        logger.debug(`Attempting to connect to database (${config.database.username}@${config.database.host}:${config.database.port}/${config.database.table})...`);

        if (config.database.sshTunnel && config.database.sshTunnel.enabled) {
            let sshConfig = {
                username: config.database.sshTunnel.username,
                host: config.database.sshTunnel.host,
                agent: process.env.SSH_AUTH_SOCK,
                privateKey: fs.readFileSync(config.database.sshTunnel.key),
                port: config.database.sshTunnel.port,
                dstHost: config.database.host,
                dstPort: config.database.port,
                localHost: config.database.sshTunnel.local.host,
                localPort: config.database.sshTunnel.local.port
            };

            tunnel(sshConfig, async (error) => {
                if (error) {
                    logger.error(`Unexpected error occurred creating SSH tunnel - ${error}`);
                    return;
                }

                let portString = `${config.database.sshTunnel.local.port ? ':' + config.database.sshTunnel.local.port : ''}`;
                let mongoDB = `${config.database.protocol}://${config.database.username}:${config.database.password}@${config.database.sshTunnel.local.host}${portString}/${config.database.table}?${queryParamString}`;
                module.exports.executeConnection(mongoDB, callback);
            });
        } else {
            let portString = `${config.database.port ? ':' + config.database.port : ''}`;
            let mongoDB = `${config.database.protocol}://${config.database.username}:${config.database.password}@${config.database.host}${portString}/${config.database.table}?${queryParamString}`;
            module.exports.executeConnection(mongoDB, callback);
        }
    }
};