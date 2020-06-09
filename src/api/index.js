import { Router } from 'express';
import crypto from 'crypto';

import { version } from '../../package.json';
import reports from '../reports';

export default ({ config, db }) => {
    let router = Router();

    router.get('/status', async (req, res) => {
        res.send('OK');
    });

    router.get('/meta', async (req, res) => {
        res.json({ version: version });
    });

    router.post('/report', async (req, res) => {
        let { user, filter, exportConfig } = req.body;

        let randomKey = crypto.randomBytes(4).toString('hex');
        let key = `Citadel Report (${randomKey}) - ${new Date().toLocaleDateString().replace(/\//g, '-')}.${exportConfig.format.value}`;
        let url = `${config.aws.cloudfront.root}${key}`;

        reports.generateReport({
            user: user,
            filter: filter,
            exportConfig: exportConfig,
            uploadKey: key
        });

        res.send({ status: 'ok', url: url });
    });

    return router;
}
