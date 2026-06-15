import { computed, ref, watch } from 'vue';

export const tiandituTokenStorageKey = 'mission.tianditu.token';
export const mapSettingsStorageKey = 'mission.map.settings';
export const envTiandituToken = String(import.meta.env.VITE_TDT_TOKEN || '').trim();

const defaultMapSettings = {
  basemap: 'offline',
  mapMode: '3D',
  terrainMode: 'offline',
  terrainExaggeration: 1,
};

function readStoredTiandituToken() {
  if (typeof window === 'undefined') return '';
  try {
    return String(window.localStorage.getItem(tiandituTokenStorageKey) || '').trim();
  } catch {
    return '';
  }
}

function writeStoredTiandituToken(token) {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.localStorage.setItem(tiandituTokenStorageKey, token);
    } else {
      window.localStorage.removeItem(tiandituTokenStorageKey);
    }
  } catch {
    // Browser storage can be unavailable in private or locked-down contexts.
  }
}

function readStoredMapSettings() {
  if (typeof window === 'undefined') return { ...defaultMapSettings };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(mapSettingsStorageKey) || '{}');
    return normalizeMapSettings(parsed);
  } catch {
    return { ...defaultMapSettings };
  }
}

function writeStoredMapSettings(settings) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(mapSettingsStorageKey, JSON.stringify(normalizeMapSettings(settings)));
  } catch {
    // Browser storage can be unavailable in private or locked-down contexts.
  }
}

function normalizeBasemap(value) {
  return ['offline', 'auto', 'tianditu', 'grid'].includes(value) ? value : defaultMapSettings.basemap;
}

function normalizeMapMode(value) {
  return value === '2D' ? '2D' : defaultMapSettings.mapMode;
}

function normalizeTerrainMode(value) {
  return ['offline', 'flat', 'tianditu'].includes(value) ? value : defaultMapSettings.terrainMode;
}

export function normalizeTerrainExaggeration(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return defaultMapSettings.terrainExaggeration;
  return Math.min(10, Math.max(0.1, Math.round(numeric * 10) / 10));
}

function normalizeMapSettings(settings = {}) {
  return {
    basemap: normalizeBasemap(settings.basemap),
    mapMode: normalizeMapMode(settings.mapMode),
    terrainMode: normalizeTerrainMode(settings.terrainMode),
    terrainExaggeration: normalizeTerrainExaggeration(settings.terrainExaggeration),
  };
}

const storedMapSettings = readStoredMapSettings();

export const localTiandituToken = ref(readStoredTiandituToken());
export const tiandituToken = computed(() => localTiandituToken.value || envTiandituToken);
export const tiandituTokenSource = computed(() => {
  if (localTiandituToken.value) return 'local';
  if (envTiandituToken) return 'env';
  return 'empty';
});
export const globalBasemap = ref(storedMapSettings.basemap);
export const globalMapMode = ref(storedMapSettings.mapMode);
export const globalTerrainMode = ref(storedMapSettings.terrainMode);
export const globalTerrainExaggeration = ref(storedMapSettings.terrainExaggeration);

watch(
  [globalBasemap, globalMapMode, globalTerrainMode, globalTerrainExaggeration],
  () => {
    writeStoredMapSettings({
      basemap: globalBasemap.value,
      mapMode: globalMapMode.value,
      terrainMode: globalTerrainMode.value,
      terrainExaggeration: globalTerrainExaggeration.value,
    });
  },
);

export function saveTiandituToken(value) {
  const normalized = String(value || '').trim();
  localTiandituToken.value = normalized;
  writeStoredTiandituToken(normalized);
  return tiandituToken.value;
}

export function clearLocalTiandituToken() {
  localTiandituToken.value = '';
  writeStoredTiandituToken('');
  return tiandituToken.value;
}

export function setGlobalBasemap(value) {
  globalBasemap.value = normalizeBasemap(value);
}

export function setGlobalMapMode(value) {
  globalMapMode.value = normalizeMapMode(value);
}

export function setGlobalTerrainMode(value) {
  globalTerrainMode.value = normalizeTerrainMode(value);
}

export function setGlobalTerrainExaggeration(value) {
  globalTerrainExaggeration.value = normalizeTerrainExaggeration(value);
}

export function maskToken(value) {
  const token = String(value || '').trim();
  if (!token) return '未配置';
  if (token.length <= 8) return `${token.slice(0, 2)}****`;
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}
