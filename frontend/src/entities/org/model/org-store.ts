import { defineStore } from 'pinia';
import { ref } from 'vue';

// Pinia store for organization state — currently useOrganization composable handles state.
// This store is provided for products that prefer Pinia-based state management.
export const useOrgStore = defineStore('org', () => {
  const currentOrgId = ref(localStorage.getItem('orgId') || '');

  function setOrg(orgId: string) {
    currentOrgId.value = orgId;
    localStorage.setItem('orgId', orgId);
  }

  return { currentOrgId, setOrg };
});
