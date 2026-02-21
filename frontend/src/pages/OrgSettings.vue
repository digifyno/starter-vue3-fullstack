<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api/index.js';
import { useOrganization } from '../composables/useOrganization.js';

const { currentOrg, currentOrgId } = useOrganization();

const orgName = ref('');
const members = ref<Array<{ user_id: string; email: string; name: string; role: string }>>([]);
const inviteEmail = ref('');
const message = ref('');
const saving = ref(false);

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
  saving.value = true;
  message.value = '';
  try {
    await api.put(`/organizations/${currentOrgId.value}`, { name: orgName.value });
    message.value = 'Organization updated';
  } catch (e) {
    message.value = e instanceof Error ? e.message : 'Failed to save';
  } finally {
    saving.value = false;
  }
}

async function sendInvite() {
  if (!inviteEmail.value) return;
  message.value = '';
  try {
    await api.post('/invitations', { email: inviteEmail.value });
    message.value = `Invitation sent to ${inviteEmail.value}`;
    inviteEmail.value = '';
  } catch (e) {
    message.value = e instanceof Error ? e.message : 'Failed to send invitation';
  }
}
</script>

<template>
  <div class="max-w-lg space-y-8">
    <h2 class="text-2xl font-bold">Organization Settings</h2>

    <div v-if="message" class="rounded-md bg-muted p-3 text-sm">{{ message }}</div>

    <!-- Org details -->
    <form @submit.prevent="saveOrg" class="space-y-4">
      <div>
        <label class="block text-sm font-medium mb-1.5">Organization name</label>
        <input
          v-model="orgName"
          type="text"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <button
        type="submit"
        :disabled="saving"
        class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {{ saving ? 'Saving...' : 'Save' }}
      </button>
    </form>

    <!-- Members -->
    <div>
      <h3 class="mb-3 text-lg font-semibold">Members</h3>
      <div class="space-y-2">
        <div
          v-for="member in members"
          :key="member.user_id"
          class="flex items-center justify-between rounded-md border border-border px-4 py-3"
        >
          <div>
            <p class="text-sm font-medium">{{ member.name }}</p>
            <p class="text-xs text-muted-foreground">{{ member.email }}</p>
          </div>
          <span class="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">{{ member.role }}</span>
        </div>
      </div>
    </div>

    <!-- Invite -->
    <div>
      <h3 class="mb-3 text-lg font-semibold">Invite member</h3>
      <form @submit.prevent="sendInvite" class="flex gap-2">
        <input
          v-model="inviteEmail"
          type="email"
          placeholder="colleague@example.com"
          class="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          :disabled="!inviteEmail"
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Invite
        </button>
      </form>
    </div>
  </div>
</template>
