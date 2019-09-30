import * as winston from 'winston';

const {combine, timestamp, printf, simple, splat} = winston.format;

const myFormat = printf(info => `${info.timestamp} ${info.level}: ${info.message}`);

export const myLogger = winston.createLogger({
    level: 'debug',
    format: combine(
        splat(),
        simple(),
        timestamp(),
        myFormat
    ),
    transports: [
        new winston.transports.Console({})
    ]
});
