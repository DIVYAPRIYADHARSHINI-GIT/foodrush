// Separate config for live-browser probes so they never run in the unit suite.
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	resolve: {
		alias: {
			'#lib': fileURLToPath(new URL('../src/lib', import.meta.url))
		}
	},
	test: {
		include: ['probes/**/*.probe.ts'],
		environment: 'node',
		testTimeout: 240_000,
		hookTimeout: 300_000,
		// Browser probes share one server and one browser; running them in parallel would
		// fight over the port and the page.
		fileParallelism: false
	}
});
