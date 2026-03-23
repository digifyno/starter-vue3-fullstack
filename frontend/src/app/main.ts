import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router.js';
import './style.css';
import { useAuth } from '@/entities/user/model/use-auth.js';

const app = createApp(App);
app.use(createPinia());

// Initialize auth state before mounting so the router guard has accurate isLoggedIn on first navigation
const { fetchUser } = useAuth();
await fetchUser().catch(() => {}); // silent fail = not authenticated

app.use(router);
app.mount('#app');
