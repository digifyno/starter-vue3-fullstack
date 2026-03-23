<script setup lang="ts">
import { ref, nextTick, computed } from 'vue';
import { api } from '@/shared/api/index.js';
import { useStatusAnnouncer } from '@/shared/composables/useStatusAnnouncer.js';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const messages = ref<Message[]>([]);
const input = ref('');
const loading = ref(false);
const chatContainer = ref<HTMLElement | null>(null);

const canSend = computed(() => !!input.value.trim() && !loading.value);
const { announceError } = useStatusAnnouncer();

async function send() {
  if (!canSend.value) return;

  const userMessage = input.value;
  input.value = '';
  messages.value.push({ role: 'user', content: userMessage });
  loading.value = true;

  await nextTick();
  chatContainer.value?.scrollTo({ top: chatContainer.value.scrollHeight, behavior: 'smooth' });

  try {
    const res = await api.post<{ reply: string }>('/ai/chat', {
      message: userMessage,
      history: messages.value.slice(0, -1),
    });
    messages.value.push({ role: 'assistant', content: res.reply });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : 'Failed to get response';
    messages.value.push({ role: 'assistant', content: `Error: ${errMsg}` });
    announceError(`Error: ${errMsg}`);
  } finally {
    loading.value = false;
    await nextTick();
    chatContainer.value?.scrollTo({ top: chatContainer.value.scrollHeight, behavior: 'smooth' });
  }
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
}
</script>

<template>
  <div class="flex h-[calc(100vh-7rem)] flex-col">
    <h2 class="mb-4 text-2xl font-bold">AI Chat</h2>

    <!-- Screen reader loading announcement -->
    <div aria-live="polite" aria-atomic="true" class="sr-only">
      {{ loading ? 'Assistant is typing...' : '' }}
    </div>

    <!-- Messages -->
    <div
      ref="chatContainer"
      role="log"
      aria-label="Conversation"
      aria-live="polite"
      aria-atomic="false"
      class="flex-1 space-y-4 overflow-y-auto rounded-lg border border-border bg-card p-4"
    >
      <div v-if="messages.length === 0" class="flex h-full items-center justify-center">
        <p class="text-muted-foreground">Start a conversation with the AI assistant</p>
      </div>

      <div
        v-for="(msg, i) in messages"
        :key="i"
        role="article"
        :aria-label="msg.role === 'user' ? `You: ${msg.content}` : `Assistant: ${msg.content}`"
        class="flex"
        :class="msg.role === 'user' ? 'justify-end' : 'justify-start'"
      >
        <div
          class="max-w-[80%] rounded-lg px-4 py-2 text-sm"
          :class="msg.role === 'user'
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'"
        >
          <pre class="whitespace-pre-wrap font-sans">{{ msg.content }}</pre>
        </div>
      </div>

      <div v-if="loading" class="flex justify-start">
        <div class="rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">Thinking...</div>
      </div>
    </div>

    <!-- Input -->
    <form @submit.prevent="send" class="mt-4 flex gap-2">
      <label for="chat-input" class="sr-only">Type your message</label>
      <textarea
        id="chat-input"
        v-model="input"
        aria-describedby="chat-send-hint"
        placeholder="Type a message..."
        :disabled="loading"
        autofocus
        rows="1"
        class="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring disabled:opacity-50"
        @keydown="handleKeydown"
      />
      <span id="chat-send-hint" class="sr-only">Press Enter to send, Shift+Enter for new line</span>
      <button
        type="submit"
        :disabled="!canSend"
        :aria-disabled="String(!canSend)"
        aria-label="Send message"
        :aria-busy="String(loading)"
        class="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {{ loading ? 'Sending...' : 'Send' }}
      </button>
    </form>
  </div>
</template>
