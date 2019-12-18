import winston from "winston";
import expressWinston from 'express-winston';
import winstonRotate from 'winston-daily-rotate-file';

import * as fs from "fs";

const CONSOLE_FORMAT = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp(),
    winston.format.align(),
    winston.format.printf((info) => {
        let {
            timestamp, level, message, ...args
        } = info;

        if (typeof message === 'object') {
            message = JSON.stringify(message, null, 2);
        }
        const ts = timestamp.slice(0, 19).replace('T', ' ');
        return `${ts} [${level}]: ${message}`;
    }),
);

const FILE_FORMAT = winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
);

const OPTIONS = {
    file: {
        filename: "logs/application-%DATE%.log",
        datePattern: "YYYY-MM-DD-HH",
        zippedArchive: true,
        maxSize: "20m",
        maxFiles: "30d",
        level: "silly",
        handleExceptions: true,
        json: true,
        colorize: false,
        timestamp: true,
        format: FILE_FORMAT
    },
    console: {
        level: "debug",
        handleExceptions: true,
        json: true,
        colorize: true,
        timestamp: true,
        format: CONSOLE_FORMAT
    },
    express: {
        format: CONSOLE_FORMAT,
        meta: false,
        msg: "HTTP {{req.method}} {{req.url}}",
        expressFormat: true,
        colorize: true,
        timestamp: true,
        ignoreRoute: (req, res) => { return false; }
    }
};

fs.mkdir("./logs", (err) => { /* no-op */ })

const LOGGER = winston.createLogger({
    transports: [
        new winston.transports.DailyRotateFile(OPTIONS.file),
        new winston.transports.Console(OPTIONS.console)
    ],
    exitOnError: false
});

module.exports = {
    getExpressLogger: () => {
        return expressWinston.logger({
            transports: [
                new winston.transports.Console()
            ],
            ...OPTIONS.express
        });
    },

    stream: {
        write: (message, encoding) => {
            LOGGER.info(message);
        },
    },

    error: (message, args) => {
        LOGGER.error(message, args)
    },

    warn: (message, args) => {
        LOGGER.warn(message, args);
    },

    info: (message, args) => {
        LOGGER.info(message, args);
    },

    verbose: (message, args) => {
        LOGGER.verbose(message, args);
    },

    debug: (message, args) => {
        LOGGER.debug(message, args);
    },

    silly: (message, args) => {
        LOGGER.silly(message, args);
    }
}
