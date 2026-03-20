<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/shared/api/index.js';
import { useAuth } from '@/entities/user/model/use-auth.js';

const route = useRoute();
const router = useRouter();
const { isLoggedIn } = useAuth();

type ErrorType = 'expired' | 'already-member' | 'unknown' | null;

const invitation = ref<{ email: string; role: string; organization: string } | null>(null);
const errorType = ref<ErrorType>(null);
const loading = ref(true);
const accepting = ref(false);
const acceptError = ref('');

onMounted(async () => {
  try {
    invitation.value = await api.get(`/invitations/${route.params.token}`);
  } catch (e: any) {
    const status = e?.status ?? e?.response?.status;
    if (status === 404 || status === 410 || status === 400) {
      errorType.value = 'expired';
    } else if (status === 409) {
      errorType.value = 'already-member';
    } else {
      errorType.value = 'unknown';
    }
  } finally {
    loading.value = false;
  }
});

async function accept() {
  accepting.value = true;
  acceptError.value = '';
  try {
    await api.post(`/invitations/${route.params.token}/accept`);
    await router.push('/');
    await nextTick();
    const heading = document.querySelector<HTMLElement>('#main-content h2, #main-content h1');
    if (heading) { heading.tabIndex = -1; heading.focus(); }
  } catch (e: any) {
    const status = e?.status ?? e?.response?.status;
    if (status === 409) {
      errorType.value = 'already-member';
    } else {
      acceptError.value = e instanceof Error ? e.message : 'Failed to accept invitation';
    }
  } finally {
    accepting.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background p-4">
    <!-- Loading state: prevents flash of blank content -->
    <div
      v-if="loading"
      class="text-center"
      aria-label="Loading invitation details"
    >
      <div
        class="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-primary border-r-transparent"
        role="status"
      >
        <span class="sr-only">Loading...</span>
      </div>
      <p class="mt-3 text-sm text-muted-foreground">Loading invitation details...</p>
    </div>

    <!-- Error: expired or invalid token -->
    <div
      v-else-if="errorType === 'expired' || errorType === 'unknown'"
      role="alert"
      aria-live="assertive"
      class="w-full max-w-sm space-y-4 text-center"
    >
      <h1 class="text-2xl font-bold">This invitation has expired or is no longer valid</h1>
      <p class="text-muted-foreground">
        Invitation links expire after 7 days. Please contact the person who invited you to request a new invitation.
      </p>
      <a
        href="/"
        class="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Return to Home
      </a>
    </div>

    <!-- Already a member -->
    <div
      v-else-if="errorType === 'already-member'"
      role="status"
      class="w-full max-w-sm space-y-4 text-center"
    >
      <h1 class="text-2xl font-bold">You're already a member</h1>
      <p class="text-muted-foreground">
        You're already part of this organization.
        <a href="/" class="underline hover:text-foreground">Go to dashboard</a>
      </p>
    </div>

    <!-- Valid invitation -->
    <div
      v-else-if="invitation"
      class="w-full max-w-sm space-y-6 text-center"
    >
      <div
        v-if="acceptError"
        role="alert"
        aria-live="assertive"
        class="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
      >
        {{ acceptError }}
      </div>

      <div>
        <h1 class="text-2xl font-bold">You're invited!</h1>
        <p class="mt-2 text-muted-foreground">
          Join <strong>{{ invitation.organization }}</strong> as {{ invitation.role }}
        </p>
      </div>

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
</template>
