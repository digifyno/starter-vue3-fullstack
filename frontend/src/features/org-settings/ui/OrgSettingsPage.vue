<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue';
import { api, ApiError } from '@/shared/api/index.js';
import { useStatusAnnouncer } from '@/shared/composables/useStatusAnnouncer.js';
import { useOrganization } from '@/entities/org/model/use-organization.js';

const { currentOrg, currentOrgId } = useOrganization();
const { announce, announceError } = useStatusAnnouncer();

const orgName = ref('');
const members = ref<Array<{ user_id: string; email: string; name: string; role: string }>>([]);
const inviteEmail = ref('');

const isUpdatingName = ref(false);
const nameError = ref('');
const nameSuccess = ref('');

const isInviting = ref(false);
const inviteError = ref('');
const inviteSuccess = ref('');

const isRemoving = ref(false);
const removeError = ref('');

const confirmDialog = ref({ open: false, memberId: '', memberName: '' });
const dialogRef = ref<HTMLElement | null>(null);
const cancelBtnRef = ref<HTMLButtonElement | null>(null);
const triggerRef = ref<HTMLElement | null>(null);

onMounted(async () => {
  orgName.value = currentOrg.value?.name || '';
  await loadMembers();
});

async function loadMembers() {
  try {
    members.value = await api.get(`/organizations/${currentOrgId.value}/members`);
  } catch { /* ignore */ }
}

async function saveOrg() {
  isUpdatingName.value = true;
  nameError.value = '';
  nameSuccess.value = '';
  try {
    await api.put(`/organizations/${currentOrgId.value}`, { name: orgName.value });
    nameSuccess.value = 'Organization updated';
    announce('Organization updated');
  } catch (e) {
    nameError.value = e instanceof Error ? e.message : 'Failed to save';
    announceError(e instanceof Error ? e.message : 'Failed to save');
  } finally {
    isUpdatingName.value = false;
  }
}

async function sendInvite() {
  if (!inviteEmail.value) return;
  isInviting.value = true;
  inviteError.value = '';
  inviteSuccess.value = '';
  try {
    await api.post('/invitations', { email: inviteEmail.value });
    inviteSuccess.value = `Invitation sent to ${inviteEmail.value}`;
    announce(`Invitation sent to ${inviteEmail.value}`);
    inviteEmail.value = '';
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      inviteError.value = 'This email is already a member of your organization';
      announceError('This email is already a member of your organization');
    } else if (e instanceof ApiError && (e.status === 422 || e.status === 400)) {
      inviteError.value = 'Please enter a valid email address';
      announceError('Please enter a valid email address');
    } else {
      inviteError.value = e instanceof Error ? e.message : 'Failed to send invitation';
      announceError(e instanceof Error ? e.message : 'Failed to send invitation');
    }
  } finally {
    isInviting.value = false;
  }
}

function openDialog(memberId: string, memberName: string, event: Event) {
  triggerRef.value = event.currentTarget as HTMLElement;
  confirmDialog.value = { open: true, memberId, memberName };
  nextTick(() => cancelBtnRef.value?.focus());
}

function closeDialog() {
  confirmDialog.value = { open: false, memberId: '', memberName: '' };
  removeError.value = '';
  nextTick(() => triggerRef.value?.focus());
}

async function confirmRemove() {
  isRemoving.value = true;
  removeError.value = '';
  try {
    await api.delete(`/organizations/${currentOrgId.value}/members/${confirmDialog.value.memberId}`);
    announce(`${confirmDialog.value.memberName} has been removed`);
    closeDialog();
    await loadMembers();
  } catch (e) {
    removeError.value = e instanceof Error ? e.message : 'Failed to remove member';
    announceError(removeError.value);
  } finally {
    isRemoving.value = false;
  }
}

