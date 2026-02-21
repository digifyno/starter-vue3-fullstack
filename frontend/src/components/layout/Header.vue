<script setup lang="ts">
import { useDarkMode } from '../../composables/useDarkMode.js';
import { useAuth } from '../../composables/useAuth.js';

const { isDark, toggle } = useDarkMode();
const { user, logout } = useAuth();
</script>

<template>
  <header class="flex h-14 items-center justify-between border-b border-border bg-card px-6">
    <div />
    <div class="flex items-center gap-4">
      <!-- Dark mode toggle -->
      <button
        @click="toggle"
        class="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
      >
        <!-- Sun icon -->
        <svg v-if="isDark" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
        <!-- Moon icon -->
        <svg v-else class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
        </svg>
      </button>

      <!-- User dropdown -->
      <div class="flex items-center gap-2">
        <span class="text-sm text-muted-foreground">{{ user?.name || user?.email }}</span>
        <button
          @click="logout"
          class="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          Sign out
        </button>
      </div>
    </div>
  </header>
</template>
