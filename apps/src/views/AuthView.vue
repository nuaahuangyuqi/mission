<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { login, register } from '../auth';

const route = useRoute();
const router = useRouter();
const mode = ref('login');
const busy = ref(false);
const errorMessage = ref('');

const loginForm = ref({ username: 'admin', password: '123456' });
const registerForm = ref({ username: '', password: '', confirmPassword: '' });
const redirectTarget = computed(() => route.query.redirect?.toString() || '/');

async function submitLogin() {
  errorMessage.value = '';
  busy.value = true;
  try {
    await login(loginForm.value);
    router.replace(redirectTarget.value);
  } catch (error) {
    errorMessage.value = error.message || '登录失败，请稍后重试。';
  } finally {
    busy.value = false;
  }
}

async function submitRegister() {
  errorMessage.value = '';
  if (registerForm.value.password !== registerForm.value.confirmPassword) {
    errorMessage.value = '两次输入的密码不一致。';
    return;
  }

  busy.value = true;
  try {
    await register({
      username: registerForm.value.username,
      password: registerForm.value.password,
    });
    router.replace(redirectTarget.value);
  } catch (error) {
    errorMessage.value = error.message || '注册失败，请稍后重试。';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="auth-shell">
    <section class="auth-card">
      <div>
        <span class="eyebrow">Learning Demo / 权限验证</span>
        <h1>任务规划系统</h1>
        <p class="muted-text">使用统一账号进入任务中心、数据服务、能力评估与规划工作台。</p>
      </div>

      <div class="segmented-row wide auth-tabs">
        <button class="segmented" :class="{ active: mode === 'login' }" @click="mode = 'login'">登录</button>
        <button class="segmented" :class="{ active: mode === 'register' }" @click="mode = 'register'">注册</button>
      </div>

      <p v-if="errorMessage" class="auth-error">{{ errorMessage }}</p>

      <form v-if="mode === 'login'" class="stack-grid" @submit.prevent="submitLogin">
        <label>
          用户名
          <input v-model="loginForm.username" type="text" autocomplete="username" />
        </label>
        <label>
          密码
          <input v-model="loginForm.password" type="password" autocomplete="current-password" />
        </label>
        <button class="button" type="submit" :disabled="busy">{{ busy ? '登录中...' : '进入系统' }}</button>
      </form>

      <form v-else class="stack-grid" @submit.prevent="submitRegister">
        <label>
          用户名
          <input v-model="registerForm.username" type="text" autocomplete="username" />
        </label>
        <label>
          密码
          <input v-model="registerForm.password" type="password" autocomplete="new-password" />
        </label>
        <label>
          确认密码
          <input v-model="registerForm.confirmPassword" type="password" autocomplete="new-password" />
        </label>
        <button class="button" type="submit" :disabled="busy">{{ busy ? '注册中...' : '注册并进入' }}</button>
      </form>
    </section>
  </div>
</template>
