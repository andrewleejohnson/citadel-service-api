import { Router } from 'express';
import atob from 'atob';

import rendering from '../../rendering';

export default ({ config, db }) => {
    let router = Router();

    // report generation management
    router.get('/', async (req, res) => {
        let contentURL = req.query['content'];
        let channelID = req.query['channel'];
        let deploymentID = req.query['deployment'];

        /*
        if (!contentURL || !channelID || !deploymentID) {
            if (contentURL) {
                res.redirect(atob(contentURL));
            } else {
                res.sendStatus(400);
            }
            return;
        }
        */

        let decodedContentURL = atob(contentURL);

        const image = await rendering.generateBrandingBackground();

        res.contentType('image/png');
        res.end(image, 'binary');
    });

    // https://dfhfbbec6ju30.cloudfront.net/fs/user_5dc027085749d1443143a2c8/file_5dc03bae5749d1443143b030.default

    return router;
}
