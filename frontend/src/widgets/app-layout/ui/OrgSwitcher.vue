<script setup lang="ts">
import { ref, nextTick, useTemplateRef } from 'vue';
import { useOrganization } from '@/entities/org/model/use-organization.js';

const { currentOrg, organizations, switchOrg } = useOrganization();
const isOpen = ref(false);
const focusedIndex = ref(-1);

const triggerRef = useTemplateRef<HTMLButtonElement>('triggerRef');
const itemRefs = useTemplateRef<HTMLLIElement[]>('itemRefs');

async function openDropdown() {
  isOpen.value = true;
  const selectedIndex = organizations.value.findIndex(
    (org) => org.id === currentOrg.value?.id
  );
  focusedIndex.value = selectedIndex >= 0 ? selectedIndex : 0;
  await nextTick();
  itemRefs.value?.[focusedIndex.value]?.focus();
}

function closeDropdown() {
  isOpen.value = false;
  focusedIndex.value = -1;
  nextTick(() => triggerRef.value?.focus());
}

function selectOrg(orgId: string) {
  switchOrg(orgId);
  closeDropdown();
}

function handleTriggerClick() {
  if (isOpen.value) {
    closeDropdown();
  } else {
    openDropdown();
  }
}

function handleTriggerKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    handleTriggerClick();
  } else if (event.key === 'Escape') {
    if (isOpen.value) {
      closeDropdown();
    }
  }
}

function handleListKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    closeDropdown();
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    const next = (focusedIndex.value + 1) % organizations.value.length;
    focusedIndex.value = next;
    itemRefs.value?.[next]?.focus();
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    const prev =
      (focusedIndex.value - 1 + organizations.value.length) %
      organizations.value.length;
    focusedIndex.value = prev;
    itemRefs.value?.[prev]?.focus();
  } else if (event.key === 'Tab') {
    closeDropdown();
  }
}

function handleFocusOut(event: FocusEvent) {
  const relatedTarget = event.relatedTarget as Node | null;
  const currentTarget = event.currentTarget as Node | null;
  if (!currentTarget?.contains(relatedTarget)) {
    isOpen.value = false;
    focusedIndex.value = -1;
  }
}
</script>

<template>
  <div class="relative" @focusout="handleFocusOut">
    <button
      ref="triggerRef"
      @click="handleTriggerClick"
      @keydown="handleTriggerKeydown"
      :aria-expanded="isOpen"
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
      aria-label="Organizations"
      @keydown="handleListKeydown"
      class="absolute bottom-full left-0 mb-1 w-full rounded-md border border-border bg-popover p-1 shadow-md"
    >
      <li
        v-for="(org, index) in organizations"
        :key="org.id"
        :ref="(el) => setItemRef(el, index)"
        role="option"
        :aria-selected="org.id === currentOrg?.id"
        :tabindex="index === focusedIndex ? 0 : -1"
        @click="selectOrg(org.id)"
        @keydown.enter.prevent="selectOrg(org.id)"
        @keydown.space.prevent="selectOrg(org.id)"
        class="flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent focus:bg-accent focus:outline-none"
        :class="org.id === currentOrg?.id ? 'bg-accent' : ''"
      >
        {{ org.name }}
      </li>
    </ul>
  </div>
</template>
