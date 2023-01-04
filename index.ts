#!/usr/bin/env node
import * as fs from "fs";
import * as connect from "connect";
import * as serveIndex from "serve-index";
import * as logger from "morgan";
import { WebSocketServer } from "ws";
import * as path from "path";
import * as url from "url";
import * as http from "http";
import * as send from "send";
import * as mime from "mime";
import * as chokidar from "chokidar";
import "colors";
import type { AddressInfo } from "net";

type IgnoreMatcher =string | RegExp | ((testString: string) => boolean);

export interface LiveServerOptions {
	port?: number;
	logLevel?: number;
	poll?: boolean;
	root?: string;
	watch?: string[];
	ignore?: IgnoreMatcher[]; 
}

const INJECTED_CODE = fs.readFileSync(path.join(__dirname, "injected.html"), "utf8");

function escape(html: string){
	return String(html)
		.replace(/&(?!\w+;)/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

// Based on connect.static(), but streamlined and with added code injecter
function staticServer(root: string) {
	return (req: connect.IncomingMessage, res: http.ServerResponse, next: connect.NextFunction) => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			return next();
		}

		let reqpath = url.parse(req.url ?? "").pathname;
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
					} catch (e) {
						// No index.html
					}
				} else {
					res.statusCode = 301;
					res.setHeader("Location", reqpath + "/");
					res.end("Redirecting to " + escape(reqpath) + "/");
					return;
				}
				
			}
		} catch (e) {
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
				} else {
					res.end(contents);
				}
			} catch (e) {
				res.writeHead(404);
				res.end("File " + reqpath + " not found.");
			}
		} else {
			send(req, reqpath, { root: root })
			.on("error", (err) => {
				if (err.status === 404) {
					return next();
				}
				next(err);
			})
			.on("directory", () => {
				const pathname = url.parse(req.originalUrl ?? "").pathname ?? "";
				res.statusCode = 301;
				res.setHeader("Location", pathname + "/");
				res.end("Redirecting to " + escape(pathname) + "/");
			})
			.pipe(res);
		}
	};
}

/**
 * Start a live server with parameters given as an object
 * @param host {string} Address to bind to (default: 0.0.0.0)
 * @param port {number} Port number (default: 8080)
 * @param root {string} Path to root directory (default: cwd)
 * @param watch {array} Paths to exclusively watch for changes
 * @param ignore {array} Paths to ignore when watching files for changes
 * @param logLevel {number} 0 = errors only, 1 = some, 2 = lots
 */

interface LiveServerInterface {
	server: http.Server | null;
	watcher: chokidar.FSWatcher | null;
	logLevel: number;
	start: (options: LiveServerOptions) => void;
	shutdown: () => void;
}

const LiveServer: LiveServerInterface = {
	server: null,
	watcher: null,
	logLevel: 2,
	start(options: LiveServerOptions) {
		const {
			port = 8080, // 0 means random
			poll = false
		} = options;
		const root = options.root || process.cwd();
		const watchPaths = options.watch ?? [root];
		LiveServer.logLevel = options.logLevel ?? 2;
		const staticServerHandler = staticServer(root);
	
		// Setup a web server
		const app = connect();
	
		// Add logger. Level 2 logs only errors
		if (LiveServer.logLevel === 2) {
			app.use(logger("dev", {
				skip: (_req, res) => res.statusCode < 400
			}));
		// Level 2 or above logs all requests
		} else if (LiveServer.logLevel > 2) {
			app.use(logger("dev"));
		}
	
		app.use(staticServerHandler) // Custom static server
			.use(serveIndex(root, { icons: true }) as connect.NextHandleFunction);
	
		const server = http.createServer(app);
	
		// Handle server startup errors
		server.addListener("error", e => {
			console.error(e.toString().red);
			LiveServer.shutdown();
		});
	
		// Handle successful server
		server.addListener("listening", () => {
			LiveServer.server = server;
	
			const address = server.address() as AddressInfo | null;

			if (!address) {
				console.log("Error: failed to retreive server address".red);
				return;
			}
	
			// Output
			if (LiveServer.logLevel >= 1) {
				console.log(("Serving \"%s\" on port %s").green, root, address.port)
			}
	
		});
	
		// Setup server to listen at port
		server.listen(port);

		// Setup WebSocket
		const websocketServer = new WebSocketServer({ 
			server,
			clientTracking: true 
		});

		websocketServer.on("connection", ws => ws.send("connected"));
	
		// Setup watcher
		let ignored: IgnoreMatcher[] = [
			// Always ignore dotfiles (important e.g. because editor hidden temp files)
			(testPath: string) => testPath !== "." && /(^[.#]|(?:__|~)$)/.test(path.basename(testPath))
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

		function handleChange(changePath: string) {
			if (LiveServer.logLevel >= 1) {
				console.log("Change detected".cyan, changePath); 
			}

			websocketServer.clients.forEach(ws => ws.send("reload"));
		}

		LiveServer.watcher
			.on("change", handleChange)
			.on("add", handleChange)
			.on("unlink", handleChange)
			.on("addDir", handleChange)
			.on("unlinkDir", handleChange)
			.on("ready", () => {
				if (LiveServer.logLevel >= 1) {
					console.log("Ready for changes".cyan);
				}
			})
			.on("error", err => console.log("ERROR:".red, err));
	
		return server;
	},

	shutdown() {
		const {watcher, server} = LiveServer;

		if (watcher) {
			watcher.close();
		}
		if (server)
			server.close();
	}
};

module.exports = LiveServer;
