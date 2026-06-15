import fs from 'node:fs/promises';
import path from 'node:path';

const outputRoot = path.resolve('apps/web/public/dem');
const center = { lon: 120.18, lat: 30.28 };
const minZoom = 0;
const maxZoom = 8;

function lonLatToTile(lon, lat, zoom) {
  const x = Math.floor(((lon + 180) / 360) * 2 ** zoom);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * 2 ** zoom,
  );
  return { x, y };
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function downloadTile(z, x, y) {
  const targetDir = path.join(outputRoot, String(z), String(x));
  const targetFile = path.join(targetDir, `${y}.png`);

  try {
    await fs.access(targetFile);
    return false;
  } catch {
    await ensureDir(targetDir);
  }

  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'mission-learning-sandbox/0.1 (sample offline tiles)',
    },
  });

  if (!response.ok) {
    throw new Error(`Tile download failed: ${url} -> ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(targetFile, buffer);
  return true;
}

async function main() {
  let downloaded = 0;

  for (let z = minZoom; z <= maxZoom; z += 1) {
    const centerTile = lonLatToTile(center.lon, center.lat, z);
    const radius = z <= 1 ? 0 : 1;
    const maxIndex = 2 ** z - 1;

    for (let x = Math.max(0, centerTile.x - radius); x <= Math.min(maxIndex, centerTile.x + radius); x += 1) {
      for (let y = Math.max(0, centerTile.y - radius); y <= Math.min(maxIndex, centerTile.y + radius); y += 1) {
        const changed = await downloadTile(z, x, y);
        if (changed) {
          downloaded += 1;
          console.log(`downloaded z${z}/${x}/${y}`);
        }
      }
    }
  }

  console.log(`sample offline tiles ready: ${downloaded} downloaded`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
