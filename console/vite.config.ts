import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/v9/console/',
  build: {
    outDir: '../src/observe/dashboard/console',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 19101,
    host: '127.0.0.1',
    proxy: {
      '/api/v9': {
        target: 'http://127.0.0.1:19100',
        changeOrigin: true,
      },
    },
  },
});
