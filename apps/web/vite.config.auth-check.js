import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import cesium from 'vite-plugin-cesium';

export default defineConfig({
  publicDir: false,
  plugins: [
    vue(),
    cesium({
      cesiumBuildRootPath: '../../node_modules/cesium/Build',
      cesiumBuildPath: '../../node_modules/cesium/Build/Cesium',
      cesiumBaseUrl: 'cesium/',
    }),
  ],
  build: {
    sourcemap: false,
    outDir: 'dist-auth-check',
    emptyOutDir: true,
  },
});
