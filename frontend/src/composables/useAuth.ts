import { ref, computed } from 'vue';
import { api } from '../api/index.js';
import { router } from '../router/index.js';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialRequestOptionsJSON,
  PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/browser';

interface UserInfo {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  email_verified: boolean;
}

export interface OrgInfo {
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
      const firstOrg = res.organizations[0];
      if (firstOrg) localStorage.setItem('orgId', firstOrg.id);
    }
  }

  async function loginWithPasskey(email: string): Promise<void> {
    const options = await api.post<PublicKeyCredentialRequestOptionsJSON>('/auth/passkey/login/begin', { email });
    const response = await startAuthentication({ optionsJSON: options });
    const result = await api.post<{ token: string; user: UserInfo }>('/auth/passkey/login/complete', { email, response });
    localStorage.setItem('token', result.token);
    user.value = result.user;
    // Fetch organizations and set orgId in localStorage
    const orgs = await api.get<OrgInfo[]>('/organizations');
    organizations.value = orgs;
    if (orgs.length > 0) {
      const firstOrg = orgs[0];
      if (firstOrg) localStorage.setItem('orgId', firstOrg.id);
    }
  }

  async function registerPasskey(deviceName?: string): Promise<void> {
    const options = await api.post<PublicKeyCredentialCreationOptionsJSON>('/auth/passkey/register/begin', {});
    const response = await startRegistration({ optionsJSON: options });
    await api.post('/auth/passkey/register/complete', { response, deviceName });
  }

  async function fetchUser(): Promise<void> {
    if (!localStorage.getItem('token')) return;
    try {
      user.value = await api.get<UserInfo>('/users/me');
      organizations.value = await api.get<OrgInfo[]>('/organizations');
      // Ensure orgId is set
      if (!localStorage.getItem('orgId') && organizations.value.length > 0) {
        const firstOrg = organizations.value[0];
        if (firstOrg) localStorage.setItem('orgId', firstOrg.id);
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
    loginWithPasskey,
    registerPasskey,
    fetchUser,
    logout,
    switchOrg,
  };
}
