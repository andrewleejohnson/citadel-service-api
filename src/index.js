const crypto = require('crypto');

const database = require('./database');
const reports = require('./reports');

import http from 'http';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

import logger from "./logger";
import { getRootConnectionToDatabase } from './database';
import api from "./api";

import config from './config';

getRootConnectionToDatabase(db => {
    let app = express();
    app.server = http.createServer(app);
    app.use(cors({ exposedHeaders: config.corsHeaders }));
    app.use(bodyParser.json({ limit: config.bodyLimit }));

    app.use('/', api({ config, db })); // new

    app.set('port', (process.env.PORT || config.port));

    app.server.listen(app.get('port'), '0.0.0.0', () => {
        logger.info(`Started web server on port ${app.server.address().port}`);
    });
});