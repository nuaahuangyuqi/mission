<script setup>
import PlanningTaskExecutionResultStep from '../views/planning/PlanningTaskExecutionResultStep.vue';

defineProps({
  step: {
    type: Object,
    default: null,
  },
  generatedAt: {
    type: String,
    default: '',
  },
});
</script>

<template>
  <PlanningTaskExecutionResultStep
    embedded
    :step-override="step"
    :generated-at-override="generatedAt"
  />
</template>
