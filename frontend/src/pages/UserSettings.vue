<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api/index.js';
import { useAuth } from '../composables/useAuth.js';
import { useDarkMode } from '../composables/useDarkMode.js';

const { user, fetchUser } = useAuth();
const { isDark, toggle } = useDarkMode();

const name = ref('');
const saving = ref(false);
const message = ref('');

onMounted(() => {
  name.value = user.value?.name || '';
});

async function save() {
  saving.value = true;
  message.value = '';
  try {
    await api.put('/users/me', { name: name.value });
    await fetchUser();
    message.value = 'Settings saved';
  } catch (e) {
    message.value = e instanceof Error ? e.message : 'Failed to save';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="max-w-lg space-y-6">
    <h2 class="text-2xl font-bold">User Settings</h2>

    <div v-if="message" class="rounded-md bg-muted p-3 text-sm">{{ message }}</div>

    <form @submit.prevent="save" class="space-y-4">
      <div>
        <label class="block text-sm font-medium mb-1.5">Name</label>
        <input
          v-model="name"
          type="text"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1.5">Email</label>
        <input
          :value="user?.email"
          type="email"
          disabled
          class="w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground"
        />
      </div>

      <div class="flex items-center justify-between">
        <label class="text-sm font-medium">Dark mode</label>
        <button
          type="button"
          @click="toggle"
          class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
          :class="isDark ? 'bg-primary' : 'bg-input'"
        >
          <span
            class="inline-block h-4 w-4 rounded-full bg-white transition-transform"
            :class="isDark ? 'translate-x-6' : 'translate-x-1'"
          />
        </button>
      </div>

      <button
        type="submit"
        :disabled="saving"
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {{ saving ? 'Saving...' : 'Save changes' }}
      </button>
    </form>
  </div>
</template>
