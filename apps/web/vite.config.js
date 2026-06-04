import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import cesium from 'vite-plugin-cesium';

export default defineConfig({
  plugins: [
    vue(),
    cesium({
      cesiumBuildRootPath: '../../node_modules/cesium/Build',
      cesiumBuildPath: '../../node_modules/cesium/Build/Cesium',
      cesiumBaseUrl: 'cesium/',
    }),
  ],
  server: {
    host: '0.0.0.0',
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
