import { defineStore } from 'pinia';

// Pinia store for auth state — auth is now handled via httpOnly cookie (no token in JS).
// This store is retained for products that extend it; token management is no longer needed here.
export const useAuthStore = defineStore('auth', () => {
  return {};
});
