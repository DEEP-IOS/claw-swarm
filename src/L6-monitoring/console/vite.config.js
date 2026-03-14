/**
 * Vite 构建配置 / Vite Build Configuration
 *
 * 蜂群控制台 SPA 构建管线
 * Swarm Console SPA build pipeline
 *
 * @module console/vite.config
 * @author DEEP-IOS
 */
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  base: '/v6/console/',
  plugins: [react()],
  resolve: {
    alias: {
      '@swarm': resolve(__dirname, '../../'),
      '@console': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // 框架 / Vendor
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) {
            return 'vendor';
          }
          if (id.includes('node_modules/zustand')) {
            return 'store';
          }
          // Canvas 引擎 / Canvas engine
          if (id.includes('/canvas/')) {
            return 'canvas';
          }
          // 视图 / Views
          if (id.includes('/views/')) {
            return 'views';
          }
          // 面板 / Panels
          if (id.includes('/panels/')) {
            return 'panels';
          }
        },
      },
    },
    chunkSizeWarningLimit: 300,
  },
  server: {
    port: 19101,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:19100',
        changeOrigin: true,
      },
      '/events': {
        target: 'http://127.0.0.1:19100',
        changeOrigin: true,
      },
    },
  },
});
