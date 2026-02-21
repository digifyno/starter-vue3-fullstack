import { ref, computed } from 'vue';
import { api } from '../api/index.js';
import { router } from '../router/index.js';

interface UserInfo {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  email_verified: boolean;
}

interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  role: string;
}

const user = ref<UserInfo | null>(null);
const organizations = ref<OrgInfo[]>([]);
const isLoggedIn = computed(() => !!localStorage.getItem('token'));

export function useAuth() {
  async function login(email: string): Promise<void> {
    await api.post('/auth/login', { email });
  }

  async function register(email: string, name: string): Promise<void> {
    await api.post('/auth/register', { email, name });
  }

  async function verifyPin(email: string, pin: string, purpose = 'login'): Promise<void> {
    const res = await api.post<{ token: string; user: UserInfo; organizations: OrgInfo[] }>(
      '/auth/verify-pin',
      { email, pin, purpose },
    );
    localStorage.setItem('token', res.token);
    user.value = res.user;
    organizations.value = res.organizations;

    // Auto-select first org
    if (res.organizations.length > 0) {
      localStorage.setItem('orgId', res.organizations[0].id);
    }
  }

  async function fetchUser(): Promise<void> {
    if (!localStorage.getItem('token')) return;
    try {
      user.value = await api.get<UserInfo>('/users/me');
      organizations.value = await api.get<OrgInfo[]>('/organizations');
      // Ensure orgId is set
      if (!localStorage.getItem('orgId') && organizations.value.length > 0) {
        localStorage.setItem('orgId', organizations.value[0].id);
      }
    } catch {
      logout();
    }
  }

  function logout(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('orgId');
    user.value = null;
    organizations.value = [];
    router.push('/login');
  }

  function switchOrg(orgId: string): void {
    localStorage.setItem('orgId', orgId);
    window.location.reload();
  }

  return {
    user,
    organizations,
    isLoggedIn,
    login,
    register,
    verifyPin,
    fetchUser,
    logout,
    switchOrg,
  };
}
