<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api, ApiError } from '@/shared/api/index.js';
import { useOrganization } from '@/entities/org/model/use-organization.js';

const { currentOrg, currentOrgId } = useOrganization();

const orgName = ref('');
const members = ref<Array<{ user_id: string; email: string; name: string; role: string }>>([]);
const inviteEmail = ref('');

const isUpdatingName = ref(false);
const nameError = ref('');
const nameSuccess = ref('');

const isInviting = ref(false);
const inviteError = ref('');
const inviteSuccess = ref('');

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
  } catch (e) {
    nameError.value = e instanceof Error ? e.message : 'Failed to save';
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
    inviteEmail.value = '';
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      inviteError.value = 'This email is already a member of your organization';
    } else if (e instanceof ApiError && (e.status === 422 || e.status === 400)) {
      inviteError.value = 'Please enter a valid email address';
    } else {
      inviteError.value = e instanceof Error ? e.message : 'Failed to send invitation';
    }
  } finally {
    isInviting.value = false;
  }
}
</script>

<template>
  <div class="max-w-lg space-y-8">
    <h2 class="text-2xl font-bold">Organization Settings</h2>

    <!-- Org details -->
    <form @submit.prevent="saveOrg" class="space-y-4">
      <div>
        <label class="block text-sm font-medium mb-1.5">Organization name</label>
        <input
          v-model="orgName"
          type="text"
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-hidden focus:ring-2 focus:ring-ring"
        />
        <p v-if="nameError" role="alert" class="text-red-600 text-sm mt-1">{{ nameError }}</p>
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
      <form @submit.prevent="sendInvite" class="space-y-2">
        <div class="flex gap-2">
          <input
            v-model="inviteEmail"
            type="email"
            placeholder="colleague@example.com"
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
        <p v-if="inviteError" role="alert" class="text-red-600 text-sm mt-1">{{ inviteError }}</p>
        <p v-if="inviteSuccess" role="status" class="text-green-600 text-sm mt-1">{{ inviteSuccess }}</p>
      </form>
    </div>
  </div>
</template>
