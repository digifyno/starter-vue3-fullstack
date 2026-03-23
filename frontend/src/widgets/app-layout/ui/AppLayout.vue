<script setup lang="ts">
import Sidebar from './Sidebar.vue';
import Header from './Header.vue';
import { useStatusAnnouncer } from '@/shared/composables/useStatusAnnouncer.js';

const { message, errorMessage } = useStatusAnnouncer();
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
    >
      Skip to main content
    </a>
    <Sidebar />
    <div class="flex flex-1 flex-col overflow-hidden">
      <Header />
      <main id="main-content" class="flex-1 overflow-y-auto p-6">
        <slot />
      </main>
    </div>
    <!-- ARIA live regions for async operation feedback (WCAG 2.1 SC 4.1.3) -->
    <div role="status" aria-live="polite" aria-atomic="true" class="sr-only">{{ message }}</div>
    <div role="alert" aria-live="assertive" aria-atomic="true" class="sr-only">{{ errorMessage }}</div>
  </div>
</template>
