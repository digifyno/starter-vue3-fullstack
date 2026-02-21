<script setup lang="ts">
import { ref } from 'vue';
import { useOrganization } from '../../composables/useOrganization.js';

const { currentOrg, organizations, switchOrg } = useOrganization();
const isOpen = ref(false);
</script>

<template>
  <div class="relative">
    <button
      @click="isOpen = !isOpen"
      class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    >
      <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
      <span class="flex-1 truncate text-left">{{ currentOrg?.name || 'Select org' }}</span>
      <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
      </svg>
    </button>

    <div
      v-if="isOpen"
      class="absolute bottom-full left-0 mb-1 w-full rounded-md border border-border bg-popover p-1 shadow-md"
    >
      <button
        v-for="org in organizations"
        :key="org.id"
        @click="switchOrg(org.id); isOpen = false"
        class="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
        :class="org.id === currentOrg?.id ? 'bg-accent' : ''"
      >
        {{ org.name }}
      </button>
    </div>
  </div>
</template>
