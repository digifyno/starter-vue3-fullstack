<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/index.js';
import { useAuth } from '../composables/useAuth.js';

const route = useRoute();
const router = useRouter();
const { isLoggedIn } = useAuth();

const invitation = ref<{ email: string; role: string; organization: string } | null>(null);
const error = ref('');
const accepting = ref(false);

onMounted(async () => {
  try {
    invitation.value = await api.get(`/invitations/${route.params.token}`);
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Invitation not found or expired';
  }
});

async function accept() {
  accepting.value = true;
  try {
    await api.post(`/invitations/${route.params.token}/accept`);
    router.push('/');
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to accept invitation';
  } finally {
    accepting.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background p-4">
    <div class="w-full max-w-sm space-y-6 text-center">
      <div v-if="error" class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
        {{ error }}
      </div>

      <div v-if="invitation">
        <h1 class="text-2xl font-bold">You're invited!</h1>
        <p class="mt-2 text-muted-foreground">
          Join <strong>{{ invitation.organization }}</strong> as {{ invitation.role }}
        </p>

        <div v-if="isLoggedIn" class="mt-6">
          <button
            @click="accept"
            :disabled="accepting"
            class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {{ accepting ? 'Accepting...' : 'Accept invitation' }}
          </button>
        </div>

        <div v-else class="mt-6 space-y-3">
          <p class="text-sm text-muted-foreground">Sign in to accept this invitation</p>
          <router-link
            to="/login"
            class="block w-full rounded-md bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            Sign in
          </router-link>
          <router-link
            to="/register"
            class="block text-sm text-muted-foreground hover:text-foreground"
          >
            Create an account
          </router-link>
        </div>
      </div>
    </div>
  </div>
</template>
