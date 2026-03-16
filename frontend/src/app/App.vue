<script setup lang="ts">
import { onMounted } from "vue";
import { useRoute } from "vue-router";
import AppLayout from "@/widgets/app-layout/ui/AppLayout.vue";
import { useAuth } from "@/entities/user/model/use-auth.js";

const route = useRoute();
const { fetchUser, isLoggedIn } = useAuth();

onMounted(() => {
  if (isLoggedIn.value) fetchUser();
});

const guestRoutes = ["/login", "/register"];
</script>

<template>
  <AppLayout v-if="isLoggedIn && !guestRoutes.includes(route.path) && !route.path.startsWith('/invite')">
    <router-view />
  </AppLayout>
  <router-view v-else />
</template>
