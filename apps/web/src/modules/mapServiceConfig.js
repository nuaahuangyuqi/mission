const STORAGE_KEY = 'mission-map-service-config';
const DEFAULT_SUBDOMAINS = ['0', '1', '2', '3', '4', '5', '6', '7'];
const DEFAULT_IMAGERY_MAX_LEVEL = 18;
const DEFAULT_TDT_IMAGERY_URL = 'https://t{s}.tianditu.gov.cn/DataServer?T=img_w&x={x}&y={y}&l={z}&tk={token}';
const DEFAULT_TDT_ANNOTATION_URL = 'https://t{s}.tianditu.gov.cn/DataServer?T=cia_w&x={x}&y={y}&l={z}&tk={token}';

function toStringValue(value) {
  return String(value || '').trim();
}

function toSubdomainList(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  return list.length ? [...new Set(list)] : [...DEFAULT_SUBDOMAINS];
}

function toPositiveInteger(value, fallback = DEFAULT_IMAGERY_MAX_LEVEL) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.max(1, Math.round(numeric));
}

export function getDefaultMapServiceConfig() {
  return {
    ionToken: toStringValue(import.meta.env.VITE_CESIUM_ION_TOKEN),
    imageryUrl: '',
    annotationUrl: '',
    terrainUrl: toStringValue(import.meta.env.VITE_TDT_TERRAIN_URL),
    token: toStringValue(import.meta.env.VITE_TDT_TOKEN),
    subdomains: [...DEFAULT_SUBDOMAINS],
    maximumLevel: DEFAULT_IMAGERY_MAX_LEVEL,
  };
}

export function normalizeMapServiceConfig(rawConfig = {}) {
  const defaults = getDefaultMapServiceConfig();
  return {
    ionToken: toStringValue(rawConfig.ionToken ?? defaults.ionToken),
    imageryUrl: toStringValue(rawConfig.imageryUrl ?? defaults.imageryUrl),
    annotationUrl: toStringValue(rawConfig.annotationUrl ?? defaults.annotationUrl),
    terrainUrl: toStringValue(rawConfig.terrainUrl ?? defaults.terrainUrl),
    token: toStringValue(rawConfig.token ?? defaults.token),
    subdomains: toSubdomainList(rawConfig.subdomains ?? defaults.subdomains),
    maximumLevel: toPositiveInteger(rawConfig.maximumLevel ?? defaults.maximumLevel, defaults.maximumLevel),
  };
}

export function loadMapServiceConfig() {
  if (typeof window === 'undefined') {
    return getDefaultMapServiceConfig();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return getDefaultMapServiceConfig();
    }
    return normalizeMapServiceConfig(JSON.parse(raw));
  } catch {
    return getDefaultMapServiceConfig();
  }
}

export function saveMapServiceConfig(config) {
  const normalized = normalizeMapServiceConfig(config);
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  }
  return normalized;
}

export function resetMapServiceConfig() {
  const defaults = getDefaultMapServiceConfig();
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_KEY);
  }
  return defaults;
}

export function applyTokenTemplate(url, token) {
  const normalizedUrl = toStringValue(url);
  if (!normalizedUrl) return '';
  return normalizedUrl.replaceAll('{token}', encodeURIComponent(toStringValue(token)));
}

export function getCesiumIonToken(config = {}) {
  return normalizeMapServiceConfig(config).ionToken;
}

export function hasCesiumIonToken(config = {}) {
  return Boolean(getCesiumIonToken(config));
}

export function getEffectiveOnlineImageryConfig(config = {}) {
  const normalized = normalizeMapServiceConfig(config);
  if (normalized.ionToken) {
    return {
      imageryUrl: '',
      annotationUrl: '',
      subdomains: normalized.subdomains,
      maximumLevel: normalized.maximumLevel,
      sourceLabel: 'Cesium World Imagery',
      sourceType: 'ion',
    };
  }
  if (normalized.imageryUrl) {
    return {
      imageryUrl: applyTokenTemplate(normalized.imageryUrl, normalized.token),
      annotationUrl: normalized.annotationUrl
        ? applyTokenTemplate(normalized.annotationUrl, normalized.token)
        : '',
      subdomains: normalized.subdomains,
      maximumLevel: normalized.maximumLevel,
      sourceLabel: '自定义在线影像',
      sourceType: 'custom',
    };
  }

  if (normalized.token) {
    return {
      imageryUrl: applyTokenTemplate(DEFAULT_TDT_IMAGERY_URL, normalized.token),
      annotationUrl: applyTokenTemplate(DEFAULT_TDT_ANNOTATION_URL, normalized.token),
      subdomains: normalized.subdomains,
      maximumLevel: normalized.maximumLevel,
      sourceLabel: '天地图影像',
      sourceType: 'tianditu',
    };
  }

  return {
    imageryUrl: '',
    annotationUrl: '',
    subdomains: normalized.subdomains,
    maximumLevel: normalized.maximumLevel,
    sourceLabel: '',
    sourceType: '',
  };
}

export function getEffectiveOnlineTerrainUrl(config = {}) {
  const normalized = normalizeMapServiceConfig(config);
  return applyTokenTemplate(normalized.terrainUrl, normalized.token);
}
