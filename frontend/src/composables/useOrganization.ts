import { computed } from 'vue';
import { useAuth } from './useAuth.js';

export function useOrganization() {
  const { organizations, switchOrg } = useAuth();

  const currentOrgId = computed(() => localStorage.getItem('orgId') || '');
  const currentOrg = computed(() => organizations.value.find((o) => o.id === currentOrgId.value) || null);

  return { currentOrg, currentOrgId, organizations, switchOrg };
}
