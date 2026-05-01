# markdown-lite

markdown-lite is a portable markdown viewer for serving a directory of `.md` files as a standalone local website with clean pathname routing.

It keeps the current markdown viewer behavior intact while removing the old `make`, `manifest.json`, and Python HTTP server requirements.

## Features

- Clean document routes such as `/FAQ` and `/guides/Getting%20Started`
- Filename-safe routing for spaces, Unicode, `#`, `%`, and other URL-sensitive characters
- Automatic refresh when the currently open markdown file changes on disk
- Sidebar document tree, heading legend, in-document search, code highlighting, and Mermaid rendering
- CLI binary for local or global installation
- Programmatic server API for embedding in other tools

## Installation

### Global install

If the package is published, install it globally with your package manager of choice:

```sh
pnpm add -g markdown-lite
```

or

```sh
npm install -g markdown-lite
```

Then run it against any directory that contains markdown files:

```sh
markdown-lite ./docs
```

### From this repository

If you are working from a source checkout:

```sh
pnpm install
pnpm build
pnpm start -- ./docs
```

`pnpm build` is required in a source checkout because the viewer assets are emitted into `dist/viewer`.

## CLI usage

```sh
markdown-lite [directory] [options]
```

Options:

- `--port <number>`: bind the server to a specific port
- `--host <address>`: bind to a specific host interface
- `--title <text>`: override the viewer title shown in the UI
- `--open`: open the viewer in the default browser after startup
- `--help`: print usage help

Examples:

```sh
markdown-lite ./docs --port 7000
```

```sh
markdown-lite ./docs --host 0.0.0.0 --port 8080 --title "Project Docs"
```

```sh
MARKDOWN_LITE_PORT=9000 markdown-lite ./docs
```

## Port configuration

The port number is configurable in three ways.

Precedence order:

1. `--port`
2. `MARKDOWN_LITE_PORT`
3. `PORT`
4. default `6450`

Examples:

```sh
markdown-lite ./docs --port 7000
```

```sh
PORT=7000 markdown-lite ./docs
```

```sh
MARKDOWN_LITE_PORT=7100 markdown-lite ./docs
```

## Programmatic usage

markdown-lite also exposes a small Node API.

```js
import { startMarkdownLiteServer } from 'markdown-lite';

const { url, server } = await startMarkdownLiteServer({
	rootDir: '/absolute/path/to/docs',
	port: 7000,
	host: '127.0.0.1',
	title: 'Project Docs',
});

console.log(url);

process.on('SIGINT', () => {
	server.close(() => process.exit(0));
});
```

You can also use the lower-level exports for route generation and document indexing:

- `createMarkdownLiteServer`
- `buildDocsIndex`
- `routePathFromFilePath`
- `createRouteIndex`

## Routing behavior

Document routes are mapped by encoded pathname, not by query string.

Examples:

- `FAQ.md` -> `/FAQ`
- `guides/Getting Started.md` -> `/guides/Getting%20Started`
- `weird/naïve #topic%.md` -> `/weird/na%C3%AFve%20%23topic%25`

This preserves the real filename and avoids collisions caused by lossy slug generation.

## Live refresh behavior

markdown-lite automatically watches the markdown file that is currently open in the browser.

When that file changes on disk, the viewer fetches the latest content and rerenders the open document without a full page reload.

Current scope:

- The open document refreshes automatically when it changes.
- Files that are not currently open are not watched.
- The sidebar tree does not live-refresh for newly added, renamed, or deleted files until the page reloads.

## Notes

- The server recursively scans for `.md` files.
- `.git`, `.github`, and `node_modules` are skipped during scanning.
- The browser-facing document routes are clean paths; raw markdown is served from internal endpoints used by the viewer.