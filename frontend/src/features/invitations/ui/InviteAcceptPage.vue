<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/shared/api/index.js';
import { useAuth } from '@/entities/user/model/use-auth.js';
import { useStatusAnnouncer } from '@/shared/composables/useStatusAnnouncer.js';

const route = useRoute();
const router = useRouter();
const { isLoggedIn } = useAuth();
const { announceError } = useStatusAnnouncer();

type ErrorType = 'invalid' | 'expired' | 'already-member' | 'network' | null;

const invitation = ref<{ email: string; role: string; organization: string } | null>(null);
const errorType = ref<ErrorType>(null);
const loading = ref(true);
const accepting = ref(false);
const acceptError = ref('');

async function fetchInvitation() {
  loading.value = true;
  errorType.value = null;
  invitation.value = null;
  try {
    invitation.value = await api.get(`/invitations/${route.params.token}`);
  } catch (e: any) {
    const status = e?.status ?? e?.response?.status;
    if (status === 404) {
      errorType.value = 'invalid';
      announceError('This invitation link is invalid or has already been used.');
    } else if (status === 410 || status === 400) {
      errorType.value = 'expired';
      announceError('This invitation has expired. Please ask your organization admin for a new invitation.');
    } else if (status === 409) {
      errorType.value = 'already-member';
      announceError('You are already a member of this organization.');
    } else {
      errorType.value = 'network';
      announceError('Unable to load invitation. Please check your connection and try again.');
    }
  } finally {
    loading.value = false;
  }
}

onMounted(fetchInvitation);

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
      announceError('You are already a member of this organization.');
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

    <!-- Error: invalid or already used token (404) -->
    <div
      v-else-if="errorType === 'invalid'"
      role="alert"
      aria-live="assertive"
      class="w-full max-w-sm space-y-4 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center"
    >
      <h1 class="text-2xl font-bold">Invalid invitation link</h1>
      <p class="text-muted-foreground">
        This invitation link is invalid or has already been used.
      </p>
      <a
        href="/"
        class="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Return to Home
      </a>
    </div>

    <!-- Error: expired token (410) -->
    <div
      v-else-if="errorType === 'expired'"
      role="alert"
      aria-live="assertive"
      class="w-full max-w-sm space-y-4 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center"
    >
      <h1 class="text-2xl font-bold">Invitation expired</h1>
      <p class="text-muted-foreground">
        This invitation has expired. Please ask your organization admin for a new invitation.
      </p>
      <a
        href="/"
        class="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Return to Home
      </a>
    </div>

    <!-- Error: network/unknown -->
    <div
      v-else-if="errorType === 'network'"
      role="alert"
      aria-live="assertive"
      class="w-full max-w-sm space-y-4 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center"
    >
      <h1 class="text-2xl font-bold">Unable to load invitation</h1>
      <p class="text-muted-foreground">
        There was a problem loading the invitation. Please check your connection and try again.
      </p>
      <div class="flex flex-col gap-2">
        <button
          @click="fetchInvitation"
          class="inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
        <a
          href="/"
          class="text-sm text-muted-foreground hover:text-foreground underline"
        >
          Return to Home
        </a>
      </div>
    </div>

    <!-- Already a member -->
    <div
      v-else-if="errorType === 'already-member'"
      role="status"
      class="w-full max-w-sm space-y-4 text-center"
    >
      <h1 class="text-2xl font-bold">Already a member</h1>
      <p class="text-muted-foreground">
        You are already a member of this organization.
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
