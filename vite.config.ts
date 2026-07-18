import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'dashboard',
  plugins: [react()],
  build: { outDir: '../dist-dashboard', emptyOutDir: true },
  server: { host: '127.0.0.1', port: 4174, proxy: { '/api': 'http://127.0.0.1:4173' } },
});
