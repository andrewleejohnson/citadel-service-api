import xlsx from 'xlsx';
import csvStringify from 'csv-stringify/lib/sync';
import * as pdfLib from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import * as pdfLibDist from 'pdf-lib/dist/pdf-lib';
import moment from 'moment';

import logger from '../logger';
import aws from '../static/aws';
import { Screen, Statistic } from '../database/models';
import { json } from 'body-parser';

const ERRORS = {};

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

    bundleReport: async ({ user, exportConfig, filter, keys, data, uploadKey, url }) => {
        logger.debug(`Completed post processing of batch with ${data.length} keys`);

        if (data.length > 2048 && exportConfig.format.value === 'pdf') {
            throw new Error("Data too long to be output in PDF format, please use a different export format");
        }

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

                    writeProperty('Report generated', new Date().toLocaleString(filter.tzLocale, { timeZone: filter.tzName }));

                    if (filter.startTime && filter.endTime) {
                        writeProperty('Report results range', `${filter.startTime.toLocaleDateString(filter.tzLocale)} - ${filter.endTime.toLocaleDateString(filter.tzLocale)}`);
                    }

                    writeProperty('Report type', filter.type.value);

                    if (filter.primaryResource.hasOwnProperty('name') && filter.primaryResource.hasOwnProperty('value')) {
                        writeProperty('Report filtered by', `${filter.primaryResource.name} [${filter.primaryFilterType.value}]`);
                    }

                    writeProperty('Report timezone', filter.tzName);
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

    generateReport: async ({ user, databaseContext, filter, exportConfig, uploadKey, url }) => {
        return new Promise(async (resolve, reject) => {
            try {
                const timezoneOffset = filter.tzOffset;
                const timezoneLocale = filter.tzLocale;
                const timezoneName = filter.tzName;
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
                    case "dailystream":
                        query = {
                            when: {
                                $gte: filter.startTime,
                                $lte: filter.endTime
                            }
                        };

                        switch (filter.primaryFilterType.value) {
                            case "tag":
                                primaryTag = mongoose.Types.ObjectId(filter.primaryResource._id);
                                break;
                        }

                        if (filter.secondaryFilterType && filter.secondaryFilterType.value) {
                            switch (filter.secondaryFilterType.value) {
                                case "tag":
                                    secondaryTag = mongoose.Types.ObjectId(filter.secondaryResource._id);
                                    break;

                            }
                        }
                        break;
                }

                let aggregationConfig = {
                    maxTimeMS: 180000
                };

                const data = [];
                let results;

                logger.debug(`Processing aggregate batch for ${filter.type.value}...`);
                logger.verbose(`Executing with query match ${JSON.stringify(query)}`);

                switch (filter.type.value) {
                    case "videos":
                        results = await Statistic(databaseContext).aggregate([
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
                        ]).option(aggregationConfig).allowDiskUse(true);

                        for (const row of results) {
                            const duration = row.meta.find(meta => meta.key === 'duration');

                            data.push({
                                ["Video Name"]: row.name,
                                ["File Size (bytes)"]: row.size,
                                ["Duration (seconds)"]: duration ? Math.round(duration.value) : 0,
                                ["Plays"]: Math.floor(row.count)
                            });
                        }

                        keys = data[0] ? Object.keys(data[0]) : [];
                        break;
                    case "plays":
                        results = await Statistic(databaseContext).aggregate([
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
                        ]).option(aggregationConfig).allowDiskUse(true);

                        for (const row of results) {
                            const duration = row.file.meta.find(meta => meta.key === 'duration');

                            let entry = {
                                ["Played"]: new Date(row.when).toLocaleString(timezoneLocale, { timeZone: timezoneName }),
                                ["Video Name"]: row.file.name,
                                ["Duration (seconds)"]: duration ? Math.round(duration.value) : 0,
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
                        break;
                    case "screens":
                        results = await Screen(databaseContext).aggregate([
                            {
                                $match: query
                            }
                        ]).option(aggregationConfig).allowDiskUse(true);

                        for (const row of results) {
                            const dataRow = {
                                ["Screen Name"]: row.name,
                                ["Status"]: row.status,
                                ["Device Model"]: row.deviceModel,
                                ["Version"]: row.version,
                                ["Location"]: (row.location && row.location.valid && row.location.history && row.location.history.length > 0) ? row.location.history[row.location.history.length - 1].summary : null,
                                ["PIN"]: row.pin,
                            };

                            if (exportConfig.exportInternalIDs && exportConfig.format.value !== "pdf") {
                                dataRow["Screen ID"] = row.searchToken;
                                dataRow["Last Played"] = null;

                                if (row.issues && row.issues.length > 0 && row.lastPing) {
                                    let notPlayingIssue = row.issues.find(issue => issue.type === 'notplaying');

                                    if (notPlayingIssue) {
                                        const numberDays = Math.round((new Date() - new Date(row.lastPing)) / (1000 * 60 * 60 * 24));
                                        dataRow["Last Played"] = `${numberDays} days ago`;
                                    }
                                }
                            }

                            data.push(dataRow);
                        }

                        keys = data[0] ? Object.keys(data[0]) : [];
                        break;
                    case "playsvideotime":
                        keys = ['Video Name'];

                        results = await Statistic(databaseContext).aggregate([
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
                                            date: "$when",
                                            timezone: timezoneName
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
                        ]).option(aggregationConfig).allowDiskUse(true);

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

                        break;
                    case "playsscreentime":
                        keys = ['Screen Name', 'Screen ID'];

                        results = await Statistic(databaseContext).aggregate([
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
                                            date: "$when",
                                            timezone: timezoneName
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
                        ]).option(aggregationConfig).allowDiskUse(true);
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
                            const dataRow = [screen.name, screen.searchToken];

                            for (const row of results) {
                                let playCount = row.plays.filter(play => play.toString() === screen._id.toString()).length;
                                dataRow.push(playCount);
                            }

                            data.push(dataRow);
                        }

                        break;
                    case "screenissues":
                        results = await Screen(databaseContext).aggregate([
                            {
                                $match: {
                                    ...query,
                                    issues: { $exists: true, $ne: [] }
                                }
                            }
                        ]).option(aggregationConfig).allowDiskUse(true);

                        keys = ["Screen ID", "Screen Name", "Status", "PIN", "Last Played"];

                        for (const row of results) {
                            const dataRow = {
                                "Screen ID": row.searchToken,
                                "Screen Name": row.name,
                                "Status": row.status,
                                "PIN": row.pin,
                                "Last Played": null
                            }

                            if (row.issues && row.issues.length > 0 && row.lastPing) {
                                const notPlayingIssue = row.issues.find(issue => issue.type === 'notplaying');
                                console.log(notPlayingIssue);
                                if (notPlayingIssue) {
                                    const numberDays = Math.round((new Date() - new Date(row.lastPing)) / (1000 * 60 * 60 * 24));
                                    dataRow["Last Played"] = `${numberDays} days ago`;

                                    data.push(dataRow);
                                }
                            }
                        }

                        break;
                    case "dailystream":
                        keys = ['Screen Name'];
                        let datesBetween = []
                        let currentDate = new Date(filter.startTime.valueOf() - 24 * 60 * 60 * 1000)
                        while (currentDate < filter.endTime - 24 * 60 * 60 * 1000) { //this creates a list of dates which we can use to build our array that will be used for printing
                            currentDate = new Date(currentDate.valueOf() + 24 * 60 * 60 * 1000)
                            const dateString = currentDate.toLocaleDateString("en-US", { year: "numeric", month: "2-digit", day: "2-digit" });
                            datesBetween[dateString.toString()] = '0'
                            keys.push(dateString.toString())
                        }

                        results = await Statistic(databaseContext).aggregate([
                            {
                                $match: query
                            },
                            ...module.exports.generateFullTagLookupQuery(primaryTag, ['screen']),
                            {
                                $project: {
                                    timestamp: {
                                        $dateToString: {
                                            format: "%m/%d/%Y",
                                            date: "$when",
                                            timezone: timezoneName
                                        }
                                    },
                                    file: 1.0,
                                    screen: 1.0
                                }
                            },
                            {
                                $group: {
                                    _id: { timestamp: "$timestamp", screen: "$screen"},
                                    plays: {
                                        $push: "$file"
                                    }
                                }
                            },
                            {
                                $lookup: {
                                    from: "screens",
                                    localField: "_id.screen",
                                    foreignField: "_id",
                                    as: "screen"
                                }
                            },
                            {
                                $lookup: {
                                    from: "files",
                                    localField: "plays",
                                    foreignField: "_id",
                                    as: "distinct"
                                }
                            },
                            {
                                $project: {
                                    "distinct._id":1,
                                    "distinct.meta":1,
                                    "screen":1,
                                    "plays":1,
                            }
                            },
                            {
                                $sort: {
                                    _id: 1
                                }
                            }

                        ]).option(aggregationConfig).allowDiskUse(true)


                        let playtime = [];
                        results.forEach((item) => { //each returned item grouped by screen and timestamp. this contains the full screen document and full distinct video documents which is used with plays to determine duration

                            const _id = item._id
                            const date = _id.timestamp

                            const screenName = item.screen[0]['name']

                            const plays = item.plays
                            let dailyPlaytime = 0;
                            plays.forEach((fileId) => { //finds total length of all videos that played on this date for this screen
                                const video = item.distinct.find(video => video._id.toString() === fileId.toString())
                                const durationMeta = video.meta.find(entry => entry.key === 'duration')
                                let durationValue = (durationMeta) ? durationMeta.value : 0;
                                dailyPlaytime += parseFloat(durationValue);
                            })
                            dailyPlaytime = new Date(dailyPlaytime * 1000).toISOString().substr(11, 8) //makes duration pretty

                            if (typeof playtime[screenName] === 'undefined') {
                                let deepCopiedDates = [];
                                for (const key in datesBetween) { //need to deep copy cant use lodash or stringify parse so we do it manually
                                    deepCopiedDates[key] = datesBetween[key]
                                }

                                playtime[screenName] = deepCopiedDates;
                            }

                            playtime[screenName][date.toString()] = dailyPlaytime
                        });

                        for (const index in playtime) {
                            let finalOutput = []
                            for (const index2 in playtime[index]) { 
                                finalOutput.push(playtime[index][index2])
                            }
                            finalOutput.unshift(index.toString()) //adds screen name to front of array
                            data.push(finalOutput)
                        }

                        break;
                    default:
                        reject("Invalid report type");
                        break;
                }

                try {
                    let report = await module.exports.bundleReport({ user, exportConfig, filter, data, keys, uploadKey, url });
                    resolve(report);
                } catch (e) {
                    reject(e.toString());
                }
            }
            catch (e) {
                reject(e.toString());
            }
        });
    }
}