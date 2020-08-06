import { Router } from 'express';

import { version } from '../../package.json';
import reports from './reports';
import rendering from './rendering';

export default ({ config, db }) => {
    let router = Router();

    router.get('/status', async (req, res) => {
        res.send('OK');
    });

    router.get('/meta', async (req, res) => {
        res.json({ version: version });
    });

    router.use('/report', reports({ config, db }));
    router.use('/rendering', rendering({ config, db }));

    return router;
}
