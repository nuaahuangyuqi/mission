import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import { restoreSession } from './auth';
import './styles.css';

createApp(App).use(router).mount('#app');
void restoreSession();
