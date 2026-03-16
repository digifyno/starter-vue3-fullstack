<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/shared/api/index.js';
import { useAuth } from '@/entities/user/model/use-auth.js';
import { useDarkMode } from '@/shared/composables/useDarkMode.js';

const { user, fetchUser, registerPasskey } = useAuth();
const { isDark, toggle } = useDarkMode();

const name = ref('');
const saving = ref(false);
const message = ref('');

// Passkeys state
interface PasskeyInfo {
  id: string;
  credential_id: string;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
  backed_up: boolean;
}

const passkeys = ref<PasskeyInfo[]>([]);
const passkeyMessage = ref('');
const passkeyError = ref('');
const addingPasskey = ref(false);
const newDeviceName = ref('');
const deletingId = ref<string | null>(null);

onMounted(async () => {
  name.value = user.value?.name ?? '';
  await loadPasskeys();
});

async function loadPasskeys() {
  try {
    passkeys.value = await api.get<PasskeyInfo[]>('/users/me/passkeys');
  } catch {
    // If not available (e.g. not logged in), ignore
  }
}

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

async function handleAddPasskey() {
  addingPasskey.value = true;
  passkeyMessage.value = '';
  passkeyError.value = '';
  try {
    await registerPasskey(newDeviceName.value || undefined);
    newDeviceName.value = '';
    passkeyMessage.value = 'Passkey added successfully';
    await loadPasskeys();
  } catch (e) {
    passkeyError.value = e instanceof Error ? e.message : 'Failed to add passkey';
  } finally {
    addingPasskey.value = false;
  }
}

async function handleDeletePasskey(id: string) {
  deletingId.value = id;
  passkeyMessage.value = '';
  passkeyError.value = '';
  try {
    await api.delete(`/users/me/passkeys/${id}`);
    passkeyMessage.value = 'Passkey removed';
    await loadPasskeys();
  } catch (e) {
    passkeyError.value = e instanceof Error ? e.message : 'Failed to remove passkey';
  } finally {
    deletingId.value = null;
  }
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
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
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-hidden focus:ring-2 focus:ring-ring"
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

    <!-- Passkeys section -->
    <div class="space-y-4 border-t pt-6">
      <h3 class="text-lg font-semibold">Security Keys (Passkeys)</h3>
      <p class="text-sm text-muted-foreground">
        Passkeys let you sign in without a password using your device's biometrics or security key.
      </p>

      <div v-if="passkeyMessage" class="rounded-md bg-muted p-3 text-sm text-green-700 dark:text-green-400">
        {{ passkeyMessage }}
      </div>
      <div v-if="passkeyError" class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
        {{ passkeyError }}
      </div>

      <!-- List of passkeys -->
      <div v-if="passkeys.length > 0" class="space-y-2">
        <div
          v-for="passkey in passkeys"
          :key="passkey.id"
          class="flex items-center justify-between rounded-md border border-input p-3"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-base">🔑</span>
              <span class="text-sm font-medium truncate">{{ passkey.device_name ?? 'Unnamed passkey' }}</span>
              <span v-if="passkey.backed_up" class="text-xs text-muted-foreground">(synced)</span>
            </div>
            <div class="mt-1 text-xs text-muted-foreground">
              Added {{ formatDate(passkey.created_at) }}
              <span v-if="passkey.last_used_at"> · Last used {{ formatDate(passkey.last_used_at) }}</span>
            </div>
          </div>
          <button
            type="button"
            :disabled="deletingId === passkey.id"
            @click="handleDeletePasskey(passkey.id)"
            class="ml-3 shrink-0 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {{ deletingId === passkey.id ? 'Removing...' : 'Remove' }}
          </button>
        </div>
      </div>
      <p v-else class="text-sm text-muted-foreground">No passkeys registered yet.</p>

      <!-- Add passkey form -->
      <div class="space-y-2">
        <label class="block text-sm font-medium">Device name (optional)</label>
        <input
          v-model="newDeviceName"
          type="text"
          placeholder="e.g. MacBook, iPhone"
          maxlength="255"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-hidden focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          :disabled="addingPasskey"
          @click="handleAddPasskey"
          class="flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <span>🔑</span>
          {{ addingPasskey ? 'Adding passkey...' : 'Add passkey' }}
        </button>
      </div>
    </div>
  </div>
</template>
