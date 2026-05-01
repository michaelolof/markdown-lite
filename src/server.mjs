import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { buildDocsIndex, readMarkdownDocument } from './lib/docs.mjs';
import { normalizeMarkdownFilePath } from './lib/routes.mjs';
import { createOpenFileWatchRegistry } from './lib/watch.mjs';

export const INTERNAL_BASE_PATH = '/__markdown_lite';
export const ROUTES_ENDPOINT = `${INTERNAL_BASE_PATH}/routes`;
export const CONTENT_PREFIX = `${INTERNAL_BASE_PATH}/content/`;
export const WATCH_ENDPOINT = `${INTERNAL_BASE_PATH}/watch`;

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_VIEWER_DIR = path.resolve(MODULE_DIR, '../dist/viewer');

function sendResponse(response, statusCode, headers, body, method) {
	response.writeHead(statusCode, headers);
	if (method === 'HEAD') {
		response.end();
		return;
	}
	response.end(body);
}

function sendJson(response, statusCode, payload, method) {
	sendResponse(
		response,
		statusCode,
		{
			'content-type': 'application/json; charset=utf-8',
			'cache-control': 'no-cache',
		},
		JSON.stringify(payload, null, 2),
		method,
	);
}

function sendText(response, statusCode, body, method, contentType = 'text/plain; charset=utf-8') {
	sendResponse(
		response,
		statusCode,
		{
			'content-type': contentType,
			'cache-control': 'no-cache',
		},
		body,
		method,
	);
}

function getContentType(filePath) {
	const extension = path.extname(filePath).toLowerCase();
	switch (extension) {
		case '.css':
			return 'text/css; charset=utf-8';
		case '.html':
			return 'text/html; charset=utf-8';
		case '.js':
		case '.mjs':
			return 'text/javascript; charset=utf-8';
		case '.json':
			return 'application/json; charset=utf-8';
		case '.map':
			return 'application/json; charset=utf-8';
		case '.svg':
			return 'image/svg+xml';
		default:
			return 'application/octet-stream';
	}
}

function resolveViewerAssetPath(viewerDir, assetPathname) {
	const absoluteViewerDir = path.resolve(viewerDir);
	const relativePath = assetPathname.replace(/^\/+/, '');
	const absolutePath = path.resolve(absoluteViewerDir, relativePath);

	if (!absolutePath.startsWith(`${absoluteViewerDir}${path.sep}`)) {
		throw new Error(`Invalid viewer asset path: ${assetPathname}`);
	}

	return absolutePath;
}

function createContentUrl(filePath) {
	return `${CONTENT_PREFIX}${encodeURIComponent(filePath)}`;
}

function createWatchUrl(filePath) {
	return `${WATCH_ENDPOINT}?file=${encodeURIComponent(filePath)}`;
}

function createRoutesPayload(title, entries) {
	return {
		title,
		entries: entries.map(entry => ({
			filePath: entry.filePath,
			routePath: entry.routePath,
			contentUrl: createContentUrl(entry.filePath),
			sourceUrl: createContentUrl(entry.filePath),
			watchUrl: createWatchUrl(entry.filePath),
		})),
	};
}

