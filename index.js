#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fs = require("fs");
const connect = require("connect");
const serveIndex = require("serve-index");
const logger = require("morgan");
const ws_1 = require("ws");
const path = require("path");
const url = require("url");
const http = require("http");
const send = require("send");
const os = require("os");
const mime = require("mime");
const chokidar = require("chokidar");
require("colors");
const INJECTED_CODE = fs.readFileSync(path.join(__dirname, "injected.html"), "utf8");
function escape(html) {
    return String(html)
        .replace(/&(?!\w+;)/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function isNodeJSError(e) {
    return e instanceof Error;
}
// Based on connect.static(), but streamlined and with added code injecter
function staticServer(root) {
    return function (req, res, next) {
        var _a;
        if (req.method !== "GET" && req.method !== "HEAD") {
            return next();
        }
        let reqpath = url.parse((_a = req.url) !== null && _a !== void 0 ? _a : "").pathname;
        if (!reqpath) {
            return next();
        }
        try {
            const stat = fs.statSync(`.${reqpath}`);
            if (stat.isDirectory()) {
                if (reqpath[reqpath.length - 1] === "/") {
                    try {
                        fs.statSync(`.${reqpath}/index.html`);
                        reqpath += "/index.html";
                    }
                    catch (e) {
                        // No index.html
                    }
                }
                else {
                    res.statusCode = 301;
                    res.setHeader('Location', reqpath + '/');
                    res.end('Redirecting to ' + escape(reqpath) + '/');
                    return;
                }
            }
        }
        catch (e) {
            // No index.html
        }
        const isHTML = mime.getType(reqpath) === "text/html";
        if (isHTML) {
            try {
                const contents = fs.readFileSync(`.${reqpath}`, "utf8");
                res.setHeader("Content-Type", "text/html");
                res.setHeader("Cache-Control", "public, max-age=0");
                res.setHeader("Accept-Ranges", "bytes");
                const match = /(<\/body>|<\/head>)/.exec(contents);
                if (match) {
                    res.end(contents.replace(match[0], INJECTED_CODE + match[0]));
                }
                else {
                    res.end(contents);
                }
            }
            catch (e) {
                res.writeHead(404);
                res.end("File " + reqpath + " not found.");
            }
        }
        else {
            send(req, reqpath, { root: root })
                .on("error", (err) => {
                if (err.status === 404) {
                    return next();
                }
                next(err);
            })
                .on("directory", () => {
                var _a, _b;
                const pathname = (_b = url.parse((_a = req.originalUrl) !== null && _a !== void 0 ? _a : "").pathname) !== null && _b !== void 0 ? _b : "";
                res.statusCode = 301;
                res.setHeader('Location', pathname + '/');
                res.end('Redirecting to ' + escape(pathname) + '/');
            })
                .pipe(res);
        }
    };
}
const LiveServer = {
    server: null,
    watcher: null,
    logLevel: 2,
    start(options) {
        options = options || {};
        const host = process.env.IP || '0.0.0.0';
        const port = options.port !== undefined ? options.port : 8080; // 0 means random
        const root = options.root || process.cwd();
        const watchPaths = options.watch || [root];
        LiveServer.logLevel = options.logLevel === undefined ? 2 : options.logLevel;
        const staticServerHandler = staticServer(root);
        const poll = options.poll || false;
        // Setup a web server
        const app = connect();
        // Add logger. Level 2 logs only errors
        if (LiveServer.logLevel === 2) {
            app.use(logger('dev', {
                skip: function (_req, res) { return res.statusCode < 400; }
            }));
            // Level 2 or above logs all requests
        }
        else if (LiveServer.logLevel > 2) {
            app.use(logger('dev'));
        }
        app.use(staticServerHandler) // Custom static server
            .use(serveIndex(root, { icons: true }));
        const server = http.createServer(app);
        const protocol = "http";
        // Handle server startup errors
        server.addListener('error', function (e) {
            if (isNodeJSError(e) && e.code === 'EADDRINUSE') {
                const serveURL = protocol + '://' + host + ':' + port;
                console.log('%s is already in use. Trying another port.'.yellow, serveURL);
                setTimeout(function () {
                    server.listen(0, host);
                }, 1000);
            }
            else {
                console.error(e.toString().red);
                LiveServer.shutdown();
            }
        });
        // Handle successful server
        server.addListener('listening', function ( /*e*/) {
            LiveServer.server = server;
            const address = server.address();
            if (!address) {
                console.log("Error: failed to retreive server address".red);
                return;
            }
            const serveHost = address.address === "0.0.0.0" ? "127.0.0.1" : address.address;
            const openHost = host === "0.0.0.0" ? "127.0.0.1" : host;
            const serveURL = protocol + '://' + serveHost + ':' + address.port;
            const openURL = protocol + '://' + openHost + ':' + address.port;
            let serveURLs = [serveURL];
            if (LiveServer.logLevel > 2 && address.address === "0.0.0.0") {
                const ifaces = os.networkInterfaces();
                serveURLs = Object.values(ifaces)
                    // flatten address data, use only IPv4
                    .reduce(function (data, addresses) {
                    addresses.filter(function (addr) {
                        return addr.family === "IPv4";
                    }).forEach(function (addr) {
                        data.push(addr);
                    });
                    return data;
                }, [])
                    .map(function (addr) {
                    return protocol + "://" + addr.address + ":" + address.port;
                });
            }
            // Output
            if (LiveServer.logLevel >= 1) {
                if (serveURL === openURL)
                    if (serveURLs.length === 1) {
                        console.log(("Serving \"%s\" at %s").green, root, serveURLs[0]);
                    }
                    else {
                        console.log(("Serving \"%s\" at\n\t%s").green, root, serveURLs.join("\n\t"));
                    }
                else
                    console.log(("Serving \"%s\" at %s (%s)").green, root, openURL, serveURL);
            }
        });
        // Setup server to listen at port
        server.listen(port, host);
        const websocketServer = new ws_1.WebSocketServer({
            server,
            clientTracking: true
        });
        websocketServer.on("connection", ws => ws.send('connected'));
        let ignored = [
            function (testPath) {
                return testPath !== "." && /(^[.#]|(?:__|~)$)/.test(path.basename(testPath));
            }
        ];
        if (options.ignore) {
            ignored = ignored.concat(options.ignore);
        }
        // Setup file watcher
        LiveServer.watcher = chokidar.watch(watchPaths, {
            usePolling: poll,
            ignored: ignored,
            ignoreInitial: true
        });
        function handleChange(changePath) {
            if (LiveServer.logLevel >= 1) {
                console.log("Change detected".cyan, changePath);
            }
            websocketServer.clients.forEach((ws) => ws.send('reload'));
        }
        LiveServer.watcher
            .on("change", handleChange)
            .on("add", handleChange)
            .on("unlink", handleChange)
            .on("addDir", handleChange)
            .on("unlinkDir", handleChange)
            .on("ready", function () {
            if (LiveServer.logLevel >= 1)
                console.log("Ready for changes".cyan);
        })
            .on("error", function (err) {
            console.log("ERROR:".red, err);
        });
        return server;
    },
    shutdown() {
        const watcher = LiveServer.watcher;
        if (watcher) {
            watcher.close();
        }
        const server = LiveServer.server;
        if (server)
            server.close();
    }
};
module.exports = LiveServer;
