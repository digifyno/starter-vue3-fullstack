<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { api } from '@/shared/api/index.js';
import { useAuth } from '@/entities/user/model/use-auth.js';
import { useDarkMode } from '@/shared/composables/useDarkMode.js';

const { user, fetchUser, registerPasskey } = useAuth();
const { isDark, toggle } = useDarkMode();

const name = ref('');
const saving = ref(false);
const message = ref('');
 const saveError = ref(false);

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

const passkeySupported = computed(
  () => typeof window !== 'undefined' && !!window.PublicKeyCredential,
);

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
    saveError.value = false;
    message.value = 'Settings saved';
  } catch (e) {
    saveError.value = true;
    message.value = e instanceof Error ? e.message : 'Failed to save';
  } finally {
    saving.value = false;
  }
}

function getPasskeyErrorMessage(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError') return 'Authentication was cancelled';
    if (e.name === 'SecurityError') return "This action isn't allowed on this domain";
    if (e.name === 'NotSupportedError') return "This device doesn't support passkeys";
  }
  return 'Something went wrong. Please try again.';
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
    passkeyError.value = getPasskeyErrorMessage(e);
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

    <div v-if="message" :role="saveError ? 'alert' : 'status'" :aria-live="saveError ? 'assertive' : 'polite'" class="rounded-md bg-muted p-3 text-sm">{{ message }}</div>

    <form @submit.prevent="save" class="space-y-4">
      <div>
        <label class="block text-sm font-medium mb-1.5" for="settings-name">Name</label>
        <input
          id="settings-name"
          v-model="name"
          type="text"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-hidden focus:ring-2 focus:ring-ring"
        />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1.5" for="settings-email">Email</label>
        <input
          id="settings-email"
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
        :aria-busy="saving"
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

      <template v-if="passkeySupported">
        <div v-if="passkeyMessage" role="status" aria-live="polite" class="rounded-md bg-muted p-3 text-sm text-green-700 dark:text-green-400">
          {{ passkeyMessage }}
        </div>
        <div v-if="passkeyError" role="alert" aria-live="assertive" class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
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
              :aria-busy="deletingId === passkey.id"
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
          <label class="block text-sm font-medium" for="passkey-name">Device name (optional)</label>
          <input
            id="passkey-name"
            v-model="newDeviceName"
            type="text"
            placeholder="e.g. MacBook, iPhone"
            maxlength="255"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
          <button
            type="button"
            :disabled="addingPasskey"
            :aria-busy="addingPasskey"
            @click="handleAddPasskey"
            class="flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            <span
              v-if="addingPasskey"
              class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
            <span v-else>🔑</span>
            {{ addingPasskey ? 'Adding passkey...' : 'Add passkey' }}
          </button>
        </div>
      </template>

      <p v-else role="alert" class="text-sm text-muted-foreground">
        Your browser doesn't support passkeys.
      </p>
    </div>
  </div>
</template>
