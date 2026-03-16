import { createRouter, createWebHistory } from "vue-router";

const routes = [
  {
    path: "/login",
    component: () => import("@/pages/LoginPage.vue"),
    meta: { guest: true },
  },
  {
    path: "/register",
    component: () => import("@/pages/RegisterPage.vue"),
    meta: { guest: true },
  },
  {
    path: "/invite/:token",
    component: () => import("@/pages/InviteAcceptPage.vue"),
  },
  {
    path: "/",
    component: () => import("@/pages/DashboardPage.vue"),
    meta: { auth: true },
  },
  {
    path: "/ai",
    component: () => import("@/pages/AiChatPage.vue"),
    meta: { auth: true },
  },
  {
    path: "/settings",
    component: () => import("@/pages/UserSettingsPage.vue"),
    meta: { auth: true },
  },
  {
    path: "/org-settings",
    component: () => import("@/pages/OrgSettingsPage.vue"),
    meta: { auth: true },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const token = localStorage.getItem("token");

  if (to.meta.auth && !token) {
    return "/login";
  }
  if (to.meta.guest && token) {
    return "/";
  }
  return true;
});
