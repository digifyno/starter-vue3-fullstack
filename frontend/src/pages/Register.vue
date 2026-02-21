<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '../composables/useAuth.js';

const router = useRouter();
const { register, verifyPin } = useAuth();

const email = ref('');
const name = ref('');
const pin = ref('');
const step = ref<'info' | 'pin'>('info');
const error = ref('');
const loading = ref(false);

async function handleRegister() {
  error.value = '';
  loading.value = true;
  try {
    await register(email.value, name.value);
    step.value = 'pin';
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Registration failed';
  } finally {
    loading.value = false;
  }
}

async function handleVerifyPin() {
  error.value = '';
  loading.value = true;
  try {
    await verifyPin(email.value, pin.value, 'verification');
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
        <h1 class="text-2xl font-bold">Create account</h1>
        <p class="mt-2 text-sm text-muted-foreground">
          {{ step === 'info' ? 'Enter your details to get started' : 'Enter the code sent to your email' }}
        </p>
      </div>

      <div v-if="error" class="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
        {{ error }}
      </div>

      <!-- Step 1: Info -->
      <form v-if="step === 'info'" @submit.prevent="handleRegister" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1.5" for="name">Name</label>
          <input
            id="name"
            v-model="name"
            type="text"
            required
            autofocus
            placeholder="Your name"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1.5" for="reg-email">Email</label>
          <input
            id="reg-email"
            v-model="email"
            type="email"
            required
            placeholder="you@example.com"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          type="submit"
          :disabled="loading"
          class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {{ loading ? 'Creating...' : 'Create account' }}
        </button>
      </form>

      <!-- Step 2: PIN -->
      <form v-else @submit.prevent="handleVerifyPin" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1.5" for="reg-pin">Verification code</label>
          <input
            id="reg-pin"
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
          {{ loading ? 'Verifying...' : 'Verify email' }}
        </button>
      </form>

      <p class="text-center text-sm text-muted-foreground">
        Already have an account?
        <router-link to="/login" class="font-medium text-primary hover:underline">Sign in</router-link>
      </p>
    </div>
  </div>
</template>
