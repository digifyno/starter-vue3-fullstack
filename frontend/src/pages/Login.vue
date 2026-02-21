<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../composables/useAuth.js';

const router = useRouter();
const { login, verifyPin } = useAuth();

const email = ref('');
const pin = ref('');
const step = ref<'email' | 'pin'>('email');
const error = ref('');
const loading = ref(false);

async function handleSendPin() {
  error.value = '';
  loading.value = true;
  try {
    await login(email.value);
    step.value = 'pin';
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Failed to send PIN';
  } finally {
    loading.value = false;
  }
}

async function handleVerifyPin() {
  error.value = '';
  loading.value = true;
  try {
    await verifyPin(email.value, pin.value);
    router.push('/');
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Invalid PIN';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background p-4">
    <div class="w-full max-w-sm space-y-6">
      <div class="text-center">
        <h1 class="text-2xl font-bold">Sign in</h1>
        <p class="mt-2 text-sm text-muted-foreground">
          {{ step === 'email' ? 'Enter your email to receive a login code' : 'Enter the code sent to your email' }}
        </p>
      </div>

      <div v-if="error" class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
        {{ error }}
      </div>

      <!-- Step 1: Email -->
      <form v-if="step === 'email'" @submit.prevent="handleSendPin" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1.5" for="email">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            autofocus
            placeholder="you@example.com"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {{ loading ? 'Sending...' : 'Send login code' }}
        </button>
      </form>

      <!-- Step 2: PIN -->
      <form v-else @submit.prevent="handleVerifyPin" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1.5" for="pin">Verification code</label>
          <input
            id="pin"
            v-model="pin"
            type="text"
            inputmode="numeric"
            pattern="[0-9]{6}"
            maxlength="6"
            required
            autofocus
            placeholder="000000"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-center text-2xl tracking-[0.5em] ring-offset-background placeholder:text-muted-foreground placeholder:tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {{ loading ? 'Verifying...' : 'Verify' }}
        </button>
        <button
          type="button"
          @click="step = 'email'; pin = ''"
          class="w-full text-sm text-muted-foreground hover:text-foreground"
        >
          Use a different email
        </button>
      </form>

      <p class="text-center text-sm text-muted-foreground">
        Don't have an account?
        <router-link to="/register" class="font-medium text-primary hover:underline">Register</router-link>
      </p>
    </div>
  </div>
</template>
