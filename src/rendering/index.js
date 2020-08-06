import nodeHtmlToImage from 'node-html-to-image';
import * as fs from 'fs';
import * as path from 'path';

let TEMPLATE_CONTENT;

module.exports = {
    loadTemplate: async () => {
        if (!TEMPLATE_CONTENT) {
            let templatePath = path.join(__dirname, 'template.html');
            TEMPLATE_CONTENT = fs.readFileSync(templatePath, { encoding: 'utf-8' });
        }
    },

    generateBrandingBackground: async () => {
        if (!TEMPLATE_CONTENT) {
            module.exports.loadTemplate();
        }

        const image = await nodeHtmlToImage({
            html: TEMPLATE_CONTENT,
            content: {
                brandingUrl: 'https://cleardigitalmedia.net/wp-content/uploads/2018/04/CDM_Logo_HorzWhite.png'
            }
        });

        return image;
    }
}