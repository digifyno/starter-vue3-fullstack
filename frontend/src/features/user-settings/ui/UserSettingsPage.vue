<script setup lang="ts">
import { ref, onMounted, computed, nextTick } from 'vue';
import { api } from '@/shared/api/index.js';
import { useAuth } from '@/entities/user/model/use-auth.js';
import { useDarkMode } from '@/shared/composables/useDarkMode.js';

const { user, fetchUser, registerPasskey } = useAuth();
const { isDark, toggle } = useDarkMode();

const name = ref('');
const avatarUrl = ref('');
const isSaving = ref(false);
const saveSuccess = ref('');
const saveError = ref('');
const avatarUrlError = ref('');

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
const loadingPasskeys = ref(false);
const fetchPasskeysError = ref('');
const addingPasskey = ref(false);
const newDeviceName = ref('');
const deletingId = ref<string | null>(null);
const addPasskeyButtonRef = ref<HTMLButtonElement | null>(null);

const passkeySupported = computed(
  () => typeof window !== 'undefined' && !!window.PublicKeyCredential,
);

onMounted(async () => {
  name.value = user.value?.name ?? '';
  avatarUrl.value = (user.value as { avatar_url?: string })?.avatar_url ?? '';
  await loadPasskeys();
});

async function loadPasskeys() {
  loadingPasskeys.value = true;
  fetchPasskeysError.value = '';
  try {
    passkeys.value = await api.get<PasskeyInfo[]>('/users/me/passkeys');
  } catch {
    fetchPasskeysError.value = 'Failed to load passkeys. Please try again.';
  } finally {
    loadingPasskeys.value = false;
  }
}

function isValidUrl(url: string): boolean {
  if (!url) return true; // empty is allowed
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

async function save() {
  avatarUrlError.value = '';
  saveSuccess.value = '';
  saveError.value = '';

  if (avatarUrl.value && !isValidUrl(avatarUrl.value)) {
    avatarUrlError.value = 'Please enter a valid URL (starting with http:// or https://)';
    return;
  }

  isSaving.value = true;
  try {
    const body: { name: string; avatar_url?: string } = { name: name.value };
    if (avatarUrl.value !== undefined) body.avatar_url = avatarUrl.value || undefined;
    await api.put('/users/me', body);
    await fetchUser();
    saveSuccess.value = 'Profile updated successfully';
  } catch {
    saveError.value = 'Failed to update profile. Please try again.';
  } finally {
    isSaving.value = false;
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

function passkeyLabel(passkey: PasskeyInfo): string {
  return passkey.device_name
    ? `Remove passkey: ${passkey.device_name}`
    : `Remove passkey registered ${formatDate(passkey.created_at)}`;
}

async function handleDeletePasskey(id: string, deviceLabel: string) {
  if (!confirm(`Remove passkey "${deviceLabel}"? This cannot be undone.`)) return;

  deletingId.value = id;
  passkeyMessage.value = '';
  passkeyError.value = '';
  try {
    await api.delete(`/users/me/passkeys/${id}`);
    passkeyMessage.value = 'Passkey removed';
    await loadPasskeys();
    await nextTick();
    // Move focus to first remaining remove button, or add-passkey button if list is empty
    const firstRemoveBtn = document.querySelector<HTMLButtonElement>('[aria-label^="Remove passkey"]');
    if (firstRemoveBtn) {
      firstRemoveBtn.focus();
    } else {
      addPasskeyButtonRef.value?.focus();
    }
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

      <div>
        <label class="block text-sm font-medium mb-1.5" for="settings-avatar">Avatar URL</label>
        <input
          id="settings-avatar"
          v-model="avatarUrl"
          type="text"
          placeholder="https://example.com/avatar.png"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-hidden focus:ring-2 focus:ring-ring"
        />
        <p v-if="avatarUrlError" role="alert" class="text-red-600 text-sm mt-1">{{ avatarUrlError }}</p>
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

      <div>
        <button
          type="submit"
          :disabled="isSaving"
          :aria-busy="isSaving"
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          :class="isSaving ? 'opacity-50 cursor-not-allowed' : ''"
        >
          {{ isSaving ? 'Saving...' : 'Save changes' }}
        </button>
        <p v-if="saveSuccess" role="status" class="text-green-600 text-sm mt-1">{{ saveSuccess }}</p>
        <p v-if="saveError" role="alert" class="text-red-600 text-sm mt-1">{{ saveError }}</p>
      </div>
    </form>

    <!-- Passkeys section -->
    <div class="space-y-4 border-t pt-6">
      <h3 class="text-lg font-semibold">Security Keys (Passkeys)</h3>
      <p class="text-sm text-muted-foreground">
        Passkeys let you sign in without a password using your device's biometrics or security key.
      </p>

      <template v-if="passkeySupported">
        <!-- Status/error feedback (aria-live region) -->
        <div aria-live="polite" aria-atomic="true">
          <div v-if="passkeyMessage" role="status" class="rounded-md bg-muted p-3 text-sm text-green-700 dark:text-green-400">
            {{ passkeyMessage }}
          </div>
          <div v-if="passkeyError" role="alert" class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {{ passkeyError }}
          </div>
        </div>

        <!-- Loading state -->
        <div
          v-if="loadingPasskeys"
          role="status"
          aria-label="Loading passkeys"
          class="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <span
            class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
          <span>Loading passkeys...</span>
        </div>

        <!-- Error state for fetch -->
        <div v-else-if="fetchPasskeysError" role="alert" class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {{ fetchPasskeysError }}
          <button
            type="button"
            @click="loadPasskeys"
            class="ml-2 underline hover:no-underline"
          >
            Retry
          </button>
        </div>

        <template v-else>
          <!-- List of passkeys -->
          <ul
            v-if="passkeys.length > 0"
            aria-label="Registered passkeys"
            class="space-y-2 list-none p-0 m-0"
          >
            <li
              v-for="passkey in passkeys"
              :key="passkey.id"
              class="flex items-center justify-between rounded-md border border-input p-3"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-base" aria-hidden="true">🔑</span>
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
                :aria-label="passkeyLabel(passkey)"
                @click="handleDeletePasskey(passkey.id, passkey.device_name ?? `passkey registered ${formatDate(passkey.created_at)}`)"
                class="ml-3 shrink-0 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                {{ deletingId === passkey.id ? 'Removing...' : 'Remove' }}
              </button>
            </li>
          </ul>

          <!-- Empty state -->
          <p v-else class="text-sm text-muted-foreground">
            No passkeys registered. Use your device's biometrics or a security key to add one.
          </p>
        </template>

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
            ref="addPasskeyButtonRef"
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
            <span v-else aria-hidden="true">🔑</span>
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
