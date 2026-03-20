<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api/index.js';
import { useAuthStore } from '../stores/auth.js';

interface InvitationDetails {
  id: string;
  organizationId: string;
  organizationName: string;
  inviterName: string;
  inviterEmail: string;
  email: string;
  role: string;
  expiresAt: string;
}

type ErrorState = 'expired' | 'already-member' | 'unknown' | null;

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const token = route.params.token as string;
const loading = ref(true);
const accepting = ref(false);
const invitation = ref<InvitationDetails | null>(null);
const errorState = ref<ErrorState>(null);
const acceptError = ref<string | null>(null);

const isAuthenticated = computed(() => !!authStore.token);

onMounted(async () => {
  try {
    const data = await api.get<InvitationDetails>(`/invitations/${token}`);
    invitation.value = data;
  } catch (err: any) {
    const status = err?.status ?? err?.response?.status;
    if (status === 404 || status === 410 || status === 400) {
      errorState.value = 'expired';
    } else if (status === 409) {
      errorState.value = 'already-member';
    } else {
      errorState.value = 'unknown';
    }
  } finally {
    loading.value = false;
  }
});

async function acceptInvitation() {
  if (!isAuthenticated.value) {
    router.push(`/login?redirect=/invite/${token}`);
    return;
  }

  accepting.value = true;
  acceptError.value = null;

  try {
    await api.post(`/invitations/${token}/accept`, {});
    router.push('/');
  } catch (err: any) {
    const status = err?.status ?? err?.response?.status;
    if (status === 409) {
      errorState.value = 'already-member';
    } else {
      acceptError.value = 'Failed to accept the invitation. Please try again.';
    }
  } finally {
    accepting.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
    <!-- Loading state -->
    <div
      v-if="loading"
      class="text-center"
      aria-label="Loading invitation details"
    >
      <div
        class="inline-block h-10 w-10 animate-spin rounded-full border-4 border-solid border-indigo-600 border-r-transparent"
        role="status"
      >
        <span class="sr-only">Loading...</span>
      </div>
      <p class="mt-4 text-gray-600 dark:text-gray-400">Loading invitation details...</p>
    </div>

    <!-- Error: expired or invalid token -->
    <div
      v-else-if="errorState === 'expired' || errorState === 'unknown'"
      role="alert"
      aria-live="assertive"
      class="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center"
    >
      <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
        <svg
          class="h-7 w-7 text-red-600 dark:text-red-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
      </div>
      <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">
        This invitation has expired or is no longer valid
      </h2>
      <p class="text-gray-600 dark:text-gray-400 mb-6">
        Invitation links expire after 7 days. Please contact the person who invited you to request a new invitation.
      </p>
      <a
        href="/"
        class="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 transition-colors"
      >
        Return to Home
      </a>
    </div>

    <!-- Already a member -->
    <div
      v-else-if="errorState === 'already-member'"
      role="status"
      class="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center"
    >
      <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
        <svg
          class="h-7 w-7 text-green-600 dark:text-green-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke-width="1.5"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      </div>
      <h2 class="text-xl font-semibold text-gray-900 dark:text-white mb-3">
        You're already a member
      </h2>
      <p class="text-gray-600 dark:text-gray-400 mb-6">
        You're already part of this organization.
        <a
          href="/"
          class="text-indigo-600 dark:text-indigo-400 underline hover:text-indigo-500"
        >Go to dashboard</a>
      </p>
    </div>

    <!-- Valid invitation -->
    <div
      v-else-if="invitation"
      class="max-w-md w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8"
    >
      <div class="text-center mb-6">
        <div class="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30">
          <svg
            class="h-7 w-7 text-indigo-600 dark:text-indigo-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
          </svg>
        </div>
        <h2 class="text-xl font-semibold text-gray-900 dark:text-white">
          You've been invited!
        </h2>
        <p class="mt-2 text-gray-600 dark:text-gray-400">
          <strong class="text-gray-900 dark:text-white">{{ invitation.inviterName }}</strong>
          has invited you to join
          <strong class="text-gray-900 dark:text-white">{{ invitation.organizationName }}</strong>
          as a {{ invitation.role }}.
        </p>
      </div>

      <div
        v-if="acceptError"
        role="alert"
        class="mb-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400"
      >
        {{ acceptError }}
      </div>

      <div
        v-if="!isAuthenticated"
        class="mb-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 text-sm text-amber-700 dark:text-amber-400"
      >
        You need to be signed in to accept this invitation.
      </div>

      <button
        type="button"
        :disabled="accepting"
        class="w-full rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        @click="acceptInvitation"
      >
        <span v-if="accepting">Accepting...</span>
        <span v-else-if="!isAuthenticated">Sign in to Accept</span>
        <span v-else>Accept Invitation</span>
      </button>

      <p class="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
        <a
          href="/"
          class="underline hover:text-gray-700 dark:hover:text-gray-200"
        >Decline and return home</a>
      </p>
    </div>
  </div>
</template>
