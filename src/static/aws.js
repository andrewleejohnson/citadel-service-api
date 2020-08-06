import * as aws from 'aws-sdk';
import config from '../config';
import logger from '../logger';

aws.config.update({
    region: config.aws.region
});

const S3_INSTANCE = new aws.S3({
    accessKeyId: config.aws.authentication.access,
    secretAccessKey: config.aws.authentication.secret,
});

module.exports = {
    uploadResource: (data, path) => {
        logger.debug(`Uploading buffer to AWS S3 at ${path}`);

        const upload = {
            ACL: "public-read",
            StorageClass: "STANDARD",
            Key: path,
            Body: data,
            ContentType: 'application/octet-stream',
            Bucket: config.aws.s3.bucket,
            Metadata: {
                'Content-Disposition': 'attachment',
            },
        };

        return new Promise((resolve, reject) => {
            S3_INSTANCE.upload(upload, (err, response) => {
                if (err) {
                    logger.error(`Error occurred uploading S3 resource - ${err}`);
                    reject(err);
                    return;
                }

                logger.debug(`Completed S3 upload to ${path}!`);
                resolve(response);
            });
        });
    }
}