import { Router } from 'express';
import crypto from 'crypto';
import atob from 'atob';

import reports from '../../reports';

const REPORT_ERRORS = {};
const REPORT_STATUS = {};

export default ({ config, db }) => {
    let router = Router();

    // report generation management
    router.get('/', async (req, res) => {
        let url = req.query['url'];

        if (!url) {
            res.sendStatus(400);
            return;
        }
        
        let decodedUrl = atob(url);

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

    router.post('/', async (req, res) => {
        let { user, filter, databaseContext, exportConfig } = req.body;

        let randomKey = crypto.randomBytes(4).toString('hex');
        let key = `Citadel Report (${randomKey}) - ${new Date().toLocaleDateString().replace(/\//g, '-')}.${exportConfig.format.value}`;
        let url = `${config.aws.cloudfront.root}${key}`;

        REPORT_STATUS[url] = 'running';

        reports.generateReport({
            user: user,
            databaseContext: databaseContext,
            filter: filter,
            exportConfig: exportConfig,
            uploadKey: key,
            url: url
        }).then(() => {
            REPORT_STATUS[url] = 'complete';
        }).catch(err => {
            REPORT_ERRORS[url] = err.toString();
        });

        res.send({ status: 'ok', url: url });
    });

    return router;
}
