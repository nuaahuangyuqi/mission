<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import ModuleCard from '../components/ModuleCard.vue';
import PageBrand from '../components/PageBrand.vue';
import { api } from '../api';
import { authState, logout } from '../auth';

const router = useRouter();
const overview = ref(null);
const loading = ref(true);
const users = ref([]);
const recentTasks = ref([]);
const userSavingId = ref('');
const userMessage = ref('');
const userDrafts = reactive({});

const counts = computed(() => overview.value?.counts || {});
const currentUser = computed(() => authState.user || { username: '', role: 'user' });
const isAdmin = computed(() => currentUser.value.role === 'admin');

const entryCards = computed(() => ([
  {
    key: 'task-center',
    title: '总任务中心',
    description: '统一管理任务创建、任务上下文、执行入口与历史回看。',
    meta: `我的任务 ${recentTasks.value.length} 项`,
    status: 'active',
  },
  {
    key: 'data',
    title: '数据信息服务',
    description: '负责资源接入、抽取追溯、知识图谱与专题态势底座。',
    meta: `数据源 ${counts.value.sources || 0} 个`,
    status: 'active',
  },
  {
    key: 'capability',
    title: '能力评估',
    description: '维护指标库、构建指标树并生成多算法融合评估结果。',
    meta: '指标树 / 评分 / 图表',
    status: 'active',
  },
  {
    key: 'action',
    title: '行动计算',
    description: '围绕共同任务自动生成功能链，完成方案建模与结果预测。',
    meta: '功能链 / 风险 / 资源代价',
    status: 'active',
  },
  {
    key: 'consumption',
    title: '消耗计算',
    description: '从任务基线推导损耗、战损与保障消耗结果。',
    meta: '基线 / 战损 / 消耗预测',
    status: 'active',
  },
  {
    key: 'planning',
    title: '智能任务规划',
    description: '完成规划算法配置、任务编排、执行归档和成果导出。',
    meta: '算法库 / 任务库 / 结果包',
    status: 'active',
  },
]));

function syncUserDrafts(list) {
  for (const item of list) {
    userDrafts[item.id] = {
      role: item.role,
      status: item.status,
    };
  }
}

async function loadUsers() {
  if (!isAdmin.value) {
    users.value = [];
    return;
  }

  users.value = await api.getUsers();
  syncUserDrafts(users.value);
}

async function loadRecentTasks() {
  const payload = await api.getTasks({ mine: true });
  recentTasks.value = Array.isArray(payload?.tasks) ? payload.tasks.slice(0, 4) : [];
}

onMounted(async () => {
  try {
    overview.value = await api.getOverview();
    await Promise.all([loadUsers(), loadRecentTasks()]);
  } finally {
    loading.value = false;
  }
});

function enterModule(moduleKey) {
  if (moduleKey === 'task-center') {
    router.push({ name: 'task-center-list' });
    return;
  }

  if (moduleKey === 'data') {
    router.push('/data-service');
    return;
  }

  if (moduleKey === 'capability') {
    router.push({ name: 'capability-library' });
    return;
  }

  if (moduleKey === 'action') {
    router.push({ name: 'action-task' });
    return;
  }

  if (moduleKey === 'consumption') {
    router.push({ name: 'consumption-scenario' });
    return;
  }

  if (moduleKey === 'planning') {
    router.push({ name: 'planning-algorithms' });
  }
}

async function saveUser(user) {
  userMessage.value = '';
  userSavingId.value = String(user.id);
  try {
    await api.updateUser(user.id, userDrafts[user.id]);
    await loadUsers();
    userMessage.value = '用户权限已更新。';
  } catch (error) {
    userMessage.value = error.message || '更新用户权限失败。';
  } finally {
    userSavingId.value = '';
  }
}

async function handleLogout() {
  await logout();
  router.replace('/login');
}
</script>

<template>
  <div class="page-shell home-shell">
    <header class="glass-card home-topbar">
      <div class="home-topbar__brand">
        <PageBrand compact />
      </div>

      <div class="home-topbar__stats">
        <div class="home-topbar__stat">
          <span>数据源</span>
          <strong>{{ loading ? '...' : counts.sources || 0 }}</strong>
        </div>
        <div class="home-topbar__stat">
          <span>情报记录</span>
          <strong>{{ loading ? '...' : counts.intelligence || 0 }}</strong>
        </div>
        <div class="home-topbar__stat">
          <span>环境要素</span>
          <strong>{{ loading ? '...' : counts.environment || 0 }}</strong>
        </div>
      </div>

      <div class="home-topbar__session">
        <div class="home-topbar__account">
          <span>当前账号</span>
          <strong>{{ currentUser.username }}</strong>
          <small>{{ currentUser.role === 'admin' ? '管理员' : '用户' }}</small>
        </div>
        <button class="button button-ghost home-topbar__logout" @click="handleLogout">退出登录</button>
      </div>
    </header>

    <section class="panel-section">
      <div class="section-heading">
        <div>
          <h2>任务与业务入口</h2>
          <p>优先进入任务中心，其余工作区按业务职责展开。</p>
        </div>
      </div>

      <div class="module-grid">
        <ModuleCard
          v-for="item in entryCards"
          :key="item.key"
          :title="item.title"
          :description="item.description"
          :meta="item.meta"
          :status="item.status"
          @enter="enterModule(item.key)"
        />
      </div>
    </section>

    <section class="panel-section">
      <div class="section-heading">
        <div>
          <h2>最近任务</h2>
          <p>任务中心接入后，首页只保留简洁的最近任务回看入口。</p>
        </div>
      </div>

      <div v-if="!recentTasks.length" class="glass-card detail-card">
        <p class="muted-text">当前账号下还没有任务记录，可直接进入任务中心创建。</p>
      </div>

      <div v-else class="module-grid">
        <article v-for="task in recentTasks" :key="task.id" class="detail-card home-task-card">
          <span class="pill" :class="task.status === 'draft' ? 'pill-muted' : 'pill-active'">{{ task.status || 'draft' }}</span>
          <h3>{{ task.name }}</h3>
          <p>{{ task.description || '暂无任务说明。' }}</p>
          <div class="home-task-card__meta">
            <span>模块：{{ task.moduleKey || '--' }}</span>
            <span>模板：{{ task.planningTemplateId || '--' }}</span>
          </div>
          <button class="button button-ghost" @click="router.push({ name: 'task-center-detail', params: { id: task.id } })">查看任务</button>
        </article>
      </div>
    </section>

    <section class="panel-section" v-if="isAdmin">
      <div class="glass-card admin-user-shell">
        <div class="section-heading compact">
          <div>
            <h3>用户与权限管理</h3>
          </div>
          <span class="pill pill-active">共 {{ users.length }} 个账号</span>
        </div>

        <p v-if="userMessage" class="muted-text">{{ userMessage }}</p>

        <div class="table-shell top-gap">
          <table>
            <thead>
              <tr>
                <th>用户名</th>
                <th>角色</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="user in users" :key="user.id">
                <td>{{ user.username }}</td>
                <td>
                  <select v-model="userDrafts[user.id].role">
                    <option value="user">用户</option>
                    <option value="admin">管理员</option>
                  </select>
                </td>
                <td>
                  <select v-model="userDrafts[user.id].status">
                    <option value="active">启用</option>
                    <option value="disabled">停用</option>
                  </select>
                </td>
                <td>{{ user.createdAt }}</td>
                <td>
                  <button class="button button-ghost" :disabled="userSavingId === String(user.id)" @click="saveUser(user)">
                    {{ userSavingId === String(user.id) ? '保存中...' : '保存' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </div>
</template>
