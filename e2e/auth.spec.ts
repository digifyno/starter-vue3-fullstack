import { test, expect } from '@playwright/test';
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
