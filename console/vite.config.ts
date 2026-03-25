import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/v9/console/',
  build: {
    outDir: '../src/observe/dashboard/console',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      external: ['three'],
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return;
          }

          if (
            id.includes('@react-three/drei')
            || id.includes('@react-three/postprocessing')
            || id.includes('postprocessing')
            || id.includes('maath')
          ) {
            return 'three-extras';
          }

          if (id.includes('@react-three/fiber')) {
            return 'three-fiber';
          }

          if (
            id.includes('camera-controls')
            || id.includes('three-stdlib')
            || id.includes('three-mesh-bvh')
            || id.includes('meshline')
            || id.includes('stats-gl')
            || id.includes('@monogrid/gainmap-js')
          ) {
            return 'three-support';
          }

          if (id.includes('/three/examples/')) {
            return 'three-examples';
          }

          if (
            id.includes('react')
            || id.includes('scheduler')
            || id.includes('zustand')
            || id.includes('nanoid')
          ) {
            return 'react-stack';
          }

          if (id.includes('@visx') || id.includes('d3-')) {
            return 'graph-stack';
          }

          if (id.includes('framer-motion')) {
            return 'motion-stack';
          }

          return 'vendor';
        },
      },
    },
  },
  server: {
    port: 19102,
    host: '127.0.0.1',
    proxy: {
      '/api/v9': {
        target: 'http://127.0.0.1:19100',
        changeOrigin: true,
      },
    },
  },
});
