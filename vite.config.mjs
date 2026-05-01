import { defineConfig } from 'vite';

export default defineConfig({
	root: 'src/viewer',
	base: '/__markdown_lite/',
	build: {
		outDir: '../../dist/viewer',
		emptyOutDir: true,
	},
});