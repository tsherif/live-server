#!/usr/bin/env node
const fs = require('fs'),
	connect = require('connect'),
	serveIndex = require('serve-index'),
	logger = require('morgan'),
	WebSocket = require('faye-websocket'),
	path = require('path'),
	url = require('url'),
	http = require('http'),
	send = require('send'),
	os = require('os'),
	mime = require('mime'),
	chokidar = require('chokidar');
	require('colors');

const INJECTED_CODE = fs.readFileSync(path.join(__dirname, "injected.html"), "utf8");

const LiveServer = {
	server: null,
	watcher: null,
	logLevel: 2
};

function escape(html){
	return String(html)
		.replace(/&(?!\w+;)/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// Based on connect.static(), but streamlined and with added code injecter
function staticServer(root) {
	return function(req, res, next) {
		if (req.method !== "GET" && req.method !== "HEAD") return next();
		let reqpath = url.parse(req.url).pathname;
		console.log(reqpath);
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
					res.setHeader('Location', reqpath + '/');
					res.end('Redirecting to ' + escape(reqpath) + '/');
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
				const pathname = url.parse(req.originalUrl).pathname;
				res.statusCode = 301;
				res.setHeader('Location', pathname + '/');
				res.end('Redirecting to ' + escape(pathname) + '/');
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
 * @param ignorePattern {regexp} Ignore files by RegExp
 * @param noCssInject Don't inject CSS changes, just reload as with any other file change
 * @param open {(string|string[])} Subpath(s) to open in browser, use false to suppress launch (default: server root)
 * @param mount {array} Mount directories onto a route, e.g. [['/components', './node_modules']].
 * @param logLevel {number} 0 = errors only, 1 = some, 2 = lots
 * @param file {string} Path to the entry point file
 * @param wait {number} Server will wait for all changes, before reloading
 * @param htpasswd {string} Path to htpasswd file to enable HTTP Basic authentication
 * @param middleware {array} Append middleware to stack, e.g. [function(req, res, next) { next(); }].
 */
LiveServer.start = function(options) {
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
			skip: function (req, res) { return res.statusCode < 400; }
		}));
	// Level 2 or above logs all requests
	} else if (LiveServer.logLevel > 2) {
		app.use(logger('dev'));
	}

	app.use(staticServerHandler) // Custom static server
		.use(serveIndex(root, { icons: true }));


	const server = http.createServer(app);
	const protocol = "http";

	// Handle server startup errors
	server.addListener('error', function(e) {
		if (e.code === 'EADDRINUSE') {
			const serveURL = protocol + '://' + host + ':' + port;
			console.log('%s is already in use. Trying another port.'.yellow, serveURL);
			setTimeout(function() {
				server.listen(0, host);
			}, 1000);
		} else {
			console.error(e.toString().red);
			LiveServer.shutdown();
		}
	});

	// Handle successful server
	server.addListener('listening', function(/*e*/) {
		LiveServer.server = server;

		const address = server.address();
		const serveHost = address.address === "0.0.0.0" ? "127.0.0.1" : address.address;
		const openHost = host === "0.0.0.0" ? "127.0.0.1" : host;

		const serveURL = protocol + '://' + serveHost + ':' + address.port;
		const openURL = protocol + '://' + openHost + ':' + address.port;

		let serveURLs = [ serveURL ];
		if (LiveServer.logLevel > 2 && address.address === "0.0.0.0") {
			const ifaces = os.networkInterfaces();
			serveURLs = Object.keys(ifaces)
				.map(function(iface) {
					return ifaces[iface];
				})
				// flatten address data, use only IPv4
				.reduce(function(data, addresses) {
					addresses.filter(function(addr) {
						return addr.family === "IPv4";
					}).forEach(function(addr) {
						data.push(addr);
					});
					return data;
				}, [])
				.map(function(addr) {
					return protocol + "://" + addr.address + ":" + address.port;
				});
		}

		// Output
		if (LiveServer.logLevel >= 1) {
			if (serveURL === openURL)
				if (serveURLs.length === 1) {
					console.log(("Serving \"%s\" at %s").green, root, serveURLs[0]);
				} else {
					console.log(("Serving \"%s\" at\n\t%s").green, root, serveURLs.join("\n\t"));
				}
			else
				console.log(("Serving \"%s\" at %s (%s)").green, root, openURL, serveURL);
		}

	});

	// Setup server to listen at port
	server.listen(port, host);

	// WebSocket
	let clients = [];
	server.addListener('upgrade', function(request, socket, head) {
		const ws = new WebSocket(request, socket, head);
		ws.onopen = function() { ws.send('connected'); };

		ws.onclose = function() {
			clients = clients.filter(function (x) {
				return x !== ws;
			});
		};

		clients.push(ws);
	});

	let ignored = [
		function(testPath) { // Always ignore dotfiles (important e.g. because editor hidden temp files)
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
		clients.forEach(function(ws) {
			if (ws)
				ws.send('reload');
		});
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
};

LiveServer.shutdown = function() {
	const watcher = LiveServer.watcher;
	if (watcher) {
		watcher.close();
	}
	const server = LiveServer.server;
	if (server)
		server.close();
};

module.exports = LiveServer;
