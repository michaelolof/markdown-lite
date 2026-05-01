const MARKDOWN_EXTENSION_PATTERN = /\.md$/i;

function splitPathSegments(inputPath) {
	return inputPath
		.replace(/\\/g, '/')
		.split('/')
		.filter(segment => segment !== '' && segment !== '.');
}

export function normalizeMarkdownFilePath(inputPath) {
	if (typeof inputPath !== 'string' || inputPath.trim() === '') {
		throw new TypeError('Expected a non-empty markdown file path.');
	}

	const segments = [];
	for (const segment of splitPathSegments(inputPath.trim())) {
		if (segment === '..') {
			throw new Error(`Path traversal is not allowed: ${inputPath}`);
		}
		segments.push(segment);
	}

	if (!segments.length) {
		throw new Error(`Invalid markdown file path: ${inputPath}`);
	}

	const fileName = segments.at(-1);
	if (!MARKDOWN_EXTENSION_PATTERN.test(fileName)) {
		throw new Error(`Expected a markdown file path, received: ${inputPath}`);
	}

	return segments.join('/');
}

export function stripMarkdownExtension(fileName) {
	return fileName.replace(MARKDOWN_EXTENSION_PATTERN, '');
}

export function routePathFromFilePath(inputPath) {
	const normalizedPath = normalizeMarkdownFilePath(inputPath);
	const segments = normalizedPath.split('/');
	const fileName = stripMarkdownExtension(segments.pop());
	const encodedSegments = [...segments, fileName].map(segment => encodeURIComponent(segment));
	return `/${encodedSegments.join('/')}`;
}

export function createRouteEntry(filePath) {
	const normalizedFilePath = normalizeMarkdownFilePath(filePath);
	return {
		filePath: normalizedFilePath,
		routePath: routePathFromFilePath(normalizedFilePath),
	};
}

export function createRouteIndex(filePaths) {
	const entries = [];
	const entriesByRoutePath = new Map();
	const entriesByFilePath = new Map();

	for (const filePath of filePaths) {
		const entry = createRouteEntry(filePath);

		if (entriesByFilePath.has(entry.filePath)) {
			throw new Error(`Duplicate markdown file path: ${entry.filePath}`);
		}

		if (entriesByRoutePath.has(entry.routePath)) {
			const existingEntry = entriesByRoutePath.get(entry.routePath);
			throw new Error(
				`Route collision for ${entry.routePath}: ${existingEntry.filePath} and ${entry.filePath}`,
			);
		}

		entries.push(entry);
		entriesByFilePath.set(entry.filePath, entry);
		entriesByRoutePath.set(entry.routePath, entry);
	}

	entries.sort((left, right) => left.filePath.localeCompare(right.filePath));

	return {
		entries,
		entriesByFilePath,
		entriesByRoutePath,
	};
}