import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildTerrainLayerJson, clearTerrainLayerCache } from './local-terrain-layer.js';

function touch(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, '');
}

test('buildTerrainLayerJson repairs static quantized-mesh availability', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-terrain-'));
  try {
    fs.writeFileSync(path.join(root, 'layer.json'), JSON.stringify({
      tilejson: '1.0',
      format: 'quantized-mesh-1.0',
      projection: 'EPSG:4326',
      scheme: 'tms',
      tiles: ['{z}/{x}/{y}.terrain'],
      minzoom: 0,
      maxzoom: 1,
      metadataAvailability: 10,
      available: [[{ startX: 0, startY: 0, endX: 0, endY: 0 }], []],
    }));

    touch(path.join(root, '0/0/0.terrain'));
    touch(path.join(root, '0/1/0.terrain'));
    touch(path.join(root, '0/2/0.terrain'));
    touch(path.join(root, '1/0/0.terrain'));
    touch(path.join(root, '1/0/1.terrain'));
    touch(path.join(root, '1/1/0.terrain'));
    touch(path.join(root, '1/1/1.terrain'));

    const payload = buildTerrainLayerJson(root);

    assert.equal(payload.repaired, true);
    assert.equal('metadataAvailability' in payload.json, false);
    assert.deepEqual(payload.json.available[0], [{ startX: 0, startY: 0, endX: 1, endY: 0 }]);
    assert.deepEqual(payload.json.available[1], [{ startX: 0, startY: 0, endX: 1, endY: 1 }]);
    assert.equal(payload.stats.tiles, 6);
  } finally {
    clearTerrainLayerCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
