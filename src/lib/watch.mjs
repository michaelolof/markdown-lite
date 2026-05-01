import chokidar from 'chokidar';

import { resolveMarkdownAbsolutePath } from './docs.mjs';
import { normalizeMarkdownFilePath } from './routes.mjs';

const DEFAULT_WATCH_DEBOUNCE_MS = 120;

function notifyClients(entry, event, payload) {
	for (const listener of entry.listeners) {
		listener({ event, payload });
	}
}

function scheduleNotification(entry, event, payload, debounceMs) {
	clearTimeout(entry.debounceTimer);
	entry.debounceTimer = setTimeout(() => {
		notifyClients(entry, event, payload);
	}, debounceMs);
}

function closeEntry(watchEntries, filePath, entry) {
	clearTimeout(entry.debounceTimer);
	entry.debounceTimer = undefined;
	watchEntries.delete(filePath);
	void entry.watcher.close();
}

export function createOpenFileWatchRegistry({ rootDir, debounceMs = DEFAULT_WATCH_DEBOUNCE_MS }) {
	const watchEntries = new Map();

	function getOrCreateEntry(filePath) {
		const normalizedFilePath = normalizeMarkdownFilePath(filePath);
		const existingEntry = watchEntries.get(normalizedFilePath);
		if (existingEntry) {
			return existingEntry;
		}

		const absoluteFilePath = resolveMarkdownAbsolutePath(rootDir, normalizedFilePath);
		const entry = {
			filePath: normalizedFilePath,
			listeners: new Set(),
			debounceTimer: undefined,
			watcher: chokidar.watch(absoluteFilePath, {
				ignoreInitial: true,
				awaitWriteFinish: {
					stabilityThreshold: debounceMs,
					pollInterval: 20,
				},
			}),
		};

		entry.ready = new Promise(resolve => {
			entry.watcher.once('ready', resolve);
		});

		entry.watcher.on('add', () => {
			scheduleNotification(entry, 'changed', { filePath: entry.filePath }, debounceMs);
		});

		entry.watcher.on('change', () => {
			scheduleNotification(entry, 'changed', { filePath: entry.filePath }, debounceMs);
		});

		entry.watcher.on('unlink', () => {
			scheduleNotification(entry, 'missing', { filePath: entry.filePath }, debounceMs);
		});

		entry.watcher.on('error', error => {
			notifyClients(entry, 'error', {
				filePath: entry.filePath,
				message: error.message,
			});
		});

		watchEntries.set(normalizedFilePath, entry);
		return entry;
	}

	return {
		async subscribe(filePath, listener) {
			const entry = getOrCreateEntry(filePath);
			entry.listeners.add(listener);
			await entry.ready;

			return () => {
				entry.listeners.delete(listener);
				if (!entry.listeners.size) {
					closeEntry(watchEntries, entry.filePath, entry);
				}
			};
		},

		close() {
			for (const [filePath, entry] of watchEntries) {
				closeEntry(watchEntries, filePath, entry);
			}
		},
	};
}