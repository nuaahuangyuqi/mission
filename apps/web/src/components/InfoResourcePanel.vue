<script setup>
import { computed, reactive, ref, watch } from 'vue';

const props = defineProps({
  sources: {
    type: Array,
    default: () => [],
  },
  intelligence: {
    type: Array,
    default: () => [],
  },
  environment: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(['save-intelligence']);

const selectedId = ref(null);
const campFilter = ref('all');
const categoryFilter = ref('all');
const form = reactive({
  id: null,
  name: '',
  category: '',
  role: '',
  readiness: '',
  strength: 0,
  latitude: 0,
  longitude: 0,
  notes: '',
  tagsText: '',
});

const categories = computed(() => Array.from(new Set(props.intelligence.map((item) => item.category))));
const sourceMap = computed(() => new Map(props.sources.map((item) => [item.id, item.name])));

const filteredIntelligence = computed(() => {
  return props.intelligence.filter((item) => {
    const campMatched = campFilter.value === 'all' || item.camp === campFilter.value;
    const categoryMatched = categoryFilter.value === 'all' || item.category === categoryFilter.value;
    return campMatched && categoryMatched;
  });
});

const sourceStats = computed(() => {
  const groups = {
    database: '数据库',
    api: 'API 接口',
    imagery: '遥感影像',
    text: '文本文件',
    environment: '环境数据',
    manual: '人工标注',
  };

  return Object.entries(groups).map(([key, label]) => ({
    key,
    label,
    count: props.sources.filter((item) => item.type === key).length,
  }));
});

watch(
  () => props.intelligence,
  (list) => {
    if (!list.length) {
      return;
    }

    const current = list.find((item) => item.id === selectedId.value);
    const target = current || list[0];
    selectedId.value = target.id;
    hydrateForm(target);
  },
  { immediate: true },
);

function hydrateForm(record) {
  form.id = record.id;
  form.name = record.name;
  form.category = record.category;
  form.role = record.role;
  form.readiness = record.readiness;
  form.strength = record.strength;
  form.latitude = record.latitude;
  form.longitude = record.longitude;
  form.notes = record.notes || '';
  form.tagsText = (record.tags || []).join('，');
}

function selectRecord(record) {
  selectedId.value = record.id;
  hydrateForm(record);
}

function saveRecord() {
  emit('save-intelligence', {
    id: form.id,
    payload: {
      name: form.name,
      category: form.category,
      role: form.role,
      readiness: form.readiness,
      strength: Number(form.strength),
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      notes: form.notes,
      tags: form.tagsText.split(/[，,]/).map((item) => item.trim()).filter(Boolean),
    },
  });
}

function campLabel(value) {
  return value === 'blue' ? '蓝方' : '红方';
}

function envLabel(value) {
  const map = {
    terrain: '地形',
    weather: '气象',
    electromagnetic: '电磁',
  };
  return map[value] || value;
}
</script>

<template>
  <div class="stack-grid two-columns">
    <section class="glass-card">
      <div class="section-heading compact">
        <div>
          <h3>数据采集与融合</h3>
          <p>汇聚数据库、API、遥感影像、文本文件等多源示范数据。</p>
        </div>
      </div>

      <div class="stats-strip compact-grid">
        <div v-for="item in sourceStats" :key="item.key" class="mini-stat">
          <span>{{ item.label }}</span>
          <strong>{{ item.count }}</strong>
        </div>
      </div>

      <div class="source-list">
        <article v-for="source in sources" :key="source.id" class="source-card">
          <div class="source-card__meta">
            <span class="pill pill-muted">{{ source.format }}</span>
            <span class="pill" :class="source.status === '在线' ? 'pill-active' : 'pill-warn'">{{ source.status }}</span>
          </div>
          <h4>{{ source.name }}</h4>
          <p>{{ source.description }}</p>
          <small>更新时间：{{ source.updatedAt }}</small>
        </article>
      </div>

      <div class="section-heading compact top-gap">
        <div>
          <h3>结构化情报管理</h3>
          <p>支持蓝方侦察、防空、反无与红方人员、装备等示范记录更新。</p>
        </div>
      </div>

      <div class="toolbar-row">
        <label>
          阵营
          <select v-model="campFilter">
            <option value="all">全部</option>
            <option value="blue">蓝方</option>
            <option value="red">红方</option>
          </select>
        </label>
        <label>
          类别
          <select v-model="categoryFilter">
            <option value="all">全部</option>
            <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
          </select>
        </label>
      </div>

      <div class="table-shell">
        <table>
          <thead>
            <tr>
              <th>阵营</th>
              <th>名称</th>
              <th>类别</th>
              <th>状态</th>
              <th>来源</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in filteredIntelligence"
              :key="item.id"
              :class="{ active: item.id === selectedId }"
              @click="selectRecord(item)"
            >
              <td>
                <span class="tag" :class="item.camp === 'blue' ? 'tag-blue' : 'tag-red'">{{ campLabel(item.camp) }}</span>
              </td>
              <td>{{ item.name }}</td>
              <td>{{ item.category }}</td>
              <td>{{ item.readiness }}</td>
              <td>{{ sourceMap.get(item.sourceId) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="glass-card">
      <div class="section-heading compact">
        <div>
          <h3>记录编辑器</h3>
          <p>演示红方人员/装备与蓝方情报的更新管理能力。</p>
        </div>
      </div>

      <div class="form-grid">
        <label>
          名称
          <input v-model="form.name" type="text" />
        </label>
        <label>
          类别
          <input v-model="form.category" type="text" />
        </label>
        <label>
          角色
          <input v-model="form.role" type="text" />
        </label>
        <label>
          状态
          <input v-model="form.readiness" type="text" />
        </label>
        <label>
          强度
          <input v-model.number="form.strength" type="number" min="0" max="10" />
        </label>
        <label>
          纬度
          <input v-model.number="form.latitude" type="number" step="0.01" />
        </label>
        <label>
          经度
          <input v-model.number="form.longitude" type="number" step="0.01" />
        </label>
        <label>
          标签
          <input v-model="form.tagsText" type="text" placeholder="使用逗号分隔" />
        </label>
        <label class="full-span">
          备注
          <textarea v-model="form.notes" rows="4" />
        </label>
      </div>

      <div class="toolbar-row top-gap">
        <button class="button" @click="saveRecord">保存记录</button>
        <span class="muted-text">编辑仅作用于演示数据，用于展示结构化管理流程。</span>
      </div>

      <div class="section-heading compact top-gap">
        <div>
          <h3>战场环境数据</h3>
          <p>地形、气象、电磁等环境信息统一存储与处理。</p>
        </div>
      </div>

      <div class="environment-list">
        <article v-for="item in environment" :key="item.id" class="env-card">
          <div class="env-card__meta">
            <span class="tag tag-neutral">{{ envLabel(item.kind) }}</span>
            <span class="tag" :class="item.riskLevel === '高' ? 'tag-red' : 'tag-green'">风险 {{ item.riskLevel }}</span>
          </div>
          <h4>{{ item.name }}</h4>
          <p>{{ item.weather }}</p>
          <small>{{ item.notes }}</small>
        </article>
      </div>
    </section>
  </div>
</template>

