import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import cesium from 'vite-plugin-cesium';
import { buildTerrainLayerJson } from '../server/src/local-terrain-layer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cesiumBuildRootPath = path.resolve(__dirname, 'node_modules/cesium/Build');
const cesiumBuildPath = path.resolve(__dirname, 'node_modules/cesium/Build/Cesium');
const localAssetRoot = __dirname;

function resolveContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.json') return 'application/json; charset=utf-8';
  if (extension === '.terrain') return 'application/vnd.quantized-mesh';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.xml') return 'application/xml; charset=utf-8';
  if (extension === '.txt') return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function createLocalAssetMiddleware(routePrefix, candidateDirs = []) {
  const roots = candidateDirs
    .map((dir) => path.resolve(dir))
    .filter((dir) => fs.existsSync(dir));

  return (req, res, next) => {
    if (!roots.length || !req.url) {
      next();
      return;
    }

    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname !== routePrefix && !pathname.startsWith(`${routePrefix}/`)) {
      next();
      return;
    }

    const relativePath = pathname.slice(routePrefix.length).replace(/^\/+/, '');
    for (const root of roots) {
      const filePath = path.resolve(root, relativePath || 'index.html');
      if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
        continue;
      }

      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        continue;
      }

      if ((routePrefix === '/terrain' || routePrefix === '/dem') && relativePath === 'layer.json') {
        try {
          const payload = buildTerrainLayerJson(root);
          if (payload?.repaired && payload.stats.tiles <= 0) {
            continue;
          }
          if (payload?.json) {
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('X-Mission-Terrain-Layer', payload.repaired ? 'repaired' : 'original');
            if (payload.repaired) {
              res.setHeader('X-Mission-Terrain-Ranges', String(payload.stats.ranges));
            }
            if (req.method === 'HEAD') {
              res.end();
              return;
            }
            res.end(JSON.stringify(payload.json));
            return;
          }
        } catch (error) {
          console.warn(`[mission-local-web-assets] Failed to repair terrain layer metadata for ${root}:`, error);
        }
      }

      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Content-Type', resolveContentType(filePath));
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    next();
  };
}

function localWebAssetPlugin() {
  const localAssetDirs = (name) => [
    path.join(localAssetRoot, name),
    path.join(localAssetRoot, 'public', name),
    path.join(localAssetRoot, 'pubulic', name),
  ];

  return {
    name: 'mission-local-web-assets',
    configureServer(server) {
      server.middlewares.use(createLocalAssetMiddleware('/terrain', localAssetDirs('terrain')));
      server.middlewares.use(createLocalAssetMiddleware('/dem', localAssetDirs('dem')));
      server.middlewares.use(createLocalAssetMiddleware('/tiles', localAssetDirs('tiles')));
    },
  };
}

export default defineConfig({
  envDir: path.resolve(__dirname, '..'),
  plugins: [
    localWebAssetPlugin(),
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
