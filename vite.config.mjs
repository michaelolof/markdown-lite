import { defineConfig } from 'vite';

export default defineConfig({
	root: 'src/viewer',
	base: '/__markdown_serve/',
	build: {
		outDir: '../../dist/viewer',
		emptyOutDir: true,
	},
});