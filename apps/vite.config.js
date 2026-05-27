import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import cesium from 'vite-plugin-cesium';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cesiumBuildRootPath = path.resolve(__dirname, 'node_modules/cesium/Build');
const cesiumBuildPath = path.resolve(__dirname, 'node_modules/cesium/Build/Cesium');

export default defineConfig({
  plugins: [
    vue(),
    cesium({
      cesiumBuildRootPath,
      cesiumBuildPath,
      cesiumBaseUrl: 'cesium/',
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3100',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist/client',
    copyPublicDir: false,
    sourcemap: false,
  },
});