function sendSseEvent(response, event, payload) {
	response.write(`event: ${event}\n`);
	response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function serveViewerShell(response, viewerDir, method) {
	const shell = await readFile(path.join(viewerDir, 'index.html'));
	sendResponse(
		response,
		200,
		{
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'no-cache',
		},
		shell,
		method,
	);
}

async function serveViewerAsset(response, viewerDir, pathname, method) {
	const relativeAssetPath = pathname.slice(INTERNAL_BASE_PATH.length);
	if (!relativeAssetPath || relativeAssetPath === '/') {
		sendText(response, 404, 'Viewer asset not found.', method);
		return;
	}

	const absoluteAssetPath = resolveViewerAssetPath(viewerDir, relativeAssetPath);
	const asset = await readFile(absoluteAssetPath);
	const cacheControl = absoluteAssetPath.includes(`${path.sep}assets${path.sep}`)
		? 'public, max-age=31536000, immutable'
		: 'no-cache';

	sendResponse(
		response,
		200,
		{
			'content-type': getContentType(absoluteAssetPath),
			'cache-control': cacheControl,
		},
		asset,
		method,
	);
}

async function serveRoutes(response, rootDir, title, method) {
	const { entries } = await buildDocsIndex(rootDir);
	sendJson(response, 200, createRoutesPayload(title, entries), method);
}

async function serveContent(response, rootDir, pathname, method) {
	const encodedFilePath = pathname.slice(CONTENT_PREFIX.length);
	if (!encodedFilePath) {
		sendText(response, 400, 'Missing markdown document path.', method);
		return;
	}

	const requestedFilePath = decodeURIComponent(encodedFilePath);
	const docsIndex = await buildDocsIndex(rootDir);
	if (!docsIndex.entriesByFilePath.has(requestedFilePath)) {
		sendText(response, 404, `Markdown document not found: ${requestedFilePath}`, method);
		return;
	}

	const markdown = await readMarkdownDocument(rootDir, requestedFilePath);
	sendText(response, 200, markdown, method, 'text/markdown; charset=utf-8');
}

async function serveWatch(request, response, rootDir, method, url, watchRegistry) {
	const headers = {
		'content-type': 'text/event-stream; charset=utf-8',
		'cache-control': 'no-cache, no-transform',
		connection: 'keep-alive',
	};

	if (method === 'HEAD') {
		sendResponse(response, 200, headers, '', method);
		return;
	}

	const requestedFilePath = url.searchParams.get('file');
	if (!requestedFilePath) {
		sendText(response, 400, 'Missing markdown file path to watch.', method);
		return;
	}

	const normalizedFilePath = normalizeMarkdownFilePath(requestedFilePath);
	const docsIndex = await buildDocsIndex(rootDir);
	if (!docsIndex.entriesByFilePath.has(normalizedFilePath)) {
		sendText(response, 404, `Markdown document not found: ${normalizedFilePath}`, method);
		return;
	}

	response.writeHead(200, headers);
	if (typeof response.flushHeaders === 'function') {
		response.flushHeaders();
	}

	const unsubscribe = await watchRegistry.subscribe(normalizedFilePath, message => {
		if (response.destroyed || response.writableEnded) {
			return;
		}
		sendSseEvent(response, message.event, message.payload);
	});

	sendSseEvent(response, 'ready', { filePath: normalizedFilePath });

	const heartbeat = setInterval(() => {
		if (response.destroyed || response.writableEnded) {
			return;
		}
		response.write(': heartbeat\n\n');
	}, 15000);

	let cleanedUp = false;
	const cleanup = () => {
		if (cleanedUp) {
			return;
		}
		cleanedUp = true;
		clearInterval(heartbeat);
		unsubscribe();
		if (!response.writableEnded) {
			response.end();
		}
	};

	request.on('close', cleanup);
	request.on('aborted', cleanup);
	response.on('close', cleanup);
}

export async function ensureViewerBuild(viewerDir = DEFAULT_VIEWER_DIR) {
	try {
		await readFile(path.join(viewerDir, 'index.html'));
	} catch (error) {
		throw new Error(`Viewer build not found at ${viewerDir}. Run "pnpm build" before starting the server.`);
	}
}

async function handleRequest(request, response, options) {
	const method = request.method ?? 'GET';
	if (method !== 'GET' && method !== 'HEAD') {
		sendText(response, 405, `Method not allowed: ${method}`, method);
		return;
	}

	const url = new URL(request.url ?? '/', 'http://127.0.0.1');
	const pathname = url.pathname;

	if (pathname === ROUTES_ENDPOINT) {
		await serveRoutes(response, options.rootDir, options.title, method);
		return;
	}

	if (pathname === WATCH_ENDPOINT) {
		await serveWatch(request, response, options.rootDir, method, url, options.watchRegistry);
		return;
	}

	if (pathname.startsWith(CONTENT_PREFIX)) {
		await serveContent(response, options.rootDir, pathname, method);
		return;
	}

	if (pathname.startsWith(`${INTERNAL_BASE_PATH}/`)) {
		await serveViewerAsset(response, options.viewerDir, pathname, method);
		return;
	}

	await serveViewerShell(response, options.viewerDir, method);
}

export function createMarkdownLiteServer({ rootDir, title, viewerDir = DEFAULT_VIEWER_DIR }) {
	const watchRegistry = createOpenFileWatchRegistry({ rootDir });
	const server = http.createServer((request, response) => {
		void handleRequest(request, response, { rootDir, title, viewerDir, watchRegistry }).catch(error => {
			sendText(response, 500, error.stack || error.message, request.method ?? 'GET');
		});
	});

	server.on('close', () => {
		watchRegistry.close();
	});

	return server;
}

export async function startMarkdownLiteServer({
	rootDir,
	title,
	viewerDir = DEFAULT_VIEWER_DIR,
	host = '127.0.0.1',
	port = 6450,
}) {
	await ensureViewerBuild(viewerDir);

	const server = createMarkdownLiteServer({ rootDir, title, viewerDir });
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, host, () => {
			server.off('error', reject);
			resolve();
		});
	});

	const address = server.address();
	const actualPort = typeof address === 'object' && address ? address.port : port;
	const publicHost = host === '0.0.0.0' ? '127.0.0.1' : host;

	return {
		server,
		host,
		port: actualPort,
		url: `http://${publicHost}:${actualPort}`,
	};
}