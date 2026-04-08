import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	optimizeDeps: {
		// This forces Vite to bundle the library correctly
		include: ['html5-qrcode']
	},
	server: {
		fs: {
			// Allows Vite to serve files from the node_modules directory if requested
			allow: ['..']
		}
	}
});
