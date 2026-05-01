import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildDocsIndex,
	createMarkdownLiteServer,
	routePathFromFilePath,
	startMarkdownLiteServer,
} from '../src/index.mjs';

test('exports the public package api from the root entry', () => {
	assert.equal(typeof createMarkdownLiteServer, 'function');
	assert.equal(typeof startMarkdownLiteServer, 'function');
	assert.equal(typeof buildDocsIndex, 'function');
	assert.equal(routePathFromFilePath('guides/Getting Started.md'), '/guides/Getting%20Started');
});