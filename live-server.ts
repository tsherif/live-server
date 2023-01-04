#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const liveServer = require("./index");

import type { LiveServerOptions } from "./index";


const opts: LiveServerOptions = {
	host: process.env.IP ?? "0.0.0.0",
	port: 8080,
	logLevel: 2,
	poll: false,
	root: process.argv[2] || ""
};

const homeDir = process.env[(process.platform === "win32") ? "USERPROFILE" : "HOME"];
const configPath = path.join(homeDir, ".live-server.json");
if (fs.existsSync(configPath)) {
	const userConfig = fs.readFileSync(configPath, "utf8");
	Object.assign(opts, JSON.parse(userConfig));
}

for (let i = process.argv.length - 1; i >= 2; --i) {
	const arg = process.argv[i];
	if (arg.indexOf("--port=") > -1) {
		const portString = arg.substring(7);
		const portNumber = parseInt(portString, 10);
		if (portNumber === +portString) {
			opts.port = portNumber;
			process.argv.splice(i, 1);
		}
	}
	else if (arg.indexOf("--watch=") > -1) {
		// Will be modified later when cwd is known
		opts.watch = arg.substring(8).split(",");
		process.argv.splice(i, 1);
	}
	else if (arg.indexOf("--ignore=") > -1) {
		// Will be modified later when cwd is known
		opts.ignore = arg.substring(9).split(",");
		process.argv.splice(i, 1);
	}
	else if (arg === "--quiet" || arg === "-q") {
		opts.logLevel = 0;
		process.argv.splice(i, 1);
	}
	else if (arg === "--verbose" || arg === "-V") {
		opts.logLevel = 3;
		process.argv.splice(i, 1);
	}
	else if (arg === "--version" || arg === "-v") {
		const packageJson = require("./package.json");
		console.log(packageJson.name, packageJson.version);
		process.exit();
	}
	else if (arg === "--poll") {
		opts.poll = true;
		process.argv.splice(i, 1);
	}
	else if (arg === "--help" || arg === "-h") {
		console.log("Usage: live-server [-v|--version] [-h|--help] [-q|--quiet] [--port=PORT] [--host=HOST] [--open=PATH] [--no-browser] [--browser=BROWSER] [--ignore=PATH] [--ignorePattern=RGXP] [--no-css-inject] [--entry-file=PATH] [--spa] [--mount=ROUTE:PATH] [--wait=MILLISECONDS] [--htpasswd=PATH] [--cors] [--https=PATH] [--https-module=MODULE_NAME] [--proxy=PATH] [--poll] [PATH]");
		process.exit();
	}
}

// Patch paths
const dir = opts.root = process.argv[2] || "";

if (opts.watch) {
	opts.watch = opts.watch.map(function(relativePath) {
		return path.join(dir, relativePath);
	});
}
if (opts.ignore) {
	opts.ignore = opts.ignore.map(function(relativePath) {
		return path.join(dir, relativePath);
	});
}

liveServer.start(opts);
