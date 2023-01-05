#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LiveServer = void 0;
const fs = require("fs");
const connect = require("connect");
const serveIndex = require("serve-index");
const logger = require("morgan");
const ws_1 = require("ws");
const path = require("path");
const url = require("url");
const http = require("http");
const send = require("send");
const mime = require("mime");
const chokidar = require("chokidar");
require("colors");
const INJECTED_CODE = fs.readFileSync(path.join(__dirname, "injected.html"), "utf8");
function escape(html) {
    return String(html)
        .replace(/&(?!\w+;)/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
// Based on connect.static(), but streamlined and with added code injecter
function staticServer(root) {
    return (req, res, next) => {
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
                    res.setHeader("Location", reqpath + "/");
                    res.end("Redirecting to " + escape(reqpath) + "/");
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
                res.setHeader("Location", pathname + "/");
                res.end("Redirecting to " + escape(pathname) + "/");
            })
                .pipe(res);
        }
    };
}
exports.LiveServer = {
    server: null,
    watcher: null,
    logLevel: 2,
    start(options) {
        var _a, _b;
        const { port = 8080, // 0 means random
        poll = false } = options;
        const root = options.root || process.cwd();
        const watchPaths = (_a = options.watch) !== null && _a !== void 0 ? _a : [root];
        exports.LiveServer.logLevel = (_b = options.logLevel) !== null && _b !== void 0 ? _b : 2;
        const staticServerHandler = staticServer(root);
        // Setup a web server
        const app = connect();
        // Add logger. Level 2 logs only errors
        if (exports.LiveServer.logLevel === 2) {
            app.use(logger("dev", {
                skip: (_req, res) => res.statusCode < 400
            }));
            // Level 2 or above logs all requests
        }
        else if (exports.LiveServer.logLevel > 2) {
            app.use(logger("dev"));
        }
        app.use(staticServerHandler) // Custom static server
            .use(serveIndex(root, { icons: true }));
        const server = http.createServer(app);
        // Handle server startup errors
        server.addListener("error", e => {
            console.error(e.toString().red);
            exports.LiveServer.shutdown();
        });
        // Handle successful server
        server.addListener("listening", () => {
            // Output
            if (exports.LiveServer.logLevel >= 1) {
                console.log(("Serving \"%s\" on port %s").green, root, port);
            }
        });
        // Setup server to listen at port
        server.listen(port);
        // Setup WebSocket
        const websocketServer = new ws_1.WebSocketServer({
            server,
            clientTracking: true
        });
        websocketServer.on("connection", ws => ws.send("connected"));
        // Setup watcher
        let ignored = [
            // Always ignore dotfiles (important e.g. because editor hidden temp files)
            (testPath) => testPath !== "." && /(^[.#]|(?:__|~)$)/.test(path.basename(testPath))
        ];
        if (options.ignore) {
            ignored = ignored.concat(options.ignore);
        }
        // Setup file watcher
        exports.LiveServer.watcher = chokidar.watch(watchPaths, {
            usePolling: poll,
            ignored: ignored,
            ignoreInitial: true
        });
        function handleChange(changePath) {
            if (exports.LiveServer.logLevel >= 1) {
                console.log("Change detected".cyan, changePath);
            }
            websocketServer.clients.forEach(ws => ws.send("reload"));
        }
        exports.LiveServer.watcher
            .on("change", handleChange)
            .on("add", handleChange)
            .on("unlink", handleChange)
            .on("addDir", handleChange)
            .on("unlinkDir", handleChange)
            .on("ready", () => {
            if (exports.LiveServer.logLevel >= 1) {
                console.log("Ready for changes".cyan);
            }
        })
            .on("error", err => console.log("ERROR:".red, err));
        return server;
    },
    shutdown() {
        const { watcher, server } = exports.LiveServer;
        if (watcher) {
            watcher.close();
        }
        if (server) {
            server.close();
        }
    }
};