function trapFocus(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeDialog();
    return;
  }
  if (event.key !== 'Tab' || !dialogRef.value) return;
  const focusable = Array.from(
    dialogRef.value.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<template>
  <div class="max-w-lg space-y-8">
    <h2 class="text-2xl font-bold">Organization Settings</h2>

    <!-- Org details -->
    <form @submit.prevent="saveOrg" class="space-y-4">
      <div>
        <label class="block text-sm font-medium mb-1.5" for="org-name">Organization name</label>
        <input
          id="org-name"
          v-model="orgName"
          type="text"
          :aria-describedby="nameError ? 'org-name-error' : undefined"
          :aria-invalid="nameError ? 'true' : undefined"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-hidden focus:ring-2 focus:ring-ring"
        />
        <p v-if="nameError" id="org-name-error" role="alert" class="text-red-600 text-sm mt-1">{{ nameError }}</p>
        <p v-if="nameSuccess" role="status" class="text-green-600 text-sm mt-1">{{ nameSuccess }}</p>
      </div>
      <button
        type="submit"
        :disabled="isUpdatingName"
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        :class="isUpdatingName ? 'opacity-50 cursor-not-allowed' : ''"
      >
        {{ isUpdatingName ? 'Saving...' : 'Save' }}
      </button>
    </form>

    <!-- Members -->
    <div>
      <h3 class="mb-3 text-lg font-semibold">Members</h3>
      <div class="space-y-2">
        <template v-if="members.length === 0">
          <div class="text-center py-8 text-gray-500 dark:text-gray-400">
            <p class="mb-2">No other members yet.</p>
            <p class="text-sm">Use the invite form below to add your first team member.</p>
          </div>
        </template>
        <template v-else>
          <div
            v-for="member in members"
            :key="member.user_id"
            class="flex items-center justify-between rounded-md border border-border px-4 py-3"
          >
            <div>
              <p class="text-sm font-medium">{{ member.name }}</p>
              <p class="text-xs text-muted-foreground">{{ member.email }}</p>
            </div>
            <div class="flex items-center gap-2">
              <span class="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">{{ member.role }}</span>
              <button
                type="button"
                :aria-label="`Remove ${member.name}`"
                @click="openDialog(member.user_id, member.name, $event)"
                class="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
              >
                Remove
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Invite -->
    <div>
      <h3 class="mb-3 text-lg font-semibold">Invite member</h3>
      <form @submit.prevent="sendInvite" class="space-y-2">
        <div class="flex gap-2">
          <input
            id="invite-email"
            v-model="inviteEmail"
            type="email"
            placeholder="colleague@example.com"
            :aria-describedby="inviteError ? 'invite-email-error' : undefined"
            :aria-invalid="inviteError ? 'true' : undefined"
            class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            :disabled="!inviteEmail || isInviting"
            class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            :class="(!inviteEmail || isInviting) ? 'opacity-50 cursor-not-allowed' : ''"
          >
            {{ isInviting ? 'Inviting...' : 'Invite' }}
          </button>
        </div>
        <p v-if="inviteError" id="invite-email-error" role="alert" class="text-red-600 text-sm mt-1">{{ inviteError }}</p>
        <p v-if="inviteSuccess" role="status" class="text-green-600 text-sm mt-1">{{ inviteSuccess }}</p>
      </form>
    </div>

    <!-- Member removal confirmation dialog -->
    <div
      v-if="confirmDialog.open"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="closeDialog"
    >
      <div
        ref="dialogRef"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-desc"
        class="relative rounded-lg bg-background p-6 shadow-lg w-full max-w-sm mx-4"
        @keydown="trapFocus"
      >
        <h2 id="confirm-title" class="text-lg font-semibold">Remove Member</h2>
        <p id="confirm-desc" class="mt-2 text-sm text-muted-foreground">
          Are you sure you want to remove <strong>{{ confirmDialog.memberName }}</strong> from the
          organization? This action cannot be undone.
        </p>
        <p v-if="removeError" role="alert" class="mt-2 text-sm text-red-600">{{ removeError }}</p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            ref="cancelBtnRef"
            type="button"
            @click="closeDialog"
            class="rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            :disabled="isRemoving"
            @click="confirmRemove"
            class="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            :class="isRemoving ? 'opacity-50 cursor-not-allowed' : ''"
          >
            {{ isRemoving ? 'Removing...' : 'Remove' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
