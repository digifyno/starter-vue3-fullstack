<script setup lang="ts">
import { ref, computed, nextTick, useTemplateRef } from 'vue';
import { useRouter } from 'vue-router';
import { useAuth } from '@/entities/user/model/use-auth.js';

const router = useRouter();
const { login, verifyPin, loginWithPasskey } = useAuth();

const email = ref('');
const pin = ref('');
const step = ref<'email' | 'pin'>('email');
const error = ref('');
const loading = ref(false);
const passkeyLoading = ref(false);
const pinInputRef = useTemplateRef<HTMLInputElement>('pinInputRef');
const passkeyBroken = ref(false);
const passkeyAnnounce = ref('');

const passkeySupported = computed(
  () => !passkeyBroken.value && typeof window !== 'undefined' && !!window.PublicKeyCredential,
);

async function handleSendPin() {
  error.value = '';
  loading.value = true;
  try {
    await login(email.value);
    step.value = 'pin';
    await nextTick();
    pinInputRef.value?.focus();
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
    await router.push('/');
    await nextTick();
    const heading = document.querySelector<HTMLElement>('#main-content h2, #main-content h1');
    if (heading) { heading.tabIndex = -1; heading.focus(); }
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Invalid PIN';
  } finally {
    loading.value = false;
  }
}

function getPasskeyErrorMessage(e: unknown): string {
  if (e instanceof DOMException) {
    if (e.name === 'NotAllowedError') return 'Authentication was cancelled. Please try again.';
    if (e.name === 'SecurityError') return "This action isn't allowed on this domain";
    if (e.name === 'NotSupportedError') return 'Your browser does not support passkeys. Please use PIN login.';
  }
  return 'Passkey authentication failed. Please try PIN login.';
}

async function handlePasskeyLogin() {
  if (!email.value) {
    error.value = 'Please enter your email first';
    return;
  }
  error.value = '';
  passkeyLoading.value = true;
  try {
    await loginWithPasskey(email.value);
    passkeyAnnounce.value = 'Sign in successful. Redirecting...';
    await router.push('/');
    await nextTick();
    const heading = document.querySelector<HTMLElement>('#main-content h2, #main-content h1');
    if (heading) { heading.tabIndex = -1; heading.focus(); }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotSupportedError') {
      passkeyBroken.value = true;
    }
    error.value = getPasskeyErrorMessage(e);
  } finally {
    passkeyLoading.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center bg-background p-4">
    <div class="w-full max-w-sm space-y-6">
      <div class="text-center">
        <h1 class="text-2xl font-bold">Sign in</h1>
        <p aria-live="polite" class="mt-2 text-sm text-muted-foreground">
          {{ step === 'email' ? 'Enter your email to receive a login code' : 'Enter the code sent to your email' }}
        </p>
      </div>

      <div
        v-if="error"
        id="login-error"
        role="alert"
        aria-live="assertive"
        class="rounded-md bg-destructive/10 p-3 text-sm text-destructive"
      >
        {{ error }}
      </div>

      <!-- Passkey status announcer for screen readers -->
      <div aria-live="polite" aria-atomic="true" class="sr-only">{{ passkeyAnnounce }}</div>

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
            :aria-describedby="error ? 'login-error' : undefined"
            :aria-invalid="error ? 'true' : undefined"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
        </div>

        <!-- Passkey sign-in button (only shown when supported) -->
        <template v-if="passkeySupported">
          <button
            type="button"
            :disabled="passkeyLoading || loading"
            :aria-busy="passkeyLoading"
            @click="handlePasskeyLogin"
            class="w-full flex items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
          >
            <span
              v-if="passkeyLoading"
              class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
            <span v-else>🔑</span>
            {{ passkeyLoading ? 'Signing in...' : 'Sign in with a passkey' }}
          </button>

          <div class="flex items-center gap-3">
            <div class="h-px flex-1 bg-border" />
            <span class="text-xs text-muted-foreground">or</span>
            <div class="h-px flex-1 bg-border" />
          </div>
        </template>

        <button
          type="submit"
          :disabled="loading || passkeyLoading"
          :aria-busy="loading"
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
            ref="pinInputRef"
            v-model="pin"
            type="text"
            inputmode="numeric"
            pattern="[0-9]{6}"
            maxlength="6"
            required
            autofocus
            autocomplete="one-time-code"
            placeholder="000000"
            :aria-describedby="error ? 'login-error' : undefined"
            :aria-invalid="error ? 'true' : undefined"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-center text-2xl tracking-[0.5em] ring-offset-background placeholder:text-muted-foreground placeholder:tracking-[0.5em] focus:outline-hidden focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          type="submit"
          :disabled="loading"
          :aria-busy="loading"
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
