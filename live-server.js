#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path = require("path");
const index_1 = require("./index");
const opts = {
    port: 8080,
    logLevel: 2,
    poll: false,
};
let ignorePaths = [];
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
        ignorePaths = arg.substring(9).split(",");
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
        console.log("Usage: live-server [-v|--version] [-h|--help] [-q|--quiet] [--port=PORT] [--ignore=PATH] [--poll] [PATH]");
        process.exit();
    }
}
// Patch paths
const dir = opts.root = process.argv[2] || "";
if (opts.watch) {
    opts.watch = opts.watch.map((relativePath) => path.join(dir, relativePath));
}
if (opts.ignore) {
    opts.ignore = ignorePaths.map((relativePath) => path.join(dir, relativePath));
}
index_1.LiveServer.start(opts);
