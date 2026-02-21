import { defineStore } from 'pinia';
import { ref } from 'vue';

// Pinia store for auth state — currently useAuth composable handles state.
// This store is provided for products that prefer Pinia-based state management.
export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('token') || '');

  function setToken(t: string) {
    token.value = t;
    localStorage.setItem('token', t);
  }

  function clearToken() {
    token.value = '';
    localStorage.removeItem('token');
  }

  return { token, setToken, clearToken };
});
