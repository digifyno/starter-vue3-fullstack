<script setup lang="ts">
import { ref } from 'vue';
import { useOrganization } from '@/entities/org/model/use-organization.js';

const { currentOrg, organizations, switchOrg } = useOrganization();
const isOpen = ref(false);

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    isOpen.value = false;
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    isOpen.value = !isOpen.value;
  }
}

function handleFocusOut(event: FocusEvent) {
  const relatedTarget = event.relatedTarget as Node | null;
  const currentTarget = event.currentTarget as Node | null;
  if (!currentTarget?.contains(relatedTarget)) {
    isOpen.value = false;
  }
}
</script>

<template>
  <div class="relative" @focusout="handleFocusOut">
    <button
      @click="isOpen = !isOpen"
      @keydown="handleKeydown"
      :aria-expanded="isOpen.toString()"
      aria-haspopup="listbox"
      :aria-label="`Select organization: ${currentOrg?.name || 'None selected'}`"
      class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
    >
      <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      </svg>
      <span class="flex-1 truncate text-left">{{ currentOrg?.name || 'Select org' }}</span>
      <svg class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
      </svg>
    </button>

    <ul
      v-if="isOpen"
      role="listbox"
      :aria-label="`Organizations`"
      class="absolute bottom-full left-0 mb-1 w-full rounded-md border border-border bg-popover p-1 shadow-md"
    >
      <li
        v-for="org in organizations"
        :key="org.id"
        role="option"
        :aria-selected="org.id === currentOrg?.id"
        @click="switchOrg(org.id); isOpen = false"
        @keydown.enter.prevent="switchOrg(org.id); isOpen = false"
        @keydown.space.prevent="switchOrg(org.id); isOpen = false"
        tabindex="0"
        class="flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent focus:bg-accent focus:outline-none"
        :class="org.id === currentOrg?.id ? 'bg-accent' : ''"
      >
        {{ org.name }}
      </li>
    </ul>
  </div>
</template>
