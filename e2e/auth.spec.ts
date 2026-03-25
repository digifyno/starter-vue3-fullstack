import { test, expect, type Page } from '@playwright/test';
import pg from 'pg';
import jwt from 'jsonwebtoken';

const { Pool } = pg;

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const DATABASE_URL = process.env.DATABASE_URL;

function dbPool(): InstanceType<typeof Pool> {
  if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');
  return new Pool({ connectionString: DATABASE_URL });
}

// ── Dev login ──────────────────────────────────────────────────────────────

test('dev login lands on dashboard', async ({ page, request }) => {
  const res = await request.get('/api/auth/dev-login');
  expect(res.ok()).toBeTruthy();
  const { token } = await res.json();

  await page.goto('/');
  await page.evaluate((t: string) => localStorage.setItem('token', t), token);
  await page.goto('/');

  // Auth-guarded route '/' should load dashboard, not redirect to /login
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator('body')).toBeVisible();
});

// ── Register flow ──────────────────────────────────────────────────────────

test('register shows PIN step after submitting name and email', async ({ page }) => {
  const ts = Date.now();

  await page.goto('/register');
  await page.fill('#name', `Test User ${ts}`);
  await page.fill('#reg-email', `testuser${ts}@example.com`);
  await page.click('button[type="submit"]');

  // After submit the form transitions to the PIN verification step
  await expect(page.locator('#reg-pin')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('text=Verification code')).toBeVisible();
});

// ── Invite accept flow ─────────────────────────────────────────────────────

test('invited user can accept invitation and join org', async ({ page, request }) => {
  test.skip(!DATABASE_URL, 'DATABASE_URL not configured — skipping invite flow test');

  const ts = Date.now();
  const userBEmail = `userb${ts}@example.com`;

  // Step 1: Dev login as user A
  const resA = await request.get('/api/auth/dev-login');
  expect(resA.ok()).toBeTruthy();
  const { token: tokenA } = await resA.json();

  // Step 2: Create a fresh org as user A
  const orgRes = await request.post('/api/organizations', {
    headers: { Authorization: `Bearer ${tokenA}` },
    data: { name: `Test Org ${ts}`, slug: `testorg${ts}` },
  });
  expect(orgRes.ok()).toBeTruthy();
  const org = await orgRes.json() as { id: string };

  // Step 3: Invite user B to the org
  const inviteRes = await request.post('/api/invitations', {
    headers: {
      Authorization: `Bearer ${tokenA}`,
      'X-Organization-Id': org.id,
    },
    data: { email: userBEmail, role: 'member' },
  });
  expect(inviteRes.ok()).toBeTruthy();

  // Step 4: Fetch the invitation token from the database
  const pool = dbPool();
  let inviteToken: string;
  try {
    const result = await pool.query<{ token: string }>(
      'SELECT token FROM invitations WHERE email = $1 ORDER BY created_at DESC LIMIT 1',
      [userBEmail],
    );
    inviteToken = result.rows[0]?.token;
    expect(inviteToken).toBeTruthy();
  } finally {
    await pool.end();
  }

  // Step 5: Verify GET /api/invitations/:token returns correct details
  const inviteDetails = await request.get(`/api/invitations/${inviteToken}`);
  expect(inviteDetails.ok()).toBeTruthy();
  const details = await inviteDetails.json() as { email: string; role: string };
  expect(details.email).toBe(userBEmail);
  expect(details.role).toBe('member');

  // Step 6: Register user B (creates user in DB; email hub logs in dev mode)
  const registerRes = await request.post('/api/auth/register', {
    data: { email: userBEmail, name: `User B ${ts}` },
  });
  expect(registerRes.status()).toBe(200);

  // Step 7: Mint a JWT for user B via DB lookup (avoids needing a real PIN email)
  const pool2 = dbPool();
  let userBToken: string;
  try {
    const userResult = await pool2.query<{ id: string; email: string }>(
      'SELECT id, email FROM users WHERE email = $1',
      [userBEmail],
    );
    const userB = userResult.rows[0];
    expect(userB).toBeTruthy();
    userBToken = jwt.sign(
      { userId: userB.id, email: userB.email },
      JWT_SECRET,
      { expiresIn: '1h' },
    ) as string;
  } finally {
    await pool2.end();
  }

  // Step 8: Navigate to the invite page as user B and accept
  await page.goto('/');
  await page.evaluate((t: string) => localStorage.setItem('token', t), userBToken);
  await page.goto(`/invite/${inviteToken}`);

  await expect(page.locator("text=You're invited!")).toBeVisible({ timeout: 10_000 });
  await page.click('button:has-text("Accept invitation")');

  // Should redirect to dashboard after accepting
  await expect(page).toHaveURL('/', { timeout: 10_000 });

  // Step 9: Confirm user B is now a member of the org via API
  const orgsRes = await request.get('/api/organizations', {
    headers: { Authorization: `Bearer ${userBToken}` },
  });
  expect(orgsRes.ok()).toBeTruthy();
  const orgs = await orgsRes.json() as Array<{ id: string }>;
  const joined = orgs.find((o) => o.id === org.id);
  expect(joined).toBeTruthy();
});

