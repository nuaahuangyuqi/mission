<script setup>
import { computed, reactive, watch } from 'vue';
import { normalizeMapServiceConfig } from '../modules/mapServiceConfig';

const props = defineProps({
  modelValue: { type: Object, default: () => ({}) },
});

const emit = defineEmits(['save', 'reset']);

const draft = reactive({
  ...normalizeMapServiceConfig(props.modelValue),
  subdomains: '',
});

watch(() => props.modelValue, (value) => {
  const normalized = normalizeMapServiceConfig(value);
  Object.assign(draft, {
    ...normalized,
    subdomains: normalized.subdomains.join(','),
  });
}, { deep: true, immediate: true });

const summaryText = computed(() => {
  const hasIonToken = Boolean(String(props.modelValue?.ionToken || '').trim());
  const hasCustomImagery = Boolean(String(props.modelValue?.imageryUrl || '').trim());
  const hasTerrain = Boolean(String(props.modelValue?.terrainUrl || '').trim());
  const hasToken = Boolean(String(props.modelValue?.token || '').trim());
  if (!hasIonToken && !hasCustomImagery && !hasTerrain && !hasToken) {
    return '未保存在线配置';
  }
  if (hasIonToken) {
    return 'Cesium ion 已配置';
  }
  return [
    hasCustomImagery ? '自定义影像' : (hasToken ? '天地图默认影像' : '无影像模板'),
    hasTerrain ? '在线 DEM 已配置' : '未配置在线 DEM',
  ].join(' / ');
});

function submit() {
  emit('save', normalizeMapServiceConfig({
    ...draft,
    subdomains: String(draft.subdomains || ''),
  }));
}
</script>

<template>
  <details class="map-service-config-panel top-gap">
    <summary>
      <span>在线 API 配置</span>
      <small>{{ summaryText }}</small>
    </summary>

    <div class="map-service-config-panel__body">
      <p class="muted-text">
        最简单的方式是直接填写 `Cesium ion Token`。
        保存后，在线底图会优先使用 Cesium World Imagery，在线地形会优先使用 Cesium World Terrain。
      </p>

      <label class="map-service-config-panel__field">
        Cesium ion Token
        <input
          v-model.trim="draft.ionToken"
          type="text"
          placeholder="粘贴你的 Cesium ion access token"
        />
      </label>

      <details class="map-service-config-panel__advanced">
        <summary>高级选项：自定义影像 / 自定义 DEM</summary>

        <p class="muted-text">
          如果你不想用 Cesium ion，也可以继续填写通用 XYZ/WMTS 风格影像模板与 Cesium Terrain URL。
          影像模板可使用 `{z}`、`{x}`、`{y}`、`{reverseY}`、`{s}`、`{token}` 占位符。
        </p>

        <label class="map-service-config-panel__field">
        在线影像 URL
        <input
          v-model.trim="draft.imageryUrl"
          type="text"
          placeholder="https://example.com/tiles/{z}/{x}/{y}.png"
        />
        </label>

        <label class="map-service-config-panel__field">
        影像注记 URL（可选）
        <input
          v-model.trim="draft.annotationUrl"
          type="text"
          placeholder="https://example.com/labels/{z}/{x}/{y}.png"
        />
        </label>

        <label class="map-service-config-panel__field">
        在线 DEM URL
        <input
          v-model.trim="draft.terrainUrl"
          type="text"
          placeholder="https://example.com/terrain/layer.json"
        />
        </label>

        <div class="map-service-config-panel__grid">
          <label class="map-service-config-panel__field">
          访问令牌（可选）
          <input
            v-model.trim="draft.token"
            type="text"
            placeholder="例如天地图 / 自定义服务 token"
          />
          </label>

          <label class="map-service-config-panel__field">
          子域（可选）
          <input
            v-model.trim="draft.subdomains"
            type="text"
            placeholder="0,1,2,3,4,5,6,7"
          />
          </label>

          <label class="map-service-config-panel__field">
          最大层级
          <input
            v-model.number="draft.maximumLevel"
            type="number"
            min="1"
            max="24"
            step="1"
          />
          </label>
        </div>
      </details>

      <div class="toolbar-row wrap">
        <button class="button" type="button" @click="submit">保存在线配置</button>
        <button class="button button-ghost" type="button" @click="$emit('reset')">恢复默认</button>
      </div>
    </div>
  </details>
</template>
