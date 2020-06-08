import xlsx from 'xlsx';
import csvStringify from 'csv-stringify/lib/sync';
import * as pdfLib from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import * as pdfLibDist from 'pdf-lib/dist/pdf-lib';
import moment from 'moment';

import logger from '../logger';
import aws from '../aws';
import Screen from '../database/models/screen';
import Statistic from '../database/models/statistic';

module.exports = {
    generateTagLookupQuery: (collection, resource, tag) => {
        return [
            {
                $lookup: {
                    from: collection,
                    let: { [resource]: `$${resource}` },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $in: [mongoose.Types.ObjectId(tag), "$tags"] },
                                        { $eq: [`$$${resource}`, "$_id"] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: `${collection}_tags`
                }
            },
            {
                $unwind: {
                    path: `$${collection}_tags`,
                    preserveNullAndEmptyArrays: true
                }
            }
        ];
    },

    generateFullTagLookupQuery: (tag, resourcesToCheck) => {
        if (!tag) {
            return [];
        }

        const queryChain = [];
        for (let resource of resourcesToCheck) {
            queryChain.push(...module.exports.generateTagLookupQuery(`${resource}s`, resource, tag));
        }

        queryChain.push({
            $match: {
                $or: resourcesToCheck.map(resource => {
                    return { [`${resource}s_tags`]: { $exists: true } }
                })
            }
        });

        return queryChain;
    },

    bundleReport: async ({ user, exportConfig, filter, keys, data, uploadKey }) => {
        logger.debug(`Completed post processing of batch with ${data.length} keys`);

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
            const timezoneOffset = filter.tzOffset;
            filter.startTime = new Date(new Date(filter.startTime).valueOf() + (timezoneOffset * 1000 * 60));
            filter.startTime.setHours(0, 0, 0, 0);
            filter.endTime = new Date(new Date(filter.endTime).valueOf() + (timezoneOffset * 1000 * 60));
            filter.endTime.setHours(23, 59, 59);

            let query;
            let keys;
            let primaryTag;
            let secondaryTag;

            switch (filter.type.value) {
                case "videos":
                case "plays":
                case "playsscreentime":
                case "playsvideotime":
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
                            primaryTag = mongoose.Types.ObjectId(filter.primaryResource._id);
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
                                secondaryTag = mongoose.Types.ObjectId(filter.secondaryResource._id);
                                break;
                            case "screen":
                                // bypass
                                query['screen'] = mongoose.Types.ObjectId(filter.secondaryResource._id);
                                break;
                        }
                    }
                    break;
                case "screens":
                case "screenissues":
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
                    break;
            }

            const data = [];
            let results;

            logger.debug(`Processing aggregate batch for ${filter.type.value}...`);
            logger.verbose(`Executing with query match ${JSON.stringify(query)}`);

            switch (filter.type.value) {
                case "videos":
                    results = await Statistic.aggregate([
                        {
                            $match: query
                        },
                        ...module.exports.generateFullTagLookupQuery(primaryTag, ['file', 'playlist', 'channel', 'screen']),
                        {
                            $lookup: {
                                from: "files",
                                localField: "file",
                                foreignField: "_id",
                                as: "file"
                            }
                        },
                        {
                            $unwind: {
                                path: "$file"
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
                    ]).allowDiskUse(true);

                    for (const row of results) {
                        const duration = row.meta.find(meta => meta.key === 'duration');

                        data.push({
                            ["Video Name"]: row.name,
                            ["File Size (bytes)"]: row.size,
                            ["Duration (seconds)"]: Math.round(duration.value),
                            ["Plays"]: Math.floor(row.count)
                        });
                    }

                    keys = data[0] ? Object.keys(data[0]) : [];
                    resolve(await module.exports.bundleReport({ user, exportConfig, filter, data, keys, uploadKey }));
                    break;
                case "plays":
                    results = await Statistic.aggregate([
                        {
                            $match: query
                        },
                        ...module.exports.generateFullTagLookupQuery(primaryTag, ['file', 'playlist', 'channel', 'screen']),
                        {
                            $lookup: {
                                from: "files",
                                localField: "file",
                                foreignField: "_id",
                                as: "file"
                            }
                        },
                        {
                            $lookup: {
                                from: "screens",
                                localField: "screen",
                                foreignField: "_id",
                                as: "screen"
                            }
                        },
                        {
                            $unwind: {
                                path: "$file"
                            }
                        },
                        {
                            $unwind: {
                                path: "$screen"
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
                        },
                        {
                            $sort: {
                                when: -1
                            }
                        }
                    ]).allowDiskUse(true);

                    for (const row of results) {
                        const duration = row.file.meta.find(meta => meta.key === 'duration');
                        const m = moment(row.when).subtract(filter.tzOffset, 'minute');

                        let entry = {
                            ["Played"]: m.format('l hh:mm A'),
                            ["Video Name"]: row.file.name,
                            ["Duration (seconds)"]: Math.round(duration.value),
                            ["Screen Name"]: row.screen.name,
                            ["Screen IP"]: row.screen.ip,
                            ["File Size (bytes)"]: row.file.size
                        };

                        if (exportConfig.exportInternalIDs && exportConfig.format.value !== "pdf") {
                            entry["Statistic ID"] = row._id.toString();
                            entry["Screen ID"] = row.screen.searchToken;
                        }

                        data.push(entry);
                    }

                    keys = data[0] ? Object.keys(data[0]) : [];
                    resolve(await module.exports.bundleReport({ user, exportConfig, filter, keys, data, uploadKey }));
                    break;
                case "screens":
                    results = await Screen.aggregate([
                        {
                            $match: query
                        }
                    ]).allowDiskUse(true);

                    for (const row of results) {
                        const dataRow = {
                            ["Screen Name"]: row.name,
                            ["Status"]: row.status,
                            ["Device Model"]: row.deviceModel,
                            ["Version"]: row.version,
                            ["Location"]: (row.location && row.location.valid) ? row.location.history[row.location.history.length - 1].summary : null,
                            ["PIN"]: row.pin,
                        };

                        if (exportConfig.exportInternalIDs && exportConfig.format.value !== "pdf") {
                            dataRow["Screen ID"] = screen.searchToken;
                            dataRow["Last Played"] = '';
                            if (row.issues && row.issues.length > 0) {
                                let notPlayingIssue = row.issues.find(issue => issue.type === 'notplaying');

                                if (notPlayingIssue) {
                                    const numberDays = Math.round((Date.now() - new Date(notPlayingIssue.when).valueOf()) / (1000 * 60 * 60 * 24));
                                    dataRow["Last Played"] = `${numberDays} days ago`;
                                }
                            }
                        }

                        data.push(dataRow);
                    }

                    keys = data[0] ? Object.keys(data[0]) : [];
                    resolve(await module.exports.bundleReport({ user, exportConfig, filter, keys, data, uploadKey }));
                    break;
                case "playsvideotime":
                    keys = ['Video Name'];

                    results = await Statistic.aggregate([
                        {
                            $match: query
                        },
                        ...module.exports.generateFullTagLookupQuery(primaryTag, ['screen']),
                        ...module.exports.generateFullTagLookupQuery(secondaryTag, ['file']),
                        {
                            $project: {
                                timestamp: {
                                    $dateToString: {
                                        format: "%m/%d/%Y",
                                        date: "$when"
                                    }
                                },
                                file: 1.0,
                            }
                        },
                        {
                            $unwind: {
                                path: "$file",
                                preserveNullAndEmptyArrays: false
                            }
                        },
                        {
                            $group: {
                                _id: "$timestamp",
                                plays: {
                                    $push: "$file"
                                },
                                distinct: {
                                    $addToSet: "$file"
                                }
                            }
                        },
                        {
                            $lookup: {
                                from: "files",
                                localField: "distinct",
                                foreignField: "_id",
                                as: "distinct"
                            }
                        },
                        {
                            $sort: {
                                _id: 1
                            }
                        }
                    ]).allowDiskUse(true);

                    // postprocess results
                    const relevantVideos =
                        Array.from(
                            new Set([].concat(
                                ...results.map(row => row.distinct.map(distinct => JSON.stringify(distinct))))
                            )
                        ).map(distinct => JSON.parse(distinct));

                    for (const date of results) {
                        keys.push(date['_id']);
                    }

                    for (const video of relevantVideos) {
                        const dataRow = [video.name];

                        for (const row of results) {
                            let playCount = row.plays.filter(play => play.toString() === video._id.toString()).length;
                            dataRow.push(playCount);
                        }

                        data.push(dataRow);
                    }

                    resolve(await module.exports.bundleReport({ user, exportConfig, filter, keys, data, uploadKey }));
                    break;
                case "playsscreentime":
                    keys = ['Screen Name'];

                    results = await Statistic.aggregate([
                        {
                            $match: query
                        },
                        ...module.exports.generateFullTagLookupQuery(primaryTag, ['screen']),
                        ...module.exports.generateFullTagLookupQuery(secondaryTag, ['file']),
                        {
                            $project: {
                                timestamp: {
                                    $dateToString: {
                                        format: "%m/%d/%Y",
                                        date: "$when"
                                    }
                                },
                                screen: 1.0
                            }
                        },
                        {
                            $unwind: {
                                path: "$screen",
                                preserveNullAndEmptyArrays: false
                            }
                        },
                        {
                            $group: {
                                _id: "$timestamp",
                                plays: {
                                    $push: "$screen"
                                },
                                distinct: {
                                    $addToSet: "$screen"
                                }
                            }
                        },
                        {
                            $lookup: {
                                from: "screens",
                                localField: "distinct",
                                foreignField: "_id",
                                as: "distinct"
                            }
                        },
                        {
                            $sort: {
                                _id: 1
                            }
                        }
                    ]).allowDiskUse(true);

                    // postprocess results
                    const relevantScreens =
                        Array.from(
                            new Set([].concat(
                                ...results.map(row => row.distinct.map(distinct => JSON.stringify(distinct))))
                            )
                        ).map(distinct => JSON.parse(distinct));

                    for (const date of results) {
                        keys.push(date['_id']);
                    }

                    for (const screen of relevantScreens) {
                        const dataRow = [screen.name];

                        for (const row of results) {
                            let playCount = row.plays.filter(play => play.toString() === screen._id.toString()).length;
                            dataRow.push(playCount);
                        }

                        data.push(dataRow);
                    }

                    resolve(await module.exports.bundleReport({ user, exportConfig, filter, keys, data, uploadKey }));
                    break;
                case "screenissues":
                    results = await Screen.aggregate([
                        {
                            $match: query
                        }
                    ]).allowDiskUse(true);

                    keys = ["Screen ID", "Screen Name", "Last Played"];

                    for (const row of results) {
                        const dataRow = {
                            "Screen ID": row.searchToken,
                            "Screen Name": row.name,
                            "Last Played": null
                        }
                        if (row.issues && row.issues.length) {
                            const notPlayingIssue = row.issues.find(issue => issue.type === 'notplaying');
                            if (notPlayingIssue) {
                                const m = moment(notPlayingIssue.when).subtract(filter.tzOffset, 'minute');
                                dataRow['Last Played'] = m.format('l hh:mm A');
                            }
                        }
                        data.push(dataRow);
                    }

                    resolve(await module.exports.bundleReport({ user, exportConfig, filter, keys, data, uploadKey }))
                    break;
            }
        });
    }
}