import chromeLauncher from 'chrome-launcher';
import CDP from 'chrome-remote-interface';
import fs from 'fs-extra';
import path from 'path';
import config from './config.js';

const MIMES = {
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.gif': 'image/gif'
};

/**
 * Launch Chrome and setup DevTools protocol
 */
async function setup() {
    const chrome = await chromeLauncher.launch({
        chromeFlags: [
            '--window-size=1200,800',
            '--user-data-dir=/tmp/chrome-testing',
            '--auto-open-devtools-for-tabs'
        ]
    });
    const protocol = await CDP({ port: chrome.port });
    const { Fetch } = protocol;
 
    await Fetch.enable({
        patterns: [{
            urlPattern: `*${config.mockedUrl}*`,
            requestStage: 'Response'
        }, {
            urlPattern: `*${config.indexUrl}`,
            requestStage: 'Response'
        }]
    });

    return Fetch;
}

/**
 * Handle a request from Chrome that matches the configured URL patterns
 */
const handleRequest = (Fetch) => async ({ requestId, request, responseStatusCode }) => {
    if (responseStatusCode !== 200 && responseStatusCode !== 404) {
        console.debug(`Ignoring request ${request.url}, status code is ${responseStatusCode}`);
        Fetch.continueRequest({ requestId });

        return;
    }

    console.debug(`Intercepted ${request.url} {request id: ${requestId}}`);

    const url = new URL(request.url);
    const filepath = await findLocalFile(url);

    if (!filepath) {
        console.warn('File not found', filepath);
        Fetch.continueRequest({ requestId });

        return;
    }

    sendFileResponse(filepath, requestId, Fetch);
};

/**
 * Find a local version of a remote file
 * 
 * @param {URL} url 
 * 
 * @returns {string} path to the local file
 */
async function findLocalFile(url) {
    const filepath = url.pathname.replace(config.mockedUrl, config.localPath);
    let stat;

    try {
        stat = await fs.stat(filepath);
    }
    catch (e) {}

    if (stat && stat.isFile()) {
        return filepath;
    }

    if (!url.pathname.endsWith(config.indexUrl)) {
        return;
    }

    const indexFile = path.join(config.localPath, 'index.html');

    try {
        stat = await fs.stat(indexFile);
    }
    catch (e) {}

    if (stat && stat.isFile()) {
        return indexFile;
    }
}

/**
 * Send response with a local file
 * 
 * @param {*} filepath 
 * @param {*} requestId 
 * @param {*} Fetch 
 */
async function sendFileResponse(filepath, requestId, Fetch) {
    console.debug('Sending local file... ', filepath);

    let content = await fs.readFile(filepath, 'utf8');

    const regex = /\/\/# sourceMappingURL=(.+?)$/m;
    const subst = `//# sourceMappingURL=file://${filepath}.map`;
    content = content.replace(regex, subst);

    const contentType = MIMES[path.extname(filepath)];
    const buffer = Buffer.from(content);
    const encoded = buffer.toString('base64');

    Fetch.fulfillRequest({
        requestId,
        responseCode: 200,
        responseHeaders: [{
            name: 'Date',
            value: (new Date()).toUTCString()
        }, {
            name: 'Connection',
            value: 'closed'
        }, {
            name: 'Content-Length',
            value: String(content.length)
        }, {
            name: 'Content-Type',
            value: contentType || 'application/octet-stream'
        }],
        body: encoded
    });
}

/**
 * Run program
 */
async function main() {
    const Fetch = await setup();

    Fetch.requestPaused(handleRequest(Fetch));
}

main();