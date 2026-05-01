import assert from 'node:assert/strict';
import test from 'node:test';

import {
	buildDocsIndex,
	createMarkdownServeServer,
	routePathFromFilePath,
	startMarkdownServeServer,
} from '../src/index.mjs';

test('exports the public package api from the root entry', () => {
	assert.equal(typeof createMarkdownServeServer, 'function');
	assert.equal(typeof startMarkdownServeServer, 'function');
	assert.equal(typeof buildDocsIndex, 'function');
	assert.equal(routePathFromFilePath('guides/Getting Started.md'), '/guides/Getting%20Started');
});