import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';

import { createRouteIndex, normalizeMarkdownFilePath } from './routes.mjs';

const MARKDOWN_EXTENSION_PATTERN = /\.md$/i;
const IGNORED_DIRECTORY_NAMES = new Set(['.git', '.github', 'node_modules']);

async function collectMarkdownFilePaths(rootDir, relativeDir = '') {
	const absoluteDir = path.join(rootDir, relativeDir);
	const dirents = await readdir(absoluteDir, { withFileTypes: true });
	dirents.sort((left, right) => left.name.localeCompare(right.name));

	const filePaths = [];
	for (const dirent of dirents) {
		if (dirent.isSymbolicLink()) {
			continue;
		}

		const relativePath = relativeDir
			? path.posix.join(relativeDir, dirent.name)
			: dirent.name;

		if (dirent.isDirectory()) {
			if (IGNORED_DIRECTORY_NAMES.has(dirent.name)) {
				continue;
			}
			filePaths.push(...await collectMarkdownFilePaths(rootDir, relativePath));
			continue;
		}

		if (dirent.isFile() && MARKDOWN_EXTENSION_PATTERN.test(dirent.name)) {
			filePaths.push(relativePath);
		}
	}

	return filePaths;
}

export async function buildDocsIndex(rootDir) {
	const filePaths = await collectMarkdownFilePaths(rootDir);
	return createRouteIndex(filePaths);
}

export function resolveMarkdownAbsolutePath(rootDir, filePath) {
	const normalizedFilePath = normalizeMarkdownFilePath(filePath);
	return path.join(rootDir, ...normalizedFilePath.split('/'));
}

export async function readMarkdownDocument(rootDir, filePath) {
	const absolutePath = resolveMarkdownAbsolutePath(rootDir, filePath);
	return readFile(absolutePath, 'utf8');
}