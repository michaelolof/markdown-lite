import './styles.css';
import 'highlight.js/styles/atom-one-dark.css';

import hljs from 'highlight.js';
import { marked } from 'marked';
import mermaid from 'mermaid';

const API_BASE = '/__markdown_lite';
const ROUTES_ENDPOINT = `${API_BASE}/routes`;

const treeEl = document.getElementById('tree');
const legendEl = document.getElementById('legend');
const legendEmptyEl = document.getElementById('legend-empty');
const layoutEl = document.getElementById('layout');
const mainEl = document.getElementById('main');
const breadcrumbEl = document.getElementById('breadcrumb');
const sourceLinkEl = document.getElementById('source-link');
const searchEl = document.getElementById('search');
const sidebarEl = document.getElementById('sidebar');
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
const sidebarNarrowBtn = document.getElementById('sidebar-narrow-btn');
const sidebarWideBtn = document.getElementById('sidebar-wide-btn');
const sidebarResizer = document.getElementById('sidebar-resizer');
const sidebarTabs = [...document.querySelectorAll('.sidebar__tab')];
const overlayEl = document.getElementById('overlay');
const menuBtn = document.getElementById('menu-btn');
const welcomeEl = document.getElementById('welcome');
const welcomeGridEl = document.getElementById('welcome-grid');
const welcomeHeadingEl = document.getElementById('welcome-heading');
const brandNameEl = document.getElementById('brand-name');
const scrollTopBtn = document.getElementById('scroll-top-btn');
const scrollBottomBtn = document.getElementById('scroll-bottom-btn');
const contentSearchInput = document.getElementById('content-search');
const contentSearchCount = document.getElementById('content-search-count');
const contentPrevBtn = document.getElementById('content-prev-btn');
const contentNextBtn = document.getElementById('content-next-btn');

let currentDocEntry = null;
let headingSlugCounts = new Map();
let currentSearchMatches = [];
let currentSearchIndex = -1;
let isDesktopSidebarCollapsed = false;
let sidebarWidth = 272;
let activeSidebarPanel = 'tree';
let docsTitle = 'Markdown Lite';
let docsEntries = [];
let docsEntriesByFilePath = new Map();
let docsEntriesByRoutePath = new Map();
let currentDocWatchSource = null;
let currentWatchedFilePath = '';
let currentLoadRequestId = 0;

const SIDEBAR_STORAGE_KEY = 'markdown-lite-sidebar-width';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'markdown-lite-sidebar-collapsed';
const SIDEBAR_TREE_FILTER_STORAGE_KEY = 'markdown-lite-sidebar-tree-filter';
const SIDEBAR_LEGEND_FILTER_STORAGE_KEY = 'markdown-lite-sidebar-legend-filter';
const SIDEBAR_PANEL_STORAGE_KEY = 'markdown-lite-sidebar-panel';
const CONTENT_SEARCH_STORAGE_KEY = 'markdown-lite-content-search';
const CONTENT_SEARCH_QUERY_PARAM = 'q';
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_WIDTH_STEP = 28;

function isMobileViewport() {
	return window.matchMedia('(max-width: 800px)').matches;
}

function clampSidebarWidth(width) {
	return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));
}

function normalizeHash(hash = '') {
	if (!hash) {
		return '';
	}

	return hash.startsWith('#') ? hash : `#${hash}`;
}

function normalizeRoutePath(pathname) {
	if (!pathname || pathname === '/' || pathname === '/index.html') {
		return '/';
	}

	return pathname.endsWith('/') ? pathname.replace(/\/+$/, '') || '/' : pathname;
}

function safeDecodeURIComponent(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function getArticle() {
	return mainEl.querySelector('.markdown-body');
}

function getCurrentDocPath() {
	return currentDocEntry?.filePath || '';
}

function closeCurrentFileWatch() {
	if (!currentDocWatchSource) {
		currentWatchedFilePath = '';
		return;
	}

	currentDocWatchSource.close();
	currentDocWatchSource = null;
	currentWatchedFilePath = '';
}

function syncCurrentFileWatch(entry) {
	const nextWatchUrl = entry?.watchUrl || '';
	const nextFilePath = entry?.filePath || '';

	if (!nextWatchUrl) {
		closeCurrentFileWatch();
		return;
	}

	if (currentDocWatchSource && currentWatchedFilePath === nextFilePath) {
		return;
	}

	closeCurrentFileWatch();

	const watchSource = new EventSource(nextWatchUrl);
	currentDocWatchSource = watchSource;
	currentWatchedFilePath = nextFilePath;

	watchSource.addEventListener('changed', () => {
		if (currentDocEntry?.filePath !== entry.filePath) {
			return;
		}
		void loadFile(entry, { preserveScroll: true });
	});

	watchSource.addEventListener('missing', () => {
		if (currentDocEntry?.filePath !== entry.filePath) {
			return;
		}
		renderWatchedFileMissingState(entry);
	});

	watchSource.addEventListener('error', () => {
		if (watchSource.readyState === EventSource.CLOSED && currentDocWatchSource === watchSource) {
			currentDocWatchSource = null;
			currentWatchedFilePath = '';
		}
	});
}

function updatePageTitle() {
	const label = currentDocEntry ? `${fileLabel(currentDocEntry.filePath)} · ${docsTitle}` : docsTitle;
	document.title = label;
}

function applyViewerTitle(title) {
	docsTitle = title || 'Markdown Lite';
	brandNameEl.textContent = docsTitle;
	welcomeHeadingEl.textContent = docsTitle;
	updatePageTitle();
}

function applySidebarWidth(width, { persist = true } = {}) {
	sidebarWidth = clampSidebarWidth(width);
	document.documentElement.style.setProperty('--sidebar-w', `${sidebarWidth}px`);
	if (persist) {
		localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarWidth));
	}
}

function applySidebarCollapsed(collapsed, { persist = true } = {}) {
	isDesktopSidebarCollapsed = collapsed;
	layoutEl.classList.toggle('is-sidebar-collapsed', collapsed && !isMobileViewport());
	if (sidebarToggleBtn) {
		sidebarToggleBtn.textContent = collapsed ? '⇥' : '⇤';
		sidebarToggleBtn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
		sidebarToggleBtn.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
	}
	if (persist) {
		localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
	}
}

function syncSidebarLayout() {
	if (isMobileViewport()) {
		layoutEl.classList.remove('is-sidebar-collapsed');
		return;
	}
	layoutEl.classList.toggle('is-sidebar-collapsed', isDesktopSidebarCollapsed);
}

function closeSidebar() {
	sidebarEl.classList.remove('is-open');
	overlayEl.classList.remove('is-visible');
}

function fileLabel(filePath) {
	return filePath.split('/').pop().replace(/\.md$/i, '');
}

function groupEntries(entries) {
	const groups = new Map();
	for (const entry of entries) {
		const slashIndex = entry.filePath.indexOf('/');
		const group = slashIndex === -1 ? '' : entry.filePath.slice(0, slashIndex);
		if (!groups.has(group)) {
			groups.set(group, []);
		}
		groups.get(group).push(entry);
	}
	return groups;
}

function createRouteUrl(routePath, hash = '') {
	return `${routePath}${window.location.search}${normalizeHash(hash)}`;
}

function updateDocToolState() {
	const hasDoc = Boolean(currentDocEntry && getArticle());
	scrollTopBtn.disabled = !hasDoc;
	scrollBottomBtn.disabled = !hasDoc;
	contentSearchInput.disabled = !hasDoc;
	const hasMatches = hasDoc && currentSearchMatches.length > 0;
	contentPrevBtn.disabled = !hasMatches;
	contentNextBtn.disabled = !hasMatches;
	if (!hasDoc) {
		contentSearchCount.textContent = '0';
	}
}

function getContentSearchFromLocation() {
	const url = new URL(window.location.href);
	const query = url.searchParams.get(CONTENT_SEARCH_QUERY_PARAM);
	if (query !== null) {
		return query;
	}
	return localStorage.getItem(CONTENT_SEARCH_STORAGE_KEY) || '';
}

function persistContentSearch(value) {
	const normalizedValue = value.trim();
	const url = new URL(window.location.href);

	if (normalizedValue) {
		url.searchParams.set(CONTENT_SEARCH_QUERY_PARAM, normalizedValue);
		localStorage.setItem(CONTENT_SEARCH_STORAGE_KEY, normalizedValue);
	} else {
		url.searchParams.delete(CONTENT_SEARCH_QUERY_PARAM);
		localStorage.removeItem(CONTENT_SEARCH_STORAGE_KEY);
	}

	history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function syncContentSearchInput() {
	contentSearchInput.value = getContentSearchFromLocation();
}

function getSidebarFilterStorageKey(panel = activeSidebarPanel) {
	return panel === 'legend' ? SIDEBAR_LEGEND_FILTER_STORAGE_KEY : SIDEBAR_TREE_FILTER_STORAGE_KEY;
}

function getSidebarSearchPlaceholder(panel = activeSidebarPanel) {
	return panel === 'legend' ? 'Filter headings…' : 'Filter files…';
}

function applyTreeFilter(query) {
	const normalizedQuery = query.trim().toLowerCase();
	document.querySelectorAll('.tree-file').forEach(element => {
		element.classList.toggle('is-hidden', normalizedQuery !== '' && !element.dataset.label.includes(normalizedQuery));
	});

	document.querySelectorAll('.tree-group').forEach(section => {
		if (!section.dataset.group) {
			return;
		}
		const anyVisible = [...section.querySelectorAll('.tree-file')]
			.some(element => !element.classList.contains('is-hidden'));
		section.classList.toggle('is-hidden', !anyVisible);
	});
}

function applyLegendFilter(query) {
	const normalizedQuery = query.trim().toLowerCase();
	document.querySelectorAll('.legend-link').forEach(element => {
		element.classList.toggle('is-hidden', normalizedQuery !== '' && !element.dataset.label.includes(normalizedQuery));
	});
	if (!legendEl.children.length) {
		return;
	}
	const anyVisible = [...legendEl.querySelectorAll('.legend-link')]
		.some(element => !element.classList.contains('is-hidden'));
	legendEmptyEl.textContent = anyVisible ? '' : 'No headings match the current filter.';
	legendEmptyEl.style.display = anyVisible ? 'none' : '';
}

function applySidebarFilter(query, { persist = true, panel = activeSidebarPanel } = {}) {
	searchEl.value = query;
	searchEl.placeholder = getSidebarSearchPlaceholder(panel);

	if (panel === 'legend') {
		applyLegendFilter(query);
	} else {
		applyTreeFilter(query);
	}

	if (persist) {
		if (query.trim()) {
			localStorage.setItem(getSidebarFilterStorageKey(panel), query);
		} else {
			localStorage.removeItem(getSidebarFilterStorageKey(panel));
		}
	}
}

function applySidebarPanel(panel, { persist = true } = {}) {
	activeSidebarPanel = panel === 'legend' ? 'legend' : 'tree';
	for (const tab of sidebarTabs) {
		const isActive = tab.dataset.panel === activeSidebarPanel;
		tab.classList.toggle('is-active', isActive);
		tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
	}
	document.getElementById('tree-panel').classList.toggle('is-active', activeSidebarPanel === 'tree');
	document.getElementById('legend-panel').classList.toggle('is-active', activeSidebarPanel === 'legend');
	const savedFilter = localStorage.getItem(getSidebarFilterStorageKey(activeSidebarPanel)) || '';
	applySidebarFilter(savedFilter, { persist: false, panel: activeSidebarPanel });
	if (persist) {
		localStorage.setItem(SIDEBAR_PANEL_STORAGE_KEY, activeSidebarPanel);
	}
}

function normalizeDocPath(filePath) {
	const segments = [];
	for (const part of filePath.split('/')) {
		if (!part || part === '.') {
			continue;
		}
		if (part === '..') {
			segments.pop();
			continue;
		}
		segments.push(part);
	}
	return segments.join('/');
}

function resolveMarkdownPath(fromPath, targetPath) {
	const baseDir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : '';
	return normalizeDocPath(baseDir + safeDecodeURIComponent(targetPath));
}

function resolveMarkdownHref(fromPath, href) {
	const [pathPart, hashPart = ''] = href.split('#');
	return {
		path: resolveMarkdownPath(fromPath, pathPart),
		hash: hashPart ? `#${hashPart}` : '',
	};
}

function slugifyHeading(text) {
	return text
		.toLowerCase()
		.trim()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/<[^>]+>/g, '')
		.replace(/\s*[–—―]+\s*/g, ' ')
		.replace(/[^\w\- ]+/g, '')
		.replace(/ /g, '-');
}

function getHeadingSlugVariants(text) {
	const normalizedText = text
		.toLowerCase()
		.trim()
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/<[^>]+>/g, '');

	return [...new Set([
		slugifyHeading(text),
		normalizedText
			.replace(/[–—―]+/g, '')
			.replace(/[^\w\- ]+/g, '')
			.replace(/ /g, '-'),
		normalizedText
			.replace(/[^\w\- ]+/g, ' ')
			.replace(/[\s_]+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, ''),
	])].filter(Boolean);
}

function generateHeadingAnchors(text) {
	const variants = getHeadingSlugVariants(text);
	const primary = variants[0];
	const count = headingSlugCounts.get(primary) || 0;
	const suffix = count === 0 ? '' : `-${count}`;

	headingSlugCounts.set(primary, count + 1);

	return {
		id: `${primary}${suffix}`,
		aliases: variants.slice(1).map(variant => `${variant}${suffix}`),
	};
}

function assignHeadingIds(container) {
	headingSlugCounts = new Map();
	for (const heading of container.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
		const existingId = heading.getAttribute('id');
		if (existingId) {
			headingSlugCounts.set(existingId, (headingSlugCounts.get(existingId) || 0) + 1);
			continue;
		}

		const text = heading.textContent || '';
		const anchors = generateHeadingAnchors(text);
		if (anchors.id) {
			heading.id = anchors.id;
			if (anchors.aliases.length) {
				heading.dataset.anchorAliases = anchors.aliases.join(' ');
			}
		}
	}
}

function findHeadingTarget(container, targetId) {
	const exactMatch = container.querySelector(`[id="${CSS.escape(targetId)}"]`);
	if (exactMatch) {
		return exactMatch;
	}

	for (const heading of container.querySelectorAll('[data-anchor-aliases]')) {
		const aliases = (heading.dataset.anchorAliases || '').split(' ').filter(Boolean);
		if (aliases.includes(targetId)) {
			return heading;
		}
	}

	return null;
}

function scrollToCurrentHash(container) {
	if (!window.location.hash) {
		mainEl.scrollTop = 0;
		updateLegendSelection('');
		return;
	}

	const targetId = decodeURIComponent(window.location.hash.slice(1));
	const target = findHeadingTarget(container, targetId);
	if (target) {
		const mainRect = mainEl.getBoundingClientRect();
		const targetRect = target.getBoundingClientRect();
		const nextTop = mainEl.scrollTop + (targetRect.top - mainRect.top) - 12;
		mainEl.scrollTo({ top: Math.max(0, nextTop), behavior: 'auto' });
		updateLegendSelection(target.id);
	} else {
		mainEl.scrollTop = 0;
		updateLegendSelection('');
	}
}

function updateLegendSelection(targetId = decodeURIComponent(window.location.hash.slice(1))) {
	document.querySelectorAll('.legend-link').forEach(link => {
		const isActive = targetId !== '' && link.dataset.targetId === targetId;
		link.classList.toggle('is-active', isActive);
	});
}

function renderLegend(container = getArticle()) {
	legendEl.innerHTML = '';
	if (!container) {
		legendEmptyEl.textContent = 'Open a document to view its heading legend.';
		legendEmptyEl.style.display = '';
		return;
	}

	const headings = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')]
		.filter(heading => heading.id && (heading.textContent || '').trim() !== '');

	if (!headings.length) {
		legendEmptyEl.textContent = 'This document has no headings to map.';
		legendEmptyEl.style.display = '';
		return;
	}

	const fragment = document.createDocumentFragment();
	for (const heading of headings) {
		const depth = Number(heading.tagName.slice(1));
		const link = document.createElement('a');
		link.className = 'legend-link';
		link.href = `#${heading.id}`;
		link.textContent = heading.textContent || '';
		link.dataset.targetId = heading.id;
		link.dataset.label = (heading.textContent || '').toLowerCase();
		link.dataset.depth = String(depth);
		link.style.setProperty('--legend-depth', String(depth));
		fragment.appendChild(link);
	}

	legendEl.appendChild(fragment);
	legendEmptyEl.style.display = 'none';
	updateLegendSelection();
	if (activeSidebarPanel === 'legend') {
		applySidebarFilter(searchEl.value, { persist: false, panel: 'legend' });
	}
}

function scrollMatchIntoView(match) {
	if (!match) {
		return;
	}
	const mainRect = mainEl.getBoundingClientRect();
	const targetRect = match.getBoundingClientRect();
	const nextTop = mainEl.scrollTop + (targetRect.top - mainRect.top) - 64;
	mainEl.scrollTo({ top: Math.max(0, nextTop), behavior: 'smooth' });
}

function updateSearchStatus() {
	if (!currentSearchMatches.length) {
		contentSearchCount.textContent = '0';
		contentPrevBtn.disabled = true;
		contentNextBtn.disabled = true;
		return;
	}

	contentSearchCount.textContent = `${currentSearchIndex + 1}/${currentSearchMatches.length}`;
	contentPrevBtn.disabled = false;
	contentNextBtn.disabled = false;
}

function clearContentSearch(container = getArticle()) {
	if (!container) {
		currentSearchMatches = [];
		currentSearchIndex = -1;
		updateSearchStatus();
		updateDocToolState();
		return;
	}

	for (const mark of container.querySelectorAll('mark.content-hit')) {
		mark.replaceWith(document.createTextNode(mark.textContent || ''));
	}
	container.normalize();
	currentSearchMatches = [];
	currentSearchIndex = -1;
	updateSearchStatus();
	updateDocToolState();
}

function setCurrentSearchMatch(index) {
	if (!currentSearchMatches.length) {
		currentSearchIndex = -1;
		updateSearchStatus();
		return;
	}

	currentSearchMatches.forEach(match => match.classList.remove('is-current'));
	currentSearchIndex = (index + currentSearchMatches.length) % currentSearchMatches.length;
	const match = currentSearchMatches[currentSearchIndex];
	match.classList.add('is-current');
	updateSearchStatus();
	scrollMatchIntoView(match);
}

function highlightContentMatches(query, container = getArticle()) {
	clearContentSearch(container);
	const term = query.trim();
	if (!container || !term) {
		return;
	}

	const matcher = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
	const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			if (!node.nodeValue || !node.nodeValue.trim()) {
				return NodeFilter.FILTER_REJECT;
			}
			const parent = node.parentElement;
			if (!parent) {
				return NodeFilter.FILTER_REJECT;
			}
			if (parent.closest('mark.content-hit')) {
				return NodeFilter.FILTER_REJECT;
			}
			return NodeFilter.FILTER_ACCEPT;
		},
	});

	const textNodes = [];
	while (walker.nextNode()) {
		textNodes.push(walker.currentNode);
	}

	for (const node of textNodes) {
		matcher.lastIndex = 0;
		const source = node.nodeValue;
		let lastIndex = 0;
		let match;
		let hasMatch = false;
		const fragment = document.createDocumentFragment();

		while ((match = matcher.exec(source)) !== null) {
			hasMatch = true;
			const start = match.index;
			const end = start + match[0].length;
			if (start > lastIndex) {
				fragment.appendChild(document.createTextNode(source.slice(lastIndex, start)));
			}
			const mark = document.createElement('mark');
			mark.className = 'content-hit';
			mark.textContent = source.slice(start, end);
			fragment.appendChild(mark);
			currentSearchMatches.push(mark);
			lastIndex = end;
		}

		if (!hasMatch) {
			continue;
		}
		if (lastIndex < source.length) {
			fragment.appendChild(document.createTextNode(source.slice(lastIndex)));
		}
		node.parentNode.replaceChild(fragment, node);
	}

	if (currentSearchMatches.length) {
		setCurrentSearchMatch(0);
	} else {
		updateSearchStatus();
		updateDocToolState();
	}
}

function navigateToDoc(routePath, hash = '', { replace = false } = {}) {
	const nextUrl = createRouteUrl(routePath, hash);
	const method = replace ? 'replaceState' : 'pushState';
	history[method](null, '', nextUrl);
	handleRoute();
}

function buildTree(groups) {
	treeEl.innerHTML = '';
	for (const [group, entries] of groups) {
		const section = document.createElement('div');
		section.className = 'tree-group';
		section.dataset.group = group;

		if (group) {
			const label = document.createElement('div');
			label.className = 'tree-group__label';
			label.innerHTML = `<span class="tree-group__caret">&#9660;</span>${group}`;
			label.addEventListener('click', () => section.classList.toggle('is-collapsed'));
			section.appendChild(label);
		}

		const list = document.createElement('div');
		list.className = 'tree-group__list';

		for (const entry of entries) {
			const link = document.createElement('a');
			link.className = 'tree-file' + (group ? '' : ' tree-file--root');
			link.href = entry.routePath;
			link.textContent = fileLabel(entry.filePath);
			link.dataset.filePath = entry.filePath;
			link.dataset.routePath = entry.routePath;
			link.dataset.label = fileLabel(entry.filePath).toLowerCase();
			list.appendChild(link);
		}

		section.appendChild(list);
		treeEl.appendChild(section);
	}
}

function buildWelcomeGrid(groups) {
	welcomeGridEl.innerHTML = '';
	for (const [group, entries] of groups) {
		for (const entry of entries) {
			const link = document.createElement('a');
			link.className = 'welcome__card';
			link.href = entry.routePath;
			link.dataset.routePath = entry.routePath;
			link.innerHTML = `
				<div class="welcome__card-dir">${group || 'root'}</div>
				<div class="welcome__card-name">${fileLabel(entry.filePath)}</div>
			`;
			welcomeGridEl.appendChild(link);
		}
	}
}

