import assert from 'node:assert/strict';
import { mkdtemp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { isExecutedDirectly, parseArgs, resolveConfiguredPort } from '../src/cli.mjs';

test('uses the default port when no override is provided', () => {
	assert.equal(resolveConfiguredPort({}), 6450);
});

test('prefers MARKDOWN_SERVE_PORT over PORT', () => {
	assert.equal(resolveConfiguredPort({ MARKDOWN_SERVE_PORT: '7100', PORT: '7200' }), 7100);
});

test('uses PORT when MARKDOWN_SERVE_PORT is not set', () => {
	assert.equal(resolveConfiguredPort({ PORT: '7300' }), 7300);
});

test('prefers the CLI port flag over environment values', () => {
	const options = parseArgs(['docs', '--port', '7400'], { MARKDOWN_SERVE_PORT: '7100', PORT: '7200' });
	assert.equal(options.rootDir, 'docs');
	assert.equal(options.port, 7400);
});

test('rejects invalid environment port values', () => {
	assert.throws(() => resolveConfiguredPort({ PORT: 'nope' }), /Invalid PORT/);
});

test('treats a symlinked cli path as direct execution', async () => {
	const fixtureDir = await mkdtemp(path.join(tmpdir(), 'markdown-serve-cli-'));
	const cliPath = path.resolve('src/cli.mjs');
	const symlinkPath = path.join(fixtureDir, 'markdown-serve');
	await symlink(cliPath, symlinkPath);

	assert.equal(
		isExecutedDirectly(pathToFileURL(cliPath).href, symlinkPath),
		true,
	);
});