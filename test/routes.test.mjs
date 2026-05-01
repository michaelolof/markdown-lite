import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createRouteIndex,
	normalizeMarkdownFilePath,
	routePathFromFilePath,
} from '../src/lib/routes.mjs';

test('normalizes markdown file paths', () => {
	assert.equal(normalizeMarkdownFilePath('./guides\\Getting Started.md'), 'guides/Getting Started.md');
});

test('creates clean route paths from markdown files', () => {
	assert.equal(routePathFromFilePath('setup.md'), '/setup');
	assert.equal(routePathFromFilePath('guides/Getting Started.md'), '/guides/Getting%20Started');
	assert.equal(routePathFromFilePath('skills/weird #? name [v2].md'), '/skills/weird%20%23%3F%20name%20%5Bv2%5D');
	assert.equal(routePathFromFilePath('notes/uber cafe.md'), '/notes/uber%20cafe');
	assert.equal(routePathFromFilePath('notes/umlaut ü.md'), '/notes/umlaut%20%C3%BC');
});

test('keeps percent-like filenames distinct from decoded spaces', () => {
	const { entriesByRoutePath } = createRouteIndex(['docs/a b.md', 'docs/a%20b.md']);
	assert.equal(entriesByRoutePath.get('/docs/a%20b').filePath, 'docs/a b.md');
	assert.equal(entriesByRoutePath.get('/docs/a%2520b').filePath, 'docs/a%20b.md');
});

test('rejects path traversal', () => {
	assert.throws(() => normalizeMarkdownFilePath('../secret.md'), /Path traversal is not allowed/);
});

test('rejects route collisions from duplicate normalized paths', () => {
	assert.throws(() => createRouteIndex(['faq.md', './faq.md']), /Duplicate markdown file path/);
});