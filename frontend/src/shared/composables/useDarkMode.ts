import { ref, watchEffect } from 'vue';

const isDark = ref(false);

function init() {
  const stored = localStorage.getItem('theme');
  if (stored === 'dark') {
    isDark.value = true;
  } else if (stored === 'light') {
    isDark.value = false;
  } else {
    isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
}

init();

watchEffect(() => {
  document.documentElement.classList.toggle('dark', isDark.value);
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light');
});

export function useDarkMode() {
  function toggle() {
    isDark.value = !isDark.value;
  }

  return { isDark, toggle };
}
