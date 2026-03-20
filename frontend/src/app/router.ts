import { createRouter, createWebHistory } from "vue-router";

const routes = [
  {
    path: "/login",
    component: () => import("@/pages/LoginPage.vue"),
    meta: { guest: true, title: "Sign In" },
  },
  {
    path: "/register",
    component: () => import("@/pages/RegisterPage.vue"),
    meta: { guest: true, title: "Create Account" },
  },
  {
    path: "/invite/:token",
    component: () => import("@/pages/InviteAcceptPage.vue"),
    meta: { title: "Accept Invitation" },
  },
  {
    path: "/",
    component: () => import("@/pages/DashboardPage.vue"),
    meta: { auth: true, title: "Dashboard" },
  },
  {
    path: "/ai",
    component: () => import("@/pages/AiChatPage.vue"),
    meta: { auth: true, title: "AI Chat" },
  },
  {
    path: "/settings",
    component: () => import("@/pages/UserSettingsPage.vue"),
    meta: { auth: true, title: "User Settings" },
  },
  {
    path: "/org-settings",
    component: () => import("@/pages/OrgSettingsPage.vue"),
    meta: { auth: true, title: "Organization Settings" },
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

router.afterEach((to) => {
  const baseTitle = "SaaS App";
  const routeTitle = to.meta?.title as string | undefined;
  document.title = routeTitle ? `${routeTitle} — ${baseTitle}` : baseTitle;
});
