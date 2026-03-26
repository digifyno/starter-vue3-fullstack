<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useAuth } from '@/entities/user/model/use-auth.js';
import { useOrganization } from '@/entities/org/model/use-organization.js';
import { api } from '@/shared/api/index.js';
import { useStatusAnnouncer } from '@/shared/composables/useStatusAnnouncer.js';

const MAX_MESSAGE_LENGTH = 4000;
const WARN_THRESHOLD = Math.floor(MAX_MESSAGE_LENGTH * 0.9);

const { user } = useAuth();
const { currentOrg } = useOrganization();

const hubStatus = ref<{ configured: boolean; ai: { connected: boolean }; email: { connected: boolean } } | null>(null);
const loading = ref(true);
const hubError = ref<string | null>(null);
const { announce, announceError } = useStatusAnnouncer();
const chatMessage = ref('');
const chatReply = ref('');
const chatLoading = ref(false);
const chatHistory = ref<Array<{ role: string; content: string }>>([]);

const chatCharCount = computed(() => chatMessage.value.length);
const isChatOverLimit = computed(() => chatCharCount.value > MAX_MESSAGE_LENGTH);
const isChatNearLimit = computed(() => chatCharCount.value >= WARN_THRESHOLD && !isChatOverLimit.value);
const canSendChat = computed(() => !!chatMessage.value.trim() && !chatLoading.value && !isChatOverLimit.value);

async function fetchHubStatus() {
  loading.value = true;
  hubError.value = null;
  try {
    hubStatus.value = await api.get('/hub/status');
    announce('Hub status loaded');
  } catch {
    hubError.value = 'Hub unavailable';
    announceError('Hub unavailable');
  } finally {
    loading.value = false;
  }
}

onMounted(fetchHubStatus);

async function sendChat() {
  if (!canSendChat.value) return;
  const message = chatMessage.value;
  chatMessage.value = '';
  chatLoading.value = true;
  chatReply.value = '';

  try {
    const res = await api.post<{ reply: string }>('/ai/chat', {
      message,
      history: chatHistory.value,
    });
    chatHistory.value.push({ role: 'user', content: message });
    chatHistory.value.push({ role: 'assistant', content: res.reply });
    chatReply.value = res.reply;
  } catch (e) {
    const chatErrMsg = e instanceof Error ? e.message : 'Failed to get response';
    chatReply.value = chatErrMsg;
    announceError(chatErrMsg);
  } finally {
    chatLoading.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Welcome -->
    <div>
      <h2 class="text-2xl font-bold">Welcome back, {{ user?.name || 'there' }}</h2>
      <p class="text-muted-foreground">
        {{ currentOrg ? `Organization: ${currentOrg.name}` : 'No organization selected' }}
      </p>
    </div>

    <div class="grid gap-6 md:grid-cols-2">
      <!-- Hub Status Card -->
      <div class="rounded-lg border border-border bg-card p-6">
        <h3 class="mb-4 text-lg font-semibold">Hub Status</h3>

        <!-- Loading state -->
        <div v-if="loading" class="flex items-center gap-3 py-2">
          <svg
            aria-label="Loading"
            class="h-5 w-5 animate-spin text-muted-foreground"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span class="text-sm text-muted-foreground">Checking hub connectivity...</span>
        </div>

        <!-- Error state -->
        <div v-else-if="hubError" role="alert" class="space-y-3">
          <p class="text-sm text-destructive">{{ hubError }}</p>
          <button
            type="button"
            class="rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground hover:bg-secondary/80"
            @click="fetchHubStatus"
          >
            Retry
          </button>
        </div>

        <!-- Connected state -->
        <div v-else-if="hubStatus" class="space-y-3">
          <div class="flex items-center justify-between">
            <span class="text-sm text-muted-foreground">AI Hub</span>
            <span class="flex items-center gap-2 text-sm">
              <span class="h-2 w-2 rounded-full" :class="hubStatus.ai.connected ? 'bg-green-500' : 'bg-red-500'" />
              {{ hubStatus.ai.connected ? 'Connected' : 'Disconnected' }}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-muted-foreground">Email Hub</span>
            <span class="flex items-center gap-2 text-sm">
              <span class="h-2 w-2 rounded-full" :class="hubStatus.email.connected ? 'bg-green-500' : 'bg-red-500'" />
              {{ hubStatus.email.connected ? 'Connected' : 'Disconnected' }}
            </span>
          </div>
        </div>
      </div>

      <!-- AI Chat Widget -->
      <div class="rounded-lg border border-border bg-card p-6">
        <h3 class="mb-4 text-lg font-semibold">AI Assistant</h3>
        <div v-if="chatReply" class="mb-4 rounded-md bg-muted p-3 text-sm">
          {{ chatReply }}
        </div>
        <form @submit.prevent="sendChat" class="flex flex-col gap-1">
          <div class="flex gap-2">
            <input
              v-model="chatMessage"
              type="text"
              placeholder="Ask the AI assistant anything..."
              :disabled="chatLoading"
              class="flex-1 rounded-md border px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring disabled:opacity-50"
              :class="isChatOverLimit
                ? 'border-destructive bg-destructive/5 focus:ring-destructive'
                : 'border-input bg-background'"
            />
            <button
              type="submit"
              :disabled="!canSendChat"
              class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {{ chatLoading ? '...' : 'Send' }}
            </button>
          </div>
          <div class="flex items-center justify-end gap-2">
            <p
              v-if="isChatOverLimit"
              role="alert"
              class="text-xs text-destructive"
            >
              Message is too long.
            </p>
            <p
              v-else-if="isChatNearLimit"
              class="text-xs text-amber-600 dark:text-amber-400"
            >
              Approaching limit
            </p>
            <span
              class="text-xs"
              :class="isChatOverLimit ? 'text-destructive font-medium' : isChatNearLimit ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'"
            >
              {{ chatCharCount }} / {{ MAX_MESSAGE_LENGTH }}
            </span>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