// ── Passkey flows (WebAuthn) ─────────────────────────────────────────────────

/**
 * Set up a CDP WebAuthn virtual authenticator on the given page.
 * Returns a cleanup function that detaches the CDP session.
 *
 * Requires Chromium — virtual authenticators rely on the Chrome DevTools Protocol.
 */
async function setupVirtualAuthenticator(page: Page): Promise<() => Promise<void>> {
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  return () => client.detach();
}

/**
 * Invoke navigator.credentials.create() in the browser using the given options
 * (binary fields are base64url strings as returned by @simplewebauthn/server).
 * Returns the registration credential serialised to base64url JSON.
 */
async function performRegistrationCeremony(
  page: Page,
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return page.evaluate(async (opts) => {
    function b64urlToBuffer(b64url: string): ArrayBuffer {
      const base64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    }
    function bufferToB64url(buf: ArrayBuffer | Uint8Array): string {
      const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      let binary = '';
      for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o = opts as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cred: any = await (navigator as any).credentials.create({
      publicKey: {
        ...o,
        challenge: b64urlToBuffer(o.challenge),
        user: { ...o.user, id: b64urlToBuffer(o.user.id) },
        excludeCredentials: (o.excludeCredentials ?? []).map((c: any) => ({
          ...c,
          id: b64urlToBuffer(c.id),
        })),
      },
    });

    const resp = cred.response;
    return {
      id: cred.id,
      rawId: bufferToB64url(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: bufferToB64url(resp.clientDataJSON),
        attestationObject: bufferToB64url(resp.attestationObject),
        transports: resp.getTransports?.() ?? [],
      },
      clientExtensionResults: {},
      authenticatorAttachment: cred.authenticatorAttachment ?? 'platform',
    };
  }, options);
}

/**
 * Invoke navigator.credentials.get() in the browser using the given options
 * (binary fields are base64url strings as returned by @simplewebauthn/server).
 * Returns the authentication assertion serialised to base64url JSON.
 */
async function performAuthenticationCeremony(
  page: Page,
  options: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return page.evaluate(async (opts) => {
    function b64urlToBuffer(b64url: string): ArrayBuffer {
      const base64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
      const binary = atob(padded);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    }
    function bufferToB64url(buf: ArrayBuffer | Uint8Array): string {
      const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      let binary = '';
      for (const b of bytes) binary += String.fromCharCode(b);
      return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o = opts as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cred: any = await (navigator as any).credentials.get({
      publicKey: {
        ...o,
        challenge: b64urlToBuffer(o.challenge),
        allowCredentials: (o.allowCredentials ?? []).map((c: any) => ({
          ...c,
          id: b64urlToBuffer(c.id),
        })),
      },
    });

    const resp = cred.response;
    return {
      id: cred.id,
      rawId: bufferToB64url(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: bufferToB64url(resp.clientDataJSON),
        authenticatorData: bufferToB64url(resp.authenticatorData),
        signature: bufferToB64url(resp.signature),
        userHandle: resp.userHandle != null ? bufferToB64url(resp.userHandle) : null,
      },
      clientExtensionResults: {},
      authenticatorAttachment: cred.authenticatorAttachment ?? 'platform',
    };
  }, options);
}

test('passkey registration: register, list, and delete a passkey device', async ({ page }) => {
  test.skip(!DATABASE_URL, 'DATABASE_URL not configured — skipping passkey registration test');

  // Authenticate via dev-login (sets httpOnly JWT cookie in the page's browser context)
  const loginRes = await page.request.get('/api/auth/dev-login');
  expect(loginRes.ok()).toBeTruthy();

  // Navigate to the frontend so WebAuthn uses the correct origin (http://localhost:5173)
  await page.goto('/');

  const teardown = await setupVirtualAuthenticator(page);

  try {
    // Clean up any passkeys left over from previous test runs
    const existing = await page.request.get('/api/auth/passkeys');
    for (const pk of await existing.json() as Array<{ id: string }>) {
      await page.request.delete(`/api/auth/passkeys/${pk.id}`);
    }

    // Begin registration — server generates a challenge and registration options
    const beginRes = await page.request.post('/api/auth/passkey/register/begin');
    expect(beginRes.ok()).toBeTruthy();
    const regOptions = await beginRes.json() as Record<string, unknown>;
    expect(typeof regOptions['challenge']).toBe('string');

    // Perform the WebAuthn ceremony in the browser using the CDP virtual authenticator
    const credential = await performRegistrationCeremony(page, regOptions);
    expect(credential['id']).toBeTruthy();

    // Complete registration — server verifies the credential and stores it
    const completeRes = await page.request.post('/api/auth/passkey/register/complete', {
      data: { response: credential, deviceName: 'Test Key' },
    });
    expect(completeRes.ok()).toBeTruthy();
    const { success, credentialId } = await completeRes.json() as { success: boolean; credentialId: string };
    expect(success).toBe(true);
    expect(credentialId).toBeTruthy();

    // List passkeys — should contain the newly registered device
    const listRes = await page.request.get('/api/auth/passkeys');
    expect(listRes.ok()).toBeTruthy();
    const passkeys = await listRes.json() as Array<{ id: string; deviceName: string | null; createdAt: string }>;
    expect(passkeys).toHaveLength(1);
    expect(passkeys[0]?.deviceName).toBe('Test Key');
    expect(passkeys[0]?.createdAt).toBeTruthy();

    // Delete the passkey
    const deleteRes = await page.request.delete(`/api/auth/passkeys/${passkeys[0]?.id}`);
    expect(deleteRes.ok()).toBeTruthy();
    const { success: deleted } = await deleteRes.json() as { success: boolean };
    expect(deleted).toBe(true);

    // Verify the passkey no longer appears in the list
    const listAfterDelete = await page.request.get('/api/auth/passkeys');
    expect(listAfterDelete.ok()).toBeTruthy();
    expect(await listAfterDelete.json() as Array<unknown>).toHaveLength(0);
  } finally {
    await teardown();
  }
});

test('passkey login: authenticate via passkey after registering one', async ({ page }) => {
  test.skip(!DATABASE_URL, 'DATABASE_URL not configured — skipping passkey login test');

  // Authenticate via dev-login (sets httpOnly JWT cookie in the page's browser context)
  const loginRes = await page.request.get('/api/auth/dev-login');
  expect(loginRes.ok()).toBeTruthy();
  const { user: devUser } = await loginRes.json() as { user: { id: string; email: string } };

  // Navigate to the frontend so WebAuthn uses the correct origin (http://localhost:5173)
  await page.goto('/');

  const teardown = await setupVirtualAuthenticator(page);

  try {
    // Clean up any passkeys left over from previous test runs
    const existing = await page.request.get('/api/auth/passkeys');
    for (const pk of await existing.json() as Array<{ id: string }>) {
      await page.request.delete(`/api/auth/passkeys/${pk.id}`);
    }

    // Register a passkey for the dev user
    const beginRegRes = await page.request.post('/api/auth/passkey/register/begin');
    expect(beginRegRes.ok()).toBeTruthy();
    const regCred = await performRegistrationCeremony(page, await beginRegRes.json() as Record<string, unknown>);
    const completeRegRes = await page.request.post('/api/auth/passkey/register/complete', {
      data: { response: regCred },
    });
    expect(completeRegRes.ok()).toBeTruthy();

    // Logout so we can test passkey login from an unauthenticated state
    await page.request.post('/api/auth/logout');

    // Begin passkey authentication — server generates a challenge
    const beginLoginRes = await page.request.post('/api/auth/passkey/login/begin', {
      data: { email: devUser.email },
    });
    expect(beginLoginRes.ok()).toBeTruthy();
    const loginOptions = await beginLoginRes.json() as Record<string, unknown>;
    expect(typeof loginOptions['challenge']).toBe('string');

    // Perform the WebAuthn authentication ceremony in the browser
    const assertion = await performAuthenticationCeremony(page, loginOptions);
    expect(assertion['id']).toBeTruthy();

    // Complete passkey login — server verifies the assertion and sets a JWT cookie
    const completeLoginRes = await page.request.post('/api/auth/passkey/login/complete', {
      data: { email: devUser.email, response: assertion },
    });
    expect(completeLoginRes.ok()).toBeTruthy();
    const loginBody = await completeLoginRes.json() as { user: { id: string; email: string } };
    expect(loginBody.user).toBeDefined();
    expect(loginBody.user.email).toBe(devUser.email);

    // Verify the JWT cookie was set by making an authenticated request
    const meRes = await page.request.get('/api/users/me');
    expect(meRes.ok()).toBeTruthy();
    const me = await meRes.json() as { id: string; email: string };
    expect(me.email).toBe(devUser.email);

    // Clean up: delete the registered passkey
    const finalPasskeys = await page.request.get('/api/auth/passkeys');
    for (const pk of await finalPasskeys.json() as Array<{ id: string }>) {
      await page.request.delete(`/api/auth/passkeys/${pk.id}`);
    }
  } finally {
    await teardown();
  }
});

// ── Passkey error paths ────────────────────────────────────────────────────

test('passkey login/begin: unknown email returns 404 (anti-enumeration)', async ({ request }) => {
  const res = await request.post('/api/auth/passkey/login/begin', {
    data: { email: `nosuchuser${Date.now()}@example.com` },
  });
  expect(res.status()).toBe(404);
  const body = await res.json() as { error: string };
  expect(body.error).toMatch(/no passkey/i);
});

test('passkey login/begin: email with no registered passkeys returns same 404 as unknown email', async ({ page, request }) => {
  test.skip(!DATABASE_URL, 'DATABASE_URL not configured — skipping passkey anti-enumeration test');

  // Ensure dev user exists and has no passkeys registered
  const loginRes = await page.request.get('/api/auth/dev-login');
  expect(loginRes.ok()).toBeTruthy();
  const { user: devUser } = await loginRes.json() as { user: { email: string } };

  const existing = await page.request.get('/api/auth/passkeys');
  for (const pk of await existing.json() as Array<{ id: string }>) {
    await page.request.delete(`/api/auth/passkeys/${pk.id}`);
  }

  // Should return same 404 as an unknown email (prevents user enumeration)
  const res = await request.post('/api/auth/passkey/login/begin', {
    data: { email: devUser.email },
  });
  expect(res.status()).toBe(404);
  const body = await res.json() as { error: string };
  expect(body.error).toMatch(/no passkey/i);
});

test('passkey login/complete: missing challenge returns 400', async ({ request }) => {
  // Calling login/complete without a preceding login/begin means no server-side challenge exists
  const res = await request.post('/api/auth/passkey/login/complete', {
    data: {
      email: `test${Date.now()}@example.com`,
      response: {
        id: 'fakeid',
        rawId: 'fakeid',
        type: 'public-key',
        response: {
          clientDataJSON: 'aW52YWxpZA',
          authenticatorData: 'aW52YWxpZA',
          signature: 'aW52YWxpZA',
          userHandle: null,
        },
        clientExtensionResults: {},
        authenticatorAttachment: 'platform',
      },
    },
  });
  expect(res.status()).toBe(400);
  const body = await res.json() as { error: string };
  expect(body.error).toMatch(/challenge/i);
});

test('passkey login/complete: invalid credential returns 401', async ({ page, request }) => {
  test.skip(!DATABASE_URL, 'DATABASE_URL not configured — skipping passkey invalid-credential test');

  // Ensure dev user has a passkey registered so login/begin succeeds and creates a challenge
  const loginRes = await page.request.get('/api/auth/dev-login');
  expect(loginRes.ok()).toBeTruthy();
  const { user: devUser } = await loginRes.json() as { user: { email: string } };

  await page.goto('/');
  const teardown = await setupVirtualAuthenticator(page);

  try {
    // Clean up and register a fresh passkey so login/begin has credentials to offer
    const existing = await page.request.get('/api/auth/passkeys');
    for (const pk of await existing.json() as Array<{ id: string }>) {
      await page.request.delete(`/api/auth/passkeys/${pk.id}`);
    }
    const beginRegRes = await page.request.post('/api/auth/passkey/register/begin');
    expect(beginRegRes.ok()).toBeTruthy();
    const regCred = await performRegistrationCeremony(page, await beginRegRes.json() as Record<string, unknown>);
    await page.request.post('/api/auth/passkey/register/complete', { data: { response: regCred } });

    await page.request.post('/api/auth/logout');

    // Begin login to establish a valid server-side challenge for the dev user's email
    const beginLoginRes = await request.post('/api/auth/passkey/login/begin', {
      data: { email: devUser.email },
    });
    expect(beginLoginRes.ok()).toBeTruthy();

    // Submit a tampered credential response — the credential ID does not exist for this user
    const completeLoginRes = await request.post('/api/auth/passkey/login/complete', {
      data: {
        email: devUser.email,
        response: {
          id: 'nonexistent-credential-id',
          rawId: 'nonexistent-credential-id',
          type: 'public-key',
          response: {
            clientDataJSON: 'aW52YWxpZA',
            authenticatorData: 'aW52YWxpZA',
            signature: 'aW52YWxpZA',
            userHandle: null,
          },
          clientExtensionResults: {},
          authenticatorAttachment: 'platform',
        },
      },
    });
    expect(completeLoginRes.status()).toBe(401);
    const body = await completeLoginRes.json() as { error: string };
    expect(body.error).toBeTruthy();

    // Clean up: re-authenticate and delete the registered passkey
    await page.request.get('/api/auth/dev-login');
    const finalPasskeys = await page.request.get('/api/auth/passkeys');
    for (const pk of await finalPasskeys.json() as Array<{ id: string }>) {
      await page.request.delete(`/api/auth/passkeys/${pk.id}`);
    }
  } finally {
    await teardown();
  }
});
