<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuth } from '@/entities/user/model/use-auth.js';
import { useOrganization } from '@/entities/org/model/use-organization.js';
import { api } from '@/shared/api/index.js';
import { useStatusAnnouncer } from '@/shared/composables/useStatusAnnouncer.js';

const { user } = useAuth();
const { currentOrg } = useOrganization();

const hubStatus = ref<{ configured: boolean; ai: { connected: boolean }; email: { connected: boolean } } | null>(null);
const hubLoading = ref(true);
const hubError = ref<string | null>(null);
const { announce, announceError } = useStatusAnnouncer();
const chatMessage = ref('');
const chatReply = ref('');
const chatLoading = ref(false);
const chatHistory = ref<Array<{ role: string; content: string }>>([]);

onMounted(async () => {
  hubLoading.value = true;
  hubError.value = null;
  try {
    hubStatus.value = await api.get('/hub/status');
    announce('Hub status loaded');
  } catch {
    hubError.value = 'Unable to reach AI Hub';
    announceError('Unable to reach AI Hub');
  } finally {
    hubLoading.value = false;
  }
});

async function sendChat() {
  if (!chatMessage.value.trim() || chatLoading.value) return;
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
        <div v-if="hubStatus" class="space-y-3">
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
        <p v-else class="text-sm text-muted-foreground">Checking hub connectivity...</p>
      </div>

      <!-- AI Chat Widget -->
      <div class="rounded-lg border border-border bg-card p-6">
        <h3 class="mb-4 text-lg font-semibold">AI Assistant</h3>
        <div v-if="chatReply" class="mb-4 rounded-md bg-muted p-3 text-sm">
          {{ chatReply }}
        </div>
        <form @submit.prevent="sendChat" class="flex gap-2">
          <input
            v-model="chatMessage"
            type="text"
            placeholder="Ask the AI assistant anything..."
            :disabled="chatLoading"
            class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
          <button
            type="submit"
            :disabled="chatLoading || !chatMessage.trim()"
            class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {{ chatLoading ? '...' : 'Send' }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
