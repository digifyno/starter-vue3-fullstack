<script setup lang="ts">
import { ref, nextTick } from 'vue';
import { api } from '../api/index.js';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const messages = ref<Message[]>([]);
const input = ref('');
const loading = ref(false);
const chatContainer = ref<HTMLElement | null>(null);

async function send() {
  if (!input.value.trim() || loading.value) return;

  const userMessage = input.value;
  input.value = '';
  messages.value.push({ role: 'user', content: userMessage });
  loading.value = true;

  await nextTick();
  chatContainer.value?.scrollTo({ top: chatContainer.value.scrollHeight, behavior: 'smooth' });

  try {
    const res = await api.post<{ reply: string }>('/ai/chat', {
      message: userMessage,
      history: messages.value.slice(0, -1), // exclude the message we just added
    });
    messages.value.push({ role: 'assistant', content: res.reply });
  } catch (e) {
    messages.value.push({ role: 'assistant', content: `Error: ${e instanceof Error ? e.message : 'Failed to get response'}` });
  } finally {
    loading.value = false;
    await nextTick();
    chatContainer.value?.scrollTo({ top: chatContainer.value.scrollHeight, behavior: 'smooth' });
  }
}
</script>

<template>
  <div class="flex h-[calc(100vh-7rem)] flex-col">
    <h2 class="mb-4 text-2xl font-bold">AI Chat</h2>

    <!-- Messages -->
    <div ref="chatContainer" class="flex-1 space-y-4 overflow-y-auto rounded-lg border border-border bg-card p-4">
      <div v-if="messages.length === 0" class="flex h-full items-center justify-center">
        <p class="text-muted-foreground">Start a conversation with the AI assistant</p>
      </div>

      <div
        v-for="(msg, i) in messages"
        :key="i"
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
      <input
        v-model="input"
        type="text"
        placeholder="Type a message..."
        :disabled="loading"
        autofocus
        class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
      />
      <button
        type="submit"
        :disabled="loading || !input.trim()"
        class="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        Send
      </button>
    </form>
  </div>
</template>
