<script setup>
defineProps({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    default: '',
  },
  meta: {
    type: String,
    default: '',
  },
  status: {
    type: String,
    default: 'planned',
  },
});

const emit = defineEmits(['enter']);
</script>

<template>
  <article class="module-card" :class="[`status-${status}`]">
    <div class="module-card__head">
      <span class="pill" :class="status === 'active' ? 'pill-active' : 'pill-muted'">
        {{ status === 'active' ? '可进入' : '预留入口' }}
      </span>
      <h3>{{ title }}</h3>
      <p v-if="description" class="module-card__description">{{ description }}</p>
      <small v-if="meta" class="module-card__meta">{{ meta }}</small>
    </div>
    <button
      class="button"
      :class="status === 'active' ? '' : 'button-ghost'"
      :disabled="status !== 'active'"
      @click="emit('enter')"
    >
      {{ status === 'active' ? '进入工作区' : '后续开放' }}
    </button>
  </article>
</template>
