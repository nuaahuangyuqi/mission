import fs from 'node:fs';
import path from 'node:path';

const terrainLayerCache = new Map();

function stripBom(text) {
  return String(text || '').replace(/^\uFEFF/, '');
}

function safeInteger(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
}

function parseNumericName(name, suffix = '') {
  const value = suffix && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name;
  if (!/^\d+$/.test(value)) return null;
  return Number(value);
}

function uniqueSortedNumbers(values) {
  return [...new Set(values)]
    .filter((value) => Number.isInteger(value))
    .sort((left, right) => left - right);
}

function getTileLimits(projection, level) {
  const normalizedProjection = String(projection || 'EPSG:4326').toUpperCase();
  const yTiles = 2 ** level;
  const xTiles = normalizedProjection === 'EPSG:3857' ? yTiles : yTiles * 2;
  return {
    maxX: xTiles - 1,
    maxY: yTiles - 1,
  };
}

function listNumericDirectories(directory) {
  if (!fs.existsSync(directory)) return [];
  return uniqueSortedNumbers(
    fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => parseNumericName(entry.name))
      .filter((value) => value !== null),
  );
}

function listTerrainYValues(directory, maxY) {
  if (!fs.existsSync(directory)) return [];
  return uniqueSortedNumbers(
    fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.terrain'))
      .map((entry) => parseNumericName(entry.name, '.terrain'))
      .filter((value) => value !== null && value >= 0 && value <= maxY),
  );
}

function isCompleteRange(values, start, end) {
  if (values.length !== end - start + 1) return false;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== start + index) return false;
  }
  return true;
}

function hasFullYCoverage(xDirectory, maxY) {
  const yValues = listTerrainYValues(xDirectory, maxY);
  return isCompleteRange(yValues, 0, maxY);
}

function detectFullLevelCoverage(levelDirectory, xValues, maxX, maxY) {
  if (!isCompleteRange(xValues, 0, maxX)) return false;

  const sampleXValues = uniqueSortedNumbers([
    0,
    Math.floor(maxX / 2),
    maxX,
  ]);

  return sampleXValues.every((x) => hasFullYCoverage(path.join(levelDirectory, String(x)), maxY));
}

function buildYSpans(yValues) {
  const spans = [];
  let spanStart = null;
  let previous = null;

  for (const y of yValues) {
    if (spanStart === null) {
      spanStart = y;
      previous = y;
      continue;
    }

    if (y === previous + 1) {
      previous = y;
      continue;
    }

    spans.push({ startY: spanStart, endY: previous });
    spanStart = y;
    previous = y;
  }

  if (spanStart !== null) {
    spans.push({ startY: spanStart, endY: previous });
  }

  return spans;
}

function addRangeForSpan(ranges, activeRanges, x, span) {
  const key = `${span.startY}:${span.endY}`;
  const active = activeRanges.get(key);

  if (active && active.endX === x - 1) {
    active.endX = x;
    return key;
  }

  const nextRange = {
    startX: x,
    startY: span.startY,
    endX: x,
    endY: span.endY,
  };
  ranges.push(nextRange);
  activeRanges.set(key, nextRange);
  return key;
}

function buildLevelAvailability(terrainRoot, level, projection) {
  const levelDirectory = path.join(terrainRoot, String(level));
  const { maxX, maxY } = getTileLimits(projection, level);
  const xValues = listNumericDirectories(levelDirectory)
    .filter((x) => x >= 0 && x <= maxX);

  if (!xValues.length) {
    return {
      ranges: [],
      tileCount: 0,
      fullCoverage: false,
    };
  }

  if (detectFullLevelCoverage(levelDirectory, xValues, maxX, maxY)) {
    return {
      ranges: [{ startX: 0, startY: 0, endX: maxX, endY: maxY }],
      tileCount: (maxX + 1) * (maxY + 1),
      fullCoverage: true,
    };
  }

  const ranges = [];
  const activeRanges = new Map();
  let tileCount = 0;

  for (const x of xValues) {
    const yValues = listTerrainYValues(path.join(levelDirectory, String(x)), maxY);
    const currentKeys = new Set();
    tileCount += yValues.length;

    for (const span of buildYSpans(yValues)) {
      currentKeys.add(addRangeForSpan(ranges, activeRanges, x, span));
    }

    for (const [key, range] of activeRanges.entries()) {
      if (!currentKeys.has(key) || range.endX < x) {
        activeRanges.delete(key);
      }
    }
  }

  return {
    ranges,
    tileCount,
    fullCoverage: false,
  };
}

function readLayerJson(layerPath) {
  return JSON.parse(stripBom(fs.readFileSync(layerPath, 'utf8')));
}

function isQuantizedMeshLayer(layerJson) {
  return String(layerJson?.format || '').startsWith('quantized-mesh-1.');
}

export function buildTerrainLayerJson(terrainRoot) {
  const resolvedRoot = path.resolve(terrainRoot);
  const layerPath = path.join(resolvedRoot, 'layer.json');
  if (!fs.existsSync(layerPath)) return null;

  const layerStat = fs.statSync(layerPath);
  const cacheKey = resolvedRoot;
  const cacheToken = `${layerStat.mtimeMs}:${layerStat.size}`;
  const cached = terrainLayerCache.get(cacheKey);
  if (cached?.cacheToken === cacheToken) {
    return cached.payload;
  }

  const originalLayerJson = readLayerJson(layerPath);
  if (!isQuantizedMeshLayer(originalLayerJson)) {
    const payload = {
      json: originalLayerJson,
      repaired: false,
      stats: { levels: 0, ranges: 0, tiles: 0, fullCoverageLevels: 0 },
    };
    terrainLayerCache.set(cacheKey, { cacheToken, payload });
    return payload;
  }

  const minLevel = Math.max(0, safeInteger(originalLayerJson.minzoom, 0));
  const maxLevel = Math.max(minLevel, safeInteger(originalLayerJson.maxzoom, minLevel));
  const projection = originalLayerJson.projection || 'EPSG:4326';
  const available = [];
  const stats = {
    levels: 0,
    ranges: 0,
    tiles: 0,
    fullCoverageLevels: 0,
  };

  for (let level = 0; level <= maxLevel; level += 1) {
    if (level < minLevel) {
      available[level] = [];
      continue;
    }

    const levelAvailability = buildLevelAvailability(resolvedRoot, level, projection);
    available[level] = levelAvailability.ranges;
    stats.levels += levelAvailability.ranges.length ? 1 : 0;
    stats.ranges += levelAvailability.ranges.length;
    stats.tiles += levelAvailability.tileCount;
    stats.fullCoverageLevels += levelAvailability.fullCoverage ? 1 : 0;
  }

  const repairedLayerJson = {
    ...originalLayerJson,
    available,
    minzoom: minLevel,
    maxzoom: maxLevel,
  };

  // Cesium ignores `available` whenever `metadataAvailability` is present, so
  // local static terrain must remove it and rely on the generated tile ranges.
  delete repairedLayerJson.metadataAvailability;

  const payload = {
    json: repairedLayerJson,
    repaired: true,
    stats,
  };
  terrainLayerCache.set(cacheKey, { cacheToken, payload });
  return payload;
}

export function clearTerrainLayerCache() {
  terrainLayerCache.clear();
}
