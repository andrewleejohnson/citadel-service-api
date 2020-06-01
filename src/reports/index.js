import xlsx from 'xlsx';
import NodeCache from 'node-cache';
import csvStringify from 'csv-stringify/lib/sync';
import * as pdfLib from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import co from 'co';
import * as pdfLibDist from 'pdf-lib/dist/pdf-lib';
import moment from 'moment';

import logger from '../logger';
import aws from '../aws';
import Screen from '../database/models/screen';
import Statistic from '../database/models/statistic';
import File from '../database/models/file';
import { createResourceMutex } from '../util/mutex';

module.exports = {
    bundleReport: async ({ user, exportConfig, filter, keys, data, uploadKey }) => {
        return new Promise(async (resolve, reject) => {
            let output;

            const aoa = [keys, ...data.map(row => Object.keys(row).map(key => row[key]))];

            switch (exportConfig.format.value) {
                case "csv":
                    output = Buffer.from(csvStringify(data, {
                        delimiter: exportConfig.delimiter,
                        columns: keys,
                        header: exportConfig.generateHeaders
                    }), 'utf-8');
                    break;
                case "xlsx":
                    logger.debug('Creating XLSX file...');

                    const book = xlsx.utils.book_new();

                    const worksheet = xlsx.utils.aoa_to_sheet(aoa, { skipHeader: !exportConfig.generateHeaders });

                    xlsx.utils.book_append_sheet(book, worksheet, "Citadel Export");

                    output = xlsx.write(book, { type: 'buffer', bookType: 'xlsx', bookSST: false });
                    break;
                case "pdf":
                    let pdfDoc = await pdfLib.PDFDocument.create();

                    let page = pdfDoc.addPage();

                    const defaultFont = await pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);
                    const boldFont = await pdfDoc.embedFont(pdfLib.StandardFonts.HelveticaBold);

                    const imageUrl = path.join(__dirname, '..', 'images', 'cdm.png');
                    const imageBuffer = fs.readFileSync(imageUrl);
                    const embeddableImage = await pdfDoc.embedPng(imageBuffer);
                    const padding = 32;
                    const yPadding = 48;
                    const smallPadding = 4;
                    const imageScalingHeight = 64;
                    const imageScalingWidth = 128;
                    const reportPropertyLabelWidth = 120;
                    const defaultFontSize = 10;
                    const smallFontSize = 8;
                    const cellRightBufferSize = 8;

                    const colors = {
                        gray: pdfLib.rgb(215 / 256, 215 / 256, 215 / 256),
                        blue: pdfLib.rgb(0 / 256, 128 / 256, 214 / 256),
                        black: pdfLib.rgb(0, 0, 0),
                        white: pdfLib.rgb(1, 1, 1)
                    };

                    const maxHeightScale = Math.min(1, imageScalingHeight / embeddableImage.height);
                    const maxWidthScale = Math.min(1, imageScalingWidth / embeddableImage.width);
                    const requiredScale = Math.min(maxHeightScale, maxWidthScale);

                    const imageScaleDimensions = embeddableImage.scale(requiredScale);

                    let yWritingIndex = page.getHeight();

                    yWritingIndex -= yPadding;

                    page.drawImage(embeddableImage, {
                        x: page.getWidth() - imageScaleDimensions.width - padding,
                        y: yWritingIndex - (imageScaleDimensions.width / 2),
                        width: imageScaleDimensions.width,
                        height: imageScaleDimensions.height,
                    });

                    const writeProperty = (label, value) => {
                        const contentTextHeight = defaultFont.heightAtSize(defaultFontSize);

                        page.drawText(`${label}:`, {
                            x: padding,
                            y: yWritingIndex,
                            size: defaultFontSize,
                            font: boldFont,
                            maxWidth: reportPropertyLabelWidth,
                            color: colors.black,
                        });

                        page.drawText(value, {
                            x: padding + reportPropertyLabelWidth,
                            y: yWritingIndex,
                            size: defaultFontSize,
                            font: defaultFont,
                            color: colors.black,
                        });

                        yWritingIndex -= (contentTextHeight + smallPadding);
                    }

                    writeProperty('Report generated', new Date().toLocaleString());

                    if (filter.startTime && filter.endTime) {
                        writeProperty('Report results range', `${filter.startTime.toLocaleDateString()} - ${filter.endTime.toLocaleDateString()}`);
                    }

                    writeProperty('Report type', filter.type.value);

                    if (filter.primaryResource.hasOwnProperty('name') && filter.primaryResource.hasOwnProperty('value')) {
                        writeProperty('Report filtered by', `${filter.primaryResource.name} [${filter.primaryFilterType.value}]`);
                    }

                    writeProperty('User', user.email);
                    writeProperty('Records exported', `${data.length} records`);

                    yWritingIndex -= smallPadding;

                    page.drawLine({
                        start: { x: padding, y: yWritingIndex },
                        end: { x: page.getWidth() - padding, y: yWritingIndex },
                        thickness: 1,
                        color: colors.gray
                    });

                    yWritingIndex -= padding;

                    const buildRow = (array, font, size, header) => {
                        const rowWidth = page.getWidth() - (padding * 2);
                        const contentTextHeight = font.heightAtSize(size);
                        const leadCellWidth = Math.round(rowWidth / array.length) * 1.75;
                        const defaultCellWidth = Math.round((rowWidth - leadCellWidth) / (array.length - 1));

                        let xWritingIndex = padding;

                        const buildCell = (value, i) => {
                            let cellWidth = (i === 0) ? leadCellWidth : defaultCellWidth;
                            if (!value) {
                                value = '---';
                            }

                            value = `${value}`;
                            const textWidth = (t) => font.widthOfTextAtSize(t, size);

                            const contentLines = pdfLibDist.breakTextIntoLines(value, [' '], cellWidth, textWidth);

                            value = (header) ? value : contentLines[0];

                            let widthOfValue = font.widthOfTextAtSize(value, size);

                            if (widthOfValue > (cellWidth - cellRightBufferSize)) {
                                do {
                                    value = value.substring(0, value.length - 1);
                                    widthOfValue = font.widthOfTextAtSize(value, size);
                                } while (widthOfValue > cellWidth - cellRightBufferSize);
                                value = `${value}...`;
                            }

                            page.drawText(value, {
                                x: xWritingIndex,
                                y: yWritingIndex,
                                size: size,
                                font: font,
                                maxWidth: cellWidth,
                                color: colors.black,
                            });

                            return cellWidth;
                        }

                        for (let i = 0; i < array.length; i++) {
                            let width = buildCell(array[i], i);

                            xWritingIndex += width;
                        }

                        yWritingIndex -= (contentTextHeight + smallPadding);

                        if (header) {
                            yWritingIndex -= smallPadding;
                        }
                    }

                    buildRow(aoa[0], boldFont, smallFontSize, true);

                    for (let i = 1; i < aoa.length; i++) {
                        buildRow(aoa[i], defaultFont, smallFontSize, false);

                        if (yWritingIndex <= yPadding) {
                            page = pdfDoc.addPage();
                            yWritingIndex = page.getHeight() - yPadding;
                            buildRow(aoa[0], boldFont, smallFontSize, true);
                        }
                    }

                    output = Buffer.from(await pdfDoc.save());
                    break;
            }

            aws.uploadResource(output, `reports/${uploadKey}`);
            resolve(true);
        });
    },

    generateReport: async ({ user, filter, exportConfig, uploadKey }) => {
        return new Promise(async (resolve, reject) => {
            const timezoneOffset = new Date().getTimezoneOffset();
            filter.startTime = new Date(new Date(filter.startTime).valueOf() + (timezoneOffset * 1000 * 60));
            filter.startTime.setHours(0, 0, 0, 0);
            filter.endTime = new Date(new Date(filter.endTime).valueOf() + (timezoneOffset * 1000 * 60));
            filter.endTime.setHours(23, 59, 59);

            let query;
            let stream;
            let count;
            let keys;

            switch (filter.type.value) {
                case "videos":
                case "plays":
                case "playstime":
                    query = {
                        when: {
                            $gte: filter.startTime,
                            $lte: filter.endTime
                        }
                    };

                    switch (filter.primaryFilterType.value) {
                        case "video":
                            query['file'] = mongoose.Types.ObjectId(filter.primaryResource._id);
                            break;
                        case "playlist":
                            query['playlist'] = mongoose.Types.ObjectId(filter.primaryResource._id);
                            break;
                        case "channel":
                            query['channel'] = mongoose.Types.ObjectId(filter.primaryResource._id);
                            break;
                        case "tag":
                            /*
                            switch (filter.type.value) {
                                case "videos":
                                case "plays":
                                    query['assets'] = { $elemMatch: { id: mongoose.Types.ObjectId(filter.primaryResource._id) } }
                                    break;
                            }
                            */
                            break;
                        case "screen":
                            // bypass
                            query['screen'] = mongoose.Types.ObjectId(filter.primaryResource._id);
                            break;
                    }

                    if (filter.secondaryFilterType && filter.secondaryFilterType.value) {
                        switch (filter.secondaryFilterType.value) {
                            case "video":
                                query['file'] = mongoose.Types.ObjectId(filter.secondaryResource._id);
                                break;
                            case "playlist":
                                query['playlist'] = mongoose.Types.ObjectId(filter.secondaryResource._id);
                                break;
                            case "channel":
                                query['channel'] = mongoose.Types.ObjectId(filter.secondaryResource._id);
                                break;
                            case "tag":
                                /*
                                switch (filter.type.value) {
                                    case "videos":
                                    case "plays":
                                        query['assets'] = { $elemMatch: { id: mongoose.Types.ObjectId(filter.primaryResource._id) } }
                                        break;
                                }
                                */
                                break;
                            case "screen":
                                // bypass
                                query['screen'] = mongoose.Types.ObjectId(filter.secondaryResource._id);
                                break;
                        }
                    }

                    // stream = Statistic.find(query).lean().cursor({ batchSize: 1500 });
                    break;
                case "screens":
                    query = { deleted: { $exists: false } };

                    switch (filter.primaryFilterType.value) {
                        case "status":
                            query['status'] = filter.primaryResource.name;
                            break;
                        case "channel":
                            query['channels'] = mongoose.Types.ObjectId(filter.primaryResource._id);
                            break;
                        case "tag":
                            query['tags'] = mongoose.Types.ObjectId(filter.primaryResource._id);
                            break;
                    }

                    stream = Screen.find(query).lean().cursor();
                    break;
            }

            const data = [];
            let results;
            const objectCache = new NodeCache({ stdTTL: 0, checkperiod: 300, useClones: false });

            logger.debug(`Processing aggregate batch...`);

            let resourceMutex = createResourceMutex();

            switch (filter.type.value) {
                case "videos":

                    results = await Statistic.aggregate([
                        {
                            $match: query
                        },
                        {
                            $lookup: {
                                from: "files",
                                localField: "file",
                                foreignField: "_id",
                                as: "files"
                            }
                        },
                        {
                            $project: {
                                file: {
                                    $arrayElemAt: ["$files", 0]
                                }
                            }
                        },
                        {
                            $group: {
                                _id: "$file._id",
                                count: {
                                    $sum: 1.0
                                },
                                name: {
                                    $first: "$file.name"
                                },
                                size: {
                                    $first: "$file.size"
                                },
                                meta: {
                                    $first: "$file.meta"
                                }
                            }
                        }
                    ]);

                    for (const row of results) {
                        const duration = row.meta.find(meta => meta.key === 'duration');

                        data.push({
                            ["Video Name"]: row.name,
                            ["File Size (bytes)"]: row.size,
                            ["Duration (seconds)"]: Math.round(duration.value),
                            ["Plays"]: Math.floor(row.count)
                        });
                    }

                    logger.debug('Completed post processing of batch');

                    keys = data[0] ? Object.keys(data[0]) : [];
                    resolve(await module.exports.bundleReport({ user, exportConfig, filter, data, keys, uploadKey }));
                    break;
                case "plays":
                    results = await Statistic.aggregate([
                        {
                            $match: query
                        },
                        {
                            $lookup: {
                                from: "files",
                                localField: "file",
                                foreignField: "_id",
                                as: "files"
                            }
                        },
                        {
                            $lookup: {
                                from: "screens",
                                localField: "screen",
                                foreignField: "_id",
                                as: "screens"
                            }
                        },
                        {
                            $project: {
                                _id: "$_id",
                                file: {
                                    $arrayElemAt: [
                                        "$files",
                                        0.0
                                    ]
                                },
                                screen: {
                                    $arrayElemAt: [
                                        "$screens",
                                        0.0
                                    ]
                                },
                                when: "$when"
                            }
                        },
                        {
                            $project: {
                                _id: "$_id",
                                when: "$when",
                                file: {
                                    name: "$file.name",
                                    size: "$file.size",
                                    meta: "$file.meta"
                                },
                                screen: {
                                    name: "$screen.name",
                                    deviceModel: "$screen.deviceModel",
                                    ip: "$screen.ip",
                                    searchToken: "$screen.searchToken"
                                }
                            }
                        }
                    ]);

                    for (const row of results) {
                        const duration = row.file.meta.find(meta => meta.key === 'duration');
                        const m = moment(row.when).subtract(filter.tzOffset, 'minute');
                        
                        let entry = {
                            ["Last Played"]: m.format('l hh:mm A'),
                            ["Video Name"]: row.file.name,
                            ["Duration (seconds)"]: Math.round(duration.value),
                            ["Screen Name"]: row.screen.name,
                            ["Screen Model"]: row.screen.deviceModel,
                            ["Screen IP"]: row.screen.ip,
                            ["File Size (bytes)"]: row.file.size
                        };

                        if (exportConfig.exportInternalIDs && exportConfig.format.value !== "pdf") {
                            entry["Statistic ID"] = row._id.toString();
                            entry["Screen ID"] = row.screen.searchToken;
                        }

                        data.push(entry);
                    }

                    logger.debug('Completed post processing of batch');

                    keys = data[0] ? Object.keys(data[0]) : [];
                    resolve(await module.exports.bundleReport({ user, exportConfig, filter, keys, data, uploadKey }));
                    break;
                case "screens":
                    await stream.eachAsync(async (screen) => {
                        position++;

                        const row = {
                            ["Screen Name"]: screen.name,
                            ["Status"]: screen.status,
                            ["Device Model"]: screen.deviceModel,
                            ["Version"]: screen.version,
                            ["Location"]: (screen.location && screen.location.valid) ? screen.location.history[screen.location.history.length - 1].summary : null,
                            ["PIN"]: screen.pin,
                        };

                        if (exportConfig.exportInternalIDs && exportConfig.format.value !== "pdf") {
                            row["Screen ID"] = screen.searchToken;
                            row["Last Played"] = '';
                            if (screen.issues && screen.issues.length > 0) {

                                let notPlayingIssue = screen.issues.find(issue => issue.type === 'notplaying');
                                // resolve playback issues if relevant

                                if (notPlayingIssue) {
                                    const from = (new Date(notPlayingIssue.when)).valueOf();
                                    const to = Date.now();
                                    const number_days = Math.round((to - from) / (1000 * 60 * 60 * 24));
                                    row["Last Played"] = `${number_days} days ago`;
                                }
                            }
                        }

                        data.push(row);
                    });

                    logger.debug('Completed post processing of batch');

                    keys = data[0] ? Object.keys(data[0]) : [];
                    resolve(await module.exports.bundleReport({ user, exportConfig, filter, keys, data, uploadKey }));
                    break;
                case "playstime":
                    keys = ['Screen Name'];
                    for (let date = filter.startTime; date < filter.endTime; date = new Date(date.valueOf() + 1000 * 60 * 60 * 24)) {
                        keys.push(date);
                    }

                    let relevantStatistics = [];
                    let relevantScreens = [];

                    await stream.eachAsync(async (statistic) => {
                        position++;

                        let screen = objectCache.get(statistic.screen.toString());

                        if (!screen) {
                            screen = await Screen.findById(statistic.screen);

                            // check for primary screen tag
                            if (filter.primaryFilterType && filter.primaryFilterType.value === 'tag') {
                                const hasTag = !!screen.tags.find(tag => tag.toString() === filter.primaryResource._id.toString());
                                if (!hasTag) {
                                    // short circuit
                                    return;
                                }
                            }

                            objectCache.set(statistic.screen.toString(), screen);
                            relevantScreens.push(screen);
                        }

                        relevantStatistics.push(statistic);
                    });

                    for (let screen of relevantScreens) {
                        let screenArray = [screen.name];

                        for (let date = filter.startTime; date < filter.endTime; date = new Date(date.valueOf() + 1000 * 60 * 60 * 24)) {
                            let relevantPlays = relevantStatistics.filter(statistic => {
                                let isRelevantScreen = statistic.screen.toString() === screen._id.toString();

                                if (!isRelevantScreen) {
                                    return false;
                                }

                                let firstHour = new Date(date);
                                firstHour.setHours(0, 0, 0, 0);
                                let lastHour = new Date(date);
                                lastHour.setHours(23, 59, 59);
                                let isRelevantTimeframe = firstHour < new Date(statistic.when) && lastHour > new Date(statistic.when);

                                return isRelevantTimeframe;
                            });
                            screenArray.push(relevantPlays.length);
                        }

                        data.push(screenArray);
                    }

                    for (let i = 1; i < keys.length; i++) {
                        keys[i] = keys[i].toLocaleDateString();
                    }

                    logger.debug('Completed post processing of batch');

                    resolve(await module.exports.bundleReport({ user, exportConfig, filter, keys, data, uploadKey }));
                    break;

                case "screenissues":
                    keys = [
                        "Screen ID",
                        "Screen Name",
                        "Last Played"
                    ];

                    if (exportConfig.screens || exportConfig.screens.length) {
                        exportConfig.screens.forEach(screen => {
                            const row = {
                                "Screen ID": screen.searchToken,
                                "Screen Name": screen.name,
                                "Last Played": ''
                            }
                            if (screen.issues && screen.issues.length) {
                                const notPlayingIssue = screen.issues.find(issue => issue.type === 'notplaying');
                                if (notPlayingIssue) {
                                    const m = moment(notPlayingIssue.when).subtract(filter.tzOffset, 'minute');
                                    row['Last Played'] = m.format('l hh:mm A');
                                }
                            }
                            data.push(row);
                        })
                    }

                    logger.debug('Completed post processing of screen issues');

                    resolve(await module.exports.bundleReport({ user, exportConfig, filter, keys, data, uploadKey }))
                    break;
            }
        });
    }
}