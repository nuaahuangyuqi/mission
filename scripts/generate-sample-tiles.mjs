import fs from 'node:fs/promises';
import path from 'node:path';

const outputRoot = path.resolve('apps/web/public/dem');
const center = {
  lon: Number(process.env.MISSION_TILE_CENTER_LON || 120.18),
  lat: Number(process.env.MISSION_TILE_CENTER_LAT || 30.28),
};
const minZoom = Number(process.env.MISSION_TILE_MIN_ZOOM || 0);
const maxZoom = Number(process.env.MISSION_TILE_MAX_ZOOM || 10);

function lonLatToTile(lon, lat, zoom) {
  const x = Math.floor(((lon + 180) / 360) * 2 ** zoom);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom,
  );
  return { x, y };
}

function tileBounds(x, y, z) {
  const n = 2 ** z;
  const west = (x / n) * 360 - 180;
  const east = ((x + 1) / n) * 360 - 180;
  const north = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const south = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  return { west, south, east, north };
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildTileSvg(z, x, y, centerTile) {
  const bounds = tileBounds(x, y, z);
  const dx = x - centerTile.x;
  const dy = y - centerTile.y;
  const landX = 46 - dx * 34;
  const landY = 86 - dy * 32;
  const riverShift = clamp(dx * 20, -40, 40);
  const routeShift = clamp(dy * 18, -36, 36);
  const isCenterTile = x === centerTile.x && y === centerTile.y;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="sea-${z}-${x}-${y}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#17324a"/>
      <stop offset="1" stop-color="#275b76"/>
    </linearGradient>
    <linearGradient id="land-${z}-${x}-${y}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#86a35d"/>
      <stop offset="1" stop-color="#334f2f"/>
    </linearGradient>
  </defs>
  <rect width="256" height="256" fill="url(#sea-${z}-${x}-${y})"/>
  <path d="M0 32H256M0 64H256M0 96H256M0 128H256M0 160H256M0 192H256M0 224H256M32 0V256M64 0V256M96 0V256M128 0V256M160 0V256M192 0V256M224 0V256" stroke="#9ed7ff" stroke-opacity="0.18" stroke-width="1"/>
  <ellipse cx="${landX + 82}" cy="${landY + 58}" rx="92" ry="58" fill="url(#land-${z}-${x}-${y})" opacity="0.92"/>
  <ellipse cx="${landX + 116}" cy="${landY + 80}" rx="66" ry="36" fill="#a3e635" opacity="0.28"/>
  <path d="M${18 + riverShift} 224 C ${76 + riverShift} 174, ${142 + riverShift} 198, ${236 + riverShift} 132" fill="none" stroke="#7dd3fc" stroke-opacity="0.82" stroke-width="6" stroke-linecap="round"/>
  <path d="M${34 - routeShift} 72 C ${88 - routeShift} 92, ${148 - routeShift} 74, ${220 - routeShift} 106" fill="none" stroke="#facc15" stroke-opacity="0.72" stroke-width="3" stroke-dasharray="8 8" stroke-linecap="round"/>
  ${isCenterTile ? '<circle cx="132" cy="128" r="9" fill="#f97316" stroke="#fff7ed" stroke-width="3"/><circle cx="132" cy="128" r="20" fill="none" stroke="#f97316" stroke-opacity="0.35" stroke-width="4"/>' : ''}
  <rect x="10" y="10" width="154" height="58" rx="10" fill="#08130e" opacity="0.78"/>
  <text x="20" y="32" font-family="Arial, sans-serif" font-size="14" font-weight="700" fill="#f7fee7">OFFLINE BASEMAP</text>
  <text x="20" y="52" font-family="Arial, sans-serif" font-size="11" fill="#d9f99d">z${z} / x${x} / y${y}</text>
  <text x="12" y="238" font-family="Arial, sans-serif" font-size="10" fill="#dbeafe" opacity="0.88">${escapeXml(bounds.west.toFixed(2))}, ${escapeXml(bounds.south.toFixed(2))}  →  ${escapeXml(bounds.east.toFixed(2))}, ${escapeXml(bounds.north.toFixed(2))}</text>
</svg>
`;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function writeTile(z, x, y, centerTile) {
  const targetDir = path.join(outputRoot, String(z), String(x));
  const targetFile = path.join(targetDir, `${y}.svg`);
  await ensureDir(targetDir);
  await fs.writeFile(targetFile, buildTileSvg(z, x, y, centerTile), 'utf8');
}

async function main() {
  let generated = 0;
  for (let z = minZoom; z <= maxZoom; z += 1) {
    const centerTile = lonLatToTile(center.lon, center.lat, z);
    const radius = z <= 1 ? 0 : 1;
    const maxIndex = 2 ** z - 1;

    for (let x = Math.max(0, centerTile.x - radius); x <= Math.min(maxIndex, centerTile.x + radius); x += 1) {
      for (let y = Math.max(0, centerTile.y - radius); y <= Math.min(maxIndex, centerTile.y + radius); y += 1) {
        await writeTile(z, x, y, centerTile);
        generated += 1;
      }
    }
  }

  console.log(`sample offline tiles ready: ${generated} generated at ${outputRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
