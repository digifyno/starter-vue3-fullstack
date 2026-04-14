<script setup lang="ts">
import { useRoute } from 'vue-router';
import AppLayout from '@/widgets/app-layout/ui/AppLayout.vue';
import { useAuth } from '@/entities/user/model/use-auth.js';

const route = useRoute();
const { isLoggedIn } = useAuth();
</script>

<template>
  <AppLayout v-if="isLoggedIn && route.meta.auth">
    <router-view />
  </AppLayout>
  <router-view v-else />
</template>
