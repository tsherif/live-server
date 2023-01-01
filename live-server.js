#!/usr/bin/env node
var path = require('path');
var fs = require('fs');
var liveServer = require("./index");

var opts = {
	host: process.env.IP,
	port: process.env.PORT,
	open: true,
	logLevel: 2,
	poll: false
};

var homeDir = process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'];
var configPath = path.join(homeDir, '.live-server.json');
if (fs.existsSync(configPath)) {
	var userConfig = fs.readFileSync(configPath, 'utf8');
	Object.assign(opts, JSON.parse(userConfig));
	if (opts.ignorePattern) opts.ignorePattern = new RegExp(opts.ignorePattern);
}

for (var i = process.argv.length - 1; i >= 2; --i) {
	var arg = process.argv[i];
	if (arg.indexOf("--port=") > -1) {
		var portString = arg.substring(7);
		var portNumber = parseInt(portString, 10);
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
	else if (arg.indexOf("--wait=") > -1) {
		var waitString = arg.substring(7);
		var waitNumber = parseInt(waitString, 10);
		if (waitNumber === +waitString) {
			opts.wait = waitNumber;
			process.argv.splice(i, 1);
		}
	}
	else if (arg === "--version" || arg === "-v") {
		var packageJson = require('./package.json');
		console.log(packageJson.name, packageJson.version);
		process.exit();
	}
	else if (arg === "--poll") {
		opts.poll = true;
		process.argv.splice(i, 1);
	}
	else if (arg === "--help" || arg === "-h") {
		console.log('Usage: live-server [-v|--version] [-h|--help] [-q|--quiet] [--port=PORT] [--host=HOST] [--open=PATH] [--no-browser] [--browser=BROWSER] [--ignore=PATH] [--ignorePattern=RGXP] [--no-css-inject] [--entry-file=PATH] [--spa] [--mount=ROUTE:PATH] [--wait=MILLISECONDS] [--htpasswd=PATH] [--cors] [--https=PATH] [--https-module=MODULE_NAME] [--proxy=PATH] [--poll] [PATH]');
		process.exit();
	}
	else if (arg === "--test") {
		// Hidden param for tests to exit automatically
		setTimeout(liveServer.shutdown, 500);
		process.argv.splice(i, 1);
	}
}

// Patch paths
var dir = opts.root = process.argv[2] || "";

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
