import { createRouter, createWebHistory } from 'vue-router';

const routes = [
  {
    path: '/login',
    component: () => import('../pages/Login.vue'),
    meta: { guest: true },
  },
  {
    path: '/register',
    component: () => import('../pages/Register.vue'),
    meta: { guest: true },
  },
  {
    path: '/invite/:token',
    component: () => import('../pages/InviteAccept.vue'),
  },
  {
    path: '/',
    component: () => import('../pages/Dashboard.vue'),
    meta: { auth: true },
  },
  {
    path: '/ai',
    component: () => import('../pages/AiChat.vue'),
    meta: { auth: true },
  },
  {
    path: '/settings',
    component: () => import('../pages/UserSettings.vue'),
    meta: { auth: true },
  },
  {
    path: '/org-settings',
    component: () => import('../pages/OrgSettings.vue'),
    meta: { auth: true },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const token = localStorage.getItem('token');

  if (to.meta.auth && !token) {
    return '/login';
  }
  if (to.meta.guest && token) {
    return '/';
  }
});
