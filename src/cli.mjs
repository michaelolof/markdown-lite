#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { startMarkdownServeServer } from './server.mjs';

const DEFAULT_PORT = 6450;
const DEFAULT_HOST = '127.0.0.1';

function printHelp() {
	console.log(`markdown-serve [directory] [options]

Serve a directory of markdown files with clean pathname routing.

Options:
	--port <number>   Port to listen on (default: ${DEFAULT_PORT}; env: MARKDOWN_SERVE_PORT or PORT)
  --host <address>  Host interface to bind (default: ${DEFAULT_HOST})
  --title <text>    Override the viewer title
  --open            Open the viewer in the default browser
  --help            Show this help message`);
}

function parsePortNumber(value, source) {
	const parsedPort = Number.parseInt(value, 10);
	if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
		throw new Error(`Invalid ${source}: ${value}`);
	}
	return parsedPort;
}

export function resolveConfiguredPort(env = process.env) {
	if (env.MARKDOWN_SERVE_PORT !== undefined) {
		return parsePortNumber(env.MARKDOWN_SERVE_PORT, 'MARKDOWN_SERVE_PORT');
	}

	if (env.PORT !== undefined) {
		return parsePortNumber(env.PORT, 'PORT');
	}

	return DEFAULT_PORT;
}

function takeOptionValue(argv, index, inlineValue) {
	if (inlineValue !== undefined) {
		return { value: inlineValue, nextIndex: index };
	}

	const value = argv[index + 1];
	if (!value) {
		throw new Error(`Missing value for ${argv[index]}`);
	}

	return { value, nextIndex: index + 1 };
}

export function parseArgs(argv, env = process.env) {
	const options = {
		rootDir: '.',
		host: DEFAULT_HOST,
		port: resolveConfiguredPort(env),
		title: '',
		open: false,
		help: false,
	};

	let sawRootDir = false;
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];

		if (token === '--help' || token === '-h') {
			options.help = true;
			continue;
		}

		if (token === '--open') {
			options.open = true;
			continue;
		}

		if (token.startsWith('--port')) {
			const inlineValue = token.includes('=') ? token.split('=')[1] : undefined;
			const { value, nextIndex } = takeOptionValue(argv, index, inlineValue);
			options.port = parsePortNumber(value, '--port');
			index = nextIndex;
			continue;
		}

		if (token.startsWith('--host')) {
			const inlineValue = token.includes('=') ? token.split('=')[1] : undefined;
			const { value, nextIndex } = takeOptionValue(argv, index, inlineValue);
			options.host = value;
			index = nextIndex;
			continue;
		}

		if (token.startsWith('--title')) {
			const inlineValue = token.includes('=') ? token.split('=')[1] : undefined;
			const { value, nextIndex } = takeOptionValue(argv, index, inlineValue);
			options.title = value;
			index = nextIndex;
			continue;
		}

		if (token.startsWith('-')) {
			throw new Error(`Unknown option: ${token}`);
		}

		if (sawRootDir) {
			throw new Error(`Unexpected argument: ${token}`);
		}

		options.rootDir = token;
		sawRootDir = true;
	}

	return options;
}

function openInBrowser(url) {
	let command;
	let args;

	if (process.platform === 'darwin') {
		command = 'open';
		args = [url];
	} else if (process.platform === 'win32') {
		command = 'cmd';
		args = ['/c', 'start', '', url];
	} else {
		command = 'xdg-open';
		args = [url];
	}

	const child = spawn(command, args, {
		stdio: 'ignore',
		detached: true,
	});
	child.unref();
}

export async function main(argv = process.argv.slice(2), env = process.env) {
	const options = parseArgs(argv, env);
	if (options.help) {
		printHelp();
		return;
	}

	const rootDir = path.resolve(process.cwd(), options.rootDir);
	const title = options.title || path.basename(rootDir) || 'Markdown Serve';
	const { server, url } = await startMarkdownServeServer({
		rootDir,
		host: options.host,
		port: options.port,
		title,
	});

	console.log(`Serving ${rootDir}`);
	console.log(url);

	if (options.open) {
		try {
			openInBrowser(url);
		} catch (error) {
			console.error(`Could not open browser: ${error.message}`);
		}
	}

	const shutdown = signal => {
		server.close(() => {
			if (signal) {
				process.exit(0);
			}
		});
	};

	process.on('SIGINT', () => shutdown('SIGINT'));
	process.on('SIGTERM', () => shutdown('SIGTERM'));
}

export function isExecutedDirectly(importMetaUrl, argvEntry = process.argv[1]) {
	if (!argvEntry) {
		return false;
	}

	try {
		return importMetaUrl === pathToFileURL(realpathSync(path.resolve(argvEntry))).href;
	} catch {
		return false;
	}
}

const shouldRunCli = isExecutedDirectly(import.meta.url);

if (shouldRunCli) {
	main().catch(error => {
		console.error(error.message);
		process.exit(1);
	});
}