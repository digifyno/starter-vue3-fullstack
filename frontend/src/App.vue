<script setup lang="ts">
import { onMounted } from 'vue';
import { useRoute } from 'vue-router';
import AppLayout from './components/layout/AppLayout.vue';
import { useAuth } from './composables/useAuth.js';

const route = useRoute();
const { fetchUser, isLoggedIn } = useAuth();

onMounted(() => {
  if (isLoggedIn.value) fetchUser();
});

const guestRoutes = ['/login', '/register'];
</script>

<template>
  <AppLayout v-if="isLoggedIn && !guestRoutes.includes(route.path) && !route.path.startsWith('/invite')">
    <router-view />
  </AppLayout>
  <router-view v-else />
</template>
