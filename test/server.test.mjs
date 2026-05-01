import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createMarkdownServeServer, INTERNAL_BASE_PATH } from '../src/server.mjs';

const docsRoot = path.resolve('test/fixtures/basic-docs');
const viewerDir = path.resolve('test/fixtures/viewer');

async function startFixtureServer({ rootDir = docsRoot } = {}) {
	const server = createMarkdownServeServer({
		rootDir,
		title: 'Fixture Docs',
		viewerDir,
	});

	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve();
		});
	});

	const address = server.address();
	return {
		server,
		baseUrl: `http://127.0.0.1:${address.port}`,
	};
}

async function stopFixtureServer(server) {
	await new Promise(resolve => server.close(resolve));
}

async function createTempDocsFixture(files) {
	const rootDir = await mkdtemp(path.join(tmpdir(), 'markdown-serve-watch-'));
	for (const [filePath, content] of Object.entries(files)) {
		const absoluteFilePath = path.join(rootDir, filePath);
		await mkdir(path.dirname(absoluteFilePath), { recursive: true });
		await writeFile(absoluteFilePath, content, 'utf8');
	}
	return rootDir;
}

function createSseReader(stream) {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	return {
		async readEvent(timeoutMs = 3000) {
			const deadline = Date.now() + timeoutMs;
			while (true) {
				const timeout = Math.max(1, deadline - Date.now());
				const result = await Promise.race([
					reader.read(),
					new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for SSE event.')), timeout)),
				]);

				if (result.done) {
					throw new Error('SSE stream closed unexpectedly.');
				}

				buffer += decoder.decode(result.value, { stream: true });
				const boundaryIndex = buffer.indexOf('\n\n');
				if (boundaryIndex === -1) {
					continue;
				}

				const rawEvent = buffer.slice(0, boundaryIndex);
				buffer = buffer.slice(boundaryIndex + 2);

				let eventName = 'message';
				let eventData = '';
				for (const line of rawEvent.split('\n')) {
					if (!line || line.startsWith(':')) {
						continue;
					}
					if (line.startsWith('event:')) {
						eventName = line.slice('event:'.length).trim();
					}
					if (line.startsWith('data:')) {
						eventData += line.slice('data:'.length).trim();
					}
				}

				if (eventName === 'message' && eventData === '') {
					continue;
				}

				return {
					event: eventName,
					data: eventData ? JSON.parse(eventData) : null,
				};
			}
		},

		async close() {
			await reader.cancel();
		},
	};
}

test('serves the clean route manifest with encoded pathname routes', async context => {
	const { server, baseUrl } = await startFixtureServer();
	context.after(() => stopFixtureServer(server));

	const response = await fetch(`${baseUrl}${INTERNAL_BASE_PATH}/routes`);
	assert.equal(response.status, 200);

	const payload = await response.json();
	assert.equal(payload.title, 'Fixture Docs');
	assert.ok(payload.entries.some(entry => entry.routePath === '/guides/Getting%20Started'));
	assert.ok(payload.entries.some(entry => entry.routePath === '/views/Included'));

	const weirdEntry = payload.entries.find(entry => entry.filePath === 'weird/naïve #topic%.md');
	assert.equal(weirdEntry.routePath, '/weird/na%C3%AFve%20%23topic%25');
	assert.equal(weirdEntry.contentUrl, '/__markdown_serve/content/weird%2Fna%C3%AFve%20%23topic%25.md');
	assert.equal(weirdEntry.watchUrl, '/__markdown_serve/watch?file=weird%2Fna%C3%AFve%20%23topic%25.md');
});

test('serves markdown content through the internal content endpoint', async context => {
	const { server, baseUrl } = await startFixtureServer();
	context.after(() => stopFixtureServer(server));

	const response = await fetch(`${baseUrl}${INTERNAL_BASE_PATH}/content/guides%2FGetting%20Started.md`);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('content-type'), 'text/markdown; charset=utf-8');

	const body = await response.text();
	assert.match(body, /# Getting Started/);
	assert.match(body, /\[FAQ\]\(\.\.\/FAQ\.md\)/);
});

test('serves the viewer shell for clean document routes', async context => {
	const { server, baseUrl } = await startFixtureServer();
	context.after(() => stopFixtureServer(server));

	const response = await fetch(`${baseUrl}/guides/Getting%20Started`);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');

	const body = await response.text();
	assert.match(body, /Fixture viewer shell/);
	assert.doesNotMatch(body, /\?doc=/);
});

test('streams a change event for the watched open file', async context => {
	const tempDocsRoot = await createTempDocsFixture({
		'watched.md': '# Before\n',
	});
	context.after(() => rm(tempDocsRoot, { recursive: true, force: true }));

	const { server, baseUrl } = await startFixtureServer({ rootDir: tempDocsRoot });

	const response = await fetch(`${baseUrl}${INTERNAL_BASE_PATH}/watch?file=${encodeURIComponent('watched.md')}`);
	assert.equal(response.status, 200);

	const sseReader = createSseReader(response.body);
	context.after(async () => {
		await sseReader.close();
		await stopFixtureServer(server);
	});

	const ready = await sseReader.readEvent();
	assert.equal(ready.event, 'ready');
	assert.deepEqual(ready.data, { filePath: 'watched.md' });

	await writeFile(path.join(tempDocsRoot, 'watched.md'), '# After\n', 'utf8');

	const changed = await sseReader.readEvent();
	assert.equal(changed.event, 'changed');
	assert.deepEqual(changed.data, { filePath: 'watched.md' });
});

test('streams a missing event when the watched open file disappears', async context => {
	const tempDocsRoot = await createTempDocsFixture({
		'watched.md': '# Before\n',
	});
	context.after(() => rm(tempDocsRoot, { recursive: true, force: true }));

	const { server, baseUrl } = await startFixtureServer({ rootDir: tempDocsRoot });

	const response = await fetch(`${baseUrl}${INTERNAL_BASE_PATH}/watch?file=${encodeURIComponent('watched.md')}`);
	assert.equal(response.status, 200);

	const sseReader = createSseReader(response.body);
	context.after(async () => {
		await sseReader.close();
		await stopFixtureServer(server);
	});

	await sseReader.readEvent();
	await unlink(path.join(tempDocsRoot, 'watched.md'));

	const missing = await sseReader.readEvent();
	assert.equal(missing.event, 'missing');
	assert.deepEqual(missing.data, { filePath: 'watched.md' });
});