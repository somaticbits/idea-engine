import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  root: 'web',
  build: { outDir: '../public', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:8080' } },
});
