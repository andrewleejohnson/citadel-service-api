import { Router } from 'express';
import crypto from 'crypto';
import atob from 'atob';

import { version } from '../../package.json';
import reports from '../reports';

const REPORT_ERRORS = {};
const REPORT_STATUS = {};

export default ({ config, db }) => {
    let router = Router();

    router.get('/status', async (req, res) => {
        res.send('OK');
    });

    router.get('/meta', async (req, res) => {
        res.json({ version: version });
    });

    router.get('/report', async (req, res) => {
        let url = req.query['url'];

        let decodedUrl = atob(url);

        console.log("Checking URL " + decodedUrl);

        if (!REPORT_STATUS[decodedUrl]) {
            res.json({ status: 'error', error: 'Reporting server overloaded - please try running a more specific report or contact support' });
        }
        else if (REPORT_ERRORS[decodedUrl]) {
            res.json({ status: 'error', error: REPORT_ERRORS[decodedUrl] });
        }
        else {
            res.json({ status: 'ok' });
        }
    });

    router.post('/report', async (req, res) => {
        let { user, filter, exportConfig } = req.body;

        let randomKey = crypto.randomBytes(4).toString('hex');
        let key = `Citadel Report (${randomKey}) - ${new Date().toLocaleDateString().replace(/\//g, '-')}.${exportConfig.format.value}`;
        let url = `${config.aws.cloudfront.root}${key}`;

        REPORT_STATUS[url] = 'running';

        reports.generateReport({
            user: user,
            filter: filter,
            exportConfig: exportConfig,
            uploadKey: key,
            url: url
        }).then(() => {
            REPORT_STATUS[url] = 'complete';
        }).catch(err => {
            console.log('Caught error for ' + url);
            REPORT_ERRORS[url] = err.toString();
        });

        res.send({ status: 'ok', url: url });
    });

    return router;
}