async function loadFile(entry) {
	let previousScrollTop = 0;
	let preserveScroll = false;
	if (typeof arguments[1] === 'object' && arguments[1] !== null) {
		preserveScroll = Boolean(arguments[1].preserveScroll);
		previousScrollTop = preserveScroll ? mainEl.scrollTop : 0;
	}

	const loadRequestId = ++currentLoadRequestId;
	currentDocEntry = entry;
	syncCurrentFileWatch(entry);
	closeSidebar();
	legendEmptyEl.textContent = 'Loading heading legend…';
	legendEmptyEl.style.display = '';
	legendEl.innerHTML = '';
	updatePageTitle();

	document.querySelectorAll('.tree-file').forEach(element => {
		element.classList.toggle('is-active', element.dataset.routePath === entry.routePath);
	});

	const activeElement = treeEl.querySelector('.tree-file.is-active');
	if (activeElement) {
		const group = activeElement.closest('.tree-group');
		if (group) {
			group.classList.remove('is-collapsed');
		}
		activeElement.scrollIntoView({ block: 'nearest' });
	}

	const parts = entry.filePath.split('/');
	if (parts.length > 1) {
		breadcrumbEl.innerHTML = `${parts[0]} / <strong>${fileLabel(entry.filePath)}</strong>`;
	} else {
		breadcrumbEl.innerHTML = `<strong>${fileLabel(entry.filePath)}</strong>`;
	}
	sourceLinkEl.href = entry.sourceUrl;
	sourceLinkEl.style.display = '';

	welcomeEl.style.display = 'none';
	if (!preserveScroll) {
		mainEl.innerHTML = '<div class="state">Loading…</div>';
	}

	try {
		const response = await fetch(entry.contentUrl, { cache: 'no-store' });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} ${response.statusText} — ${entry.filePath}`);
		}

		const markdown = await response.text();
		if (loadRequestId !== currentLoadRequestId || currentDocEntry?.filePath !== entry.filePath) {
			return;
		}

		headingSlugCounts = new Map();
		const article = document.createElement('article');
		article.className = 'markdown-body';
		article.innerHTML = marked.parse(markdown);
		assignHeadingIds(article);
		mainEl.innerHTML = '';
		mainEl.appendChild(article);

		const mermaidNodes = [...article.querySelectorAll('.mermaid')];
		if (mermaidNodes.length) {
			await mermaid.run({ nodes: mermaidNodes });
		}

		if (contentSearchInput.value.trim()) {
			highlightContentMatches(contentSearchInput.value, article);
		}

		renderLegend(article);
		if (preserveScroll && !window.location.hash) {
			mainEl.scrollTop = previousScrollTop;
			updateLegendSelection('');
		} else {
			scrollToCurrentHash(article);
		}
		updateDocToolState();
	} catch (error) {
		if (loadRequestId !== currentLoadRequestId || currentDocEntry?.filePath !== entry.filePath) {
			return;
		}

		mainEl.innerHTML = `<div class="state state--error">Error loading: ${entry.filePath}\n\n${error.message}</div>`;
		legendEl.innerHTML = '';
		legendEmptyEl.textContent = 'Unable to build a heading legend for this document.';
		legendEmptyEl.style.display = '';
		clearContentSearch();
		updateDocToolState();
	}
}

function renderWelcomeState() {
	closeCurrentFileWatch();
	currentDocEntry = null;
	mainEl.innerHTML = '';
	mainEl.appendChild(welcomeEl);
	welcomeEl.style.display = '';
	breadcrumbEl.textContent = 'Select a document';
	sourceLinkEl.style.display = 'none';
	document.querySelectorAll('.tree-file').forEach(element => element.classList.remove('is-active'));
	legendEl.innerHTML = '';
	legendEmptyEl.textContent = 'Open a document to view its heading legend.';
	legendEmptyEl.style.display = '';
	clearContentSearch();
	updatePageTitle();
	updateDocToolState();
}

function renderWatchedFileMissingState(entry) {
	currentDocEntry = entry;
	updatePageTitle();
	const parts = entry.filePath.split('/');
	if (parts.length > 1) {
		breadcrumbEl.innerHTML = `${parts[0]} / <strong>${fileLabel(entry.filePath)}</strong>`;
	} else {
		breadcrumbEl.innerHTML = `<strong>${fileLabel(entry.filePath)}</strong>`;
	}
	sourceLinkEl.style.display = 'none';
	legendEl.innerHTML = '';
	legendEmptyEl.textContent = 'The open file is currently unavailable.';
	legendEmptyEl.style.display = '';
	clearContentSearch();
	mainEl.innerHTML = `<div class="state state--error">Document is unavailable: ${entry.filePath}\n\nThe open file was moved, deleted, or is temporarily missing.</div>`;
	updateDocToolState();
}

function renderMissingRouteState(pathname) {
	closeCurrentFileWatch();
	currentDocEntry = null;
	mainEl.innerHTML = `<div class="state state--error">Document not found: ${pathname}</div>`;
	breadcrumbEl.innerHTML = `<strong>Missing document</strong>`;
	sourceLinkEl.style.display = 'none';
	legendEl.innerHTML = '';
	legendEmptyEl.textContent = 'The heading legend is unavailable because this document route does not exist.';
	legendEmptyEl.style.display = '';
	document.querySelectorAll('.tree-file').forEach(element => element.classList.remove('is-active'));
	clearContentSearch();
	updatePageTitle();
	updateDocToolState();
}

function handleRoute() {
	syncContentSearchInput();
	const routePath = normalizeRoutePath(window.location.pathname);
	if (routePath === '/') {
		renderWelcomeState();
		return;
	}

	const entry = docsEntriesByRoutePath.get(routePath);
	if (!entry) {
		renderMissingRouteState(routePath);
		return;
	}

	void loadFile(entry);
}

function initializeMarked() {
	mermaid.initialize({ startOnLoad: false, theme: 'default' });
	marked.use({
		renderer: {
			heading({ tokens, depth }) {
				const text = this.parser.parseInline(tokens);
				const anchors = generateHeadingAnchors(text);
				const aliasAttr = anchors.aliases.length
					? ` data-anchor-aliases="${anchors.aliases.join(' ')}"`
					: '';
				return `<h${depth} id="${anchors.id}"${aliasAttr}>${text}</h${depth}>`;
			},
			link({ href, title, tokens }) {
				const text = this.parser.parseInline(tokens);
				const titleAttr = title ? ` title="${title}"` : '';

				if (!href) {
					return `<a${titleAttr}>${text}</a>`;
				}

				if (href.startsWith('#')) {
					return `<a href="${href}"${titleAttr}>${text}</a>`;
				}

				if (/\.md($|#)/i.test(href) && currentDocEntry) {
					const resolved = resolveMarkdownHref(currentDocEntry.filePath, href);
					const entry = docsEntriesByFilePath.get(resolved.path);
					if (entry) {
						return `<a href="${entry.routePath}${resolved.hash}"${titleAttr}>${text}</a>`;
					}
				}

				return `<a href="${href}"${titleAttr}>${text}</a>`;
			},
			code({ text, lang }) {
				if (lang === 'mermaid') {
					const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
					return `<div class="mermaid">${escaped}</div>`;
				}
				const validLang = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
				const highlighted = hljs.highlight(text, { language: validLang }).value;
				return `<pre><code class="hljs language-${validLang}">${highlighted}</code></pre>`;
			},
		},
	});
}

menuBtn.addEventListener('click', () => {
	if (isMobileViewport()) {
		sidebarEl.classList.toggle('is-open');
		overlayEl.classList.toggle('is-visible');
		return;
	}

	applySidebarCollapsed(!isDesktopSidebarCollapsed);
});

overlayEl.addEventListener('click', closeSidebar);

sidebarToggleBtn.addEventListener('click', () => {
	applySidebarCollapsed(!isDesktopSidebarCollapsed);
});

sidebarNarrowBtn.addEventListener('click', () => {
	applySidebarWidth(sidebarWidth - SIDEBAR_WIDTH_STEP);
	applySidebarCollapsed(false);
});

sidebarWideBtn.addEventListener('click', () => {
	applySidebarWidth(sidebarWidth + SIDEBAR_WIDTH_STEP);
	applySidebarCollapsed(false);
});

sidebarResizer.addEventListener('pointerdown', event => {
	if (isMobileViewport()) {
		return;
	}
	event.preventDefault();
	applySidebarCollapsed(false);
	document.body.classList.add('is-resizing-sidebar');
	sidebarResizer.setPointerCapture(event.pointerId);

	const onMove = moveEvent => {
		applySidebarWidth(moveEvent.clientX, { persist: false });
	};

	const onEnd = endEvent => {
		sidebarResizer.releasePointerCapture(endEvent.pointerId);
		document.body.classList.remove('is-resizing-sidebar');
		localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarWidth));
		sidebarResizer.removeEventListener('pointermove', onMove);
		sidebarResizer.removeEventListener('pointerup', onEnd);
		sidebarResizer.removeEventListener('pointercancel', onEnd);
	};

	sidebarResizer.addEventListener('pointermove', onMove);
	sidebarResizer.addEventListener('pointerup', onEnd);
	sidebarResizer.addEventListener('pointercancel', onEnd);
});

searchEl.addEventListener('input', () => {
	applySidebarFilter(searchEl.value);
});

for (const tab of sidebarTabs) {
	tab.addEventListener('click', () => {
		applySidebarPanel(tab.dataset.panel || 'tree');
	});
}

scrollTopBtn.addEventListener('click', () => {
	mainEl.scrollTo({ top: 0, behavior: 'smooth' });
});

scrollBottomBtn.addEventListener('click', () => {
	mainEl.scrollTo({ top: mainEl.scrollHeight, behavior: 'smooth' });
});

contentSearchInput.addEventListener('input', () => {
	persistContentSearch(contentSearchInput.value);
	highlightContentMatches(contentSearchInput.value);
});

contentSearchInput.addEventListener('keydown', event => {
	if (event.key !== 'Enter' || !currentSearchMatches.length) {
		return;
	}
	event.preventDefault();
	setCurrentSearchMatch(currentSearchIndex + (event.shiftKey ? -1 : 1));
});

contentPrevBtn.addEventListener('click', () => {
	setCurrentSearchMatch(currentSearchIndex - 1);
});

contentNextBtn.addEventListener('click', () => {
	setCurrentSearchMatch(currentSearchIndex + 1);
});

treeEl.addEventListener('click', event => {
	const link = event.target.closest('.tree-file');
	if (!link) {
		return;
	}
	event.preventDefault();
	navigateToDoc(link.dataset.routePath);
});

legendEl.addEventListener('click', event => {
	const link = event.target.closest('.legend-link');
	if (!link || !currentDocEntry) {
		return;
	}
	event.preventDefault();
	const hash = link.getAttribute('href') || '';
	history.pushState(null, '', createRouteUrl(currentDocEntry.routePath, hash));
	const article = getArticle();
	if (article) {
		scrollToCurrentHash(article);
	}
	closeSidebar();
});

welcomeGridEl.addEventListener('click', event => {
	const link = event.target.closest('.welcome__card');
	if (!link) {
		return;
	}
	event.preventDefault();
	navigateToDoc(link.dataset.routePath);
});

mainEl.addEventListener('click', event => {
	const link = event.target.closest('a');
	if (!link) {
		return;
	}

	if (link.getAttribute('href')?.startsWith('#') && currentDocEntry) {
		event.preventDefault();
		const hash = link.getAttribute('href') || '';
		history.pushState(null, '', createRouteUrl(currentDocEntry.routePath, hash));
		const article = getArticle();
		if (article) {
			scrollToCurrentHash(article);
		}
		return;
	}

	const url = new URL(link.href, window.location.href);
	const routePath = normalizeRoutePath(url.pathname);
	if (url.origin === window.location.origin && docsEntriesByRoutePath.has(routePath)) {
		event.preventDefault();
		navigateToDoc(routePath, url.hash);
	}
});

window.addEventListener('hashchange', () => {
	const article = getArticle();
	if (article) {
		scrollToCurrentHash(article);
	}
});

window.addEventListener('popstate', handleRoute);
window.addEventListener('resize', syncSidebarLayout);

async function init() {
	initializeMarked();

	try {
		const savedWidth = Number(localStorage.getItem(SIDEBAR_STORAGE_KEY));
		const savedCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
		const savedSidebarPanel = localStorage.getItem(SIDEBAR_PANEL_STORAGE_KEY) || 'tree';
		applySidebarWidth(Number.isFinite(savedWidth) && savedWidth > 0 ? savedWidth : sidebarWidth, { persist: false });
		applySidebarCollapsed(savedCollapsed, { persist: false });
		syncSidebarLayout();
		syncContentSearchInput();

		const response = await fetch(ROUTES_ENDPOINT, { cache: 'no-store' });
		if (!response.ok) {
			throw new Error(`HTTP ${response.status} — could not load document routes`);
		}

		const payload = await response.json();
		docsEntries = payload.entries;
		docsEntriesByFilePath = new Map(docsEntries.map(entry => [entry.filePath, entry]));
		docsEntriesByRoutePath = new Map(docsEntries.map(entry => [normalizeRoutePath(entry.routePath), entry]));
		applyViewerTitle(payload.title);

		const groups = groupEntries(docsEntries);
		buildTree(groups);
		applySidebarPanel(savedSidebarPanel, { persist: false });
		buildWelcomeGrid(groups);
		updateDocToolState();
		handleRoute();
	} catch (error) {
		treeEl.innerHTML = `<div class="state state--error" style="margin:12px">Could not load document routes\n\n${error.message}</div>`;
		legendEl.innerHTML = '';
		legendEmptyEl.textContent = 'The heading legend is unavailable because the document index failed to load.';
		legendEmptyEl.style.display = '';
		mainEl.innerHTML = `<div class="state state--error">${error.message}</div>`;
	}
}

void init();