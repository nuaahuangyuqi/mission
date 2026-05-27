<script setup>
import { brandingConfig } from '../config/branding';

defineProps({
  compact: { type: Boolean, default: false },
});
</script>

<template>
  <div class="page-brand" :class="{ 'page-brand--compact': compact }">
    <img class="page-brand__logo" :src="brandingConfig.logoUrl" :alt="brandingConfig.name" />
    <span class="page-brand__name">{{ brandingConfig.name }}</span>
  </div>
</template>
