# CLAUDE.md — Vue 3 Fullstack SaaS Starter

## Project Overview

Full-stack SaaS application with:
- **Frontend**: Vue 3 + Tailwind CSS + TypeScript (Vite)
- **Backend**: Fastify + TypeScript + PostgreSQL
- **Auth**: Passwordless email+PIN via RSI Email Hub, plus WebAuthn/Passkeys
- **Multi-tenant**: Organizations, memberships, invitations
- **AI Chat**: Via RSI AI Hub (Claude)

## Directory Structure

```
/
├── database/
│   └── migrations/         # SQL migrations (run in order)
│       └── 001_initial_schema.sql
├── backend/
│   ├── src/
│   │   ├── index.ts        # Fastify server entry point
│   │   ├── config.ts       # Typed env config
│   │   ├── constants.ts    # Security constants (AUTH, RATE_LIMITS, SETTINGS)
│   │   ├── database.ts     # PG pool + query helpers
│   │   ├── database.test.ts # Tests for database helpers
│   │   ├── logger.ts       # Pino logger instance
│   │   ├── migrate.ts      # Migration runner
│   │   ├── types.ts        # Shared TypeScript types
│   │   ├── routes/         # API route handlers
│   │   │   ├── auth.ts     # /api/auth/* (login, register, verify-pin, dev-login, passkeys)
│   │   │   ├── auth.test.ts        # Vitest tests for auth routes
│   │   │   ├── auth-passkeys.test.ts # Vitest tests for WebAuthn/Passkeys flows
│   │   │   ├── users.ts    # /api/users/me
│   │   │   ├── users.test.ts       # Vitest tests for users routes
│   │   │   ├── organizations.ts    # /api/organizations/*
│   │   │   ├── organizations.test.ts  # Vitest tests for organizations routes
│   │   │   ├── invitations.ts      # /api/invitations/*
│   │   │   ├── invitations.test.ts    # Vitest tests for invitations routes
│   │   │   ├── health.ts   # /api/health
│   │   │   ├── health.test.ts      # Vitest tests for health route
│   │   │   ├── ai.ts       # /api/ai/chat, /api/hub/status
│   │   │   └── ai.test.ts  # Vitest tests for AI routes
│   │   ├── middleware/
│   │   │   ├── auth.ts     # JWT validation (requireAuth, optionalAuth, signToken)
│   │   │   └── org-context.ts  # resolveOrg (checks X-Organization-Id header)
│   │   └── services/
│   │       ├── hub-client.ts       # Base Hub API client
│   │       ├── email.ts            # sendPin, sendInvitation, sendWelcome (HTML-escaped)
│   │       ├── email.test.ts       # Vitest tests for email service
│   │       ├── ai.ts               # chat, complete, json
│   │       ├── pin.ts              # PIN generation, hashing, verification
│   │       ├── pin.test.ts         # Vitest tests for PIN service
│   │       ├── invitation-service.ts  # Invitation business logic
│   │       ├── organization-service.ts # Organization business logic
│   │       └── user-service.ts     # User business logic
│   └── package.json
└── frontend/
    ├── src/
    │   ├── main.ts         # App entry point
    │   ├── App.vue         # Root component with layout
    │   ├── style.css       # Tailwind + CSS variables (light/dark)
    │   ├── test-setup.ts   # Vitest global setup (localStorage mock, beforeEach reset)
    │   ├── api/index.ts    # Typed fetch client (auto-injects JWT)
    │   ├── composables/
    │   │   ├── useAuth.ts        # Login, register, verifyPin, logout
    │   │   ├── useDarkMode.ts    # Dark mode toggle + persistence
    │   │   └── useOrganization.ts # Current org, org switcher
    │   ├── components/layout/
    │   │   ├── AppLayout.vue   # Sidebar + Header + main content
    │   │   ├── Sidebar.vue     # Navigation links
    │   │   ├── Header.vue      # Dark mode toggle + user menu
    │   │   └── OrgSwitcher.vue # Organization dropdown
    │   ├── pages/
    │   │   ├── Login.vue        # Email → PIN → dashboard
    │   │   ├── Login.test.ts    # Vitest component tests for Login page (8 tests)
    │   │   ├── Register.vue     # Name + email → verify → dashboard
    │   │   ├── Register.test.ts # Vitest component tests for Register page (7 tests)
    │   │   ├── Dashboard.vue    # Hub status + AI chat widget
    │   │   ├── Dashboard.test.ts # Vitest component tests for Dashboard page (5 tests)
    │   │   ├── AiChat.vue       # Full-page AI chat
    │   │   ├── UserSettings.vue # Name, email, dark mode toggle
    │   │   ├── OrgSettings.vue  # Org name, members, invite
    │   │   └── InviteAccept.vue # Accept invitation
    │   ├── stores/
    │   │   ├── auth.ts    # Pinia auth store
    │   │   └── org.ts     # Pinia org store
    │   └── app/router.ts  # Vue Router with auth guards and document.title updates per route
    └── package.json
```

## Quick Start

```bash
# Install all dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env: set DATABASE_URL, JWT_SECRET

# Run database migrations
npm run migrate -w backend

# Start dev servers (backend on :4001, frontend on :5173)
npm run dev
```

## Build

```bash
# Build both backend and frontend
npm run build

# Or individually:
npm run build -w backend    # → backend/dist/
npm run build -w frontend   # → frontend/dist/
```

## Testing

```bash
# Run all backend tests (Vitest)
npm test -w backend

# Run all frontend component tests (Vitest + Vue Test Utils)
npm test -w frontend

# Run frontend tests in watch mode
npm run test:watch -w frontend

# Run frontend tests with coverage
npm run test:coverage -w frontend
```

Frontend tests use jsdom environment with Vue Test Utils. Test files live alongside pages in `frontend/src/pages/*.test.ts`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for signing JWTs (use random string) |
| `RSI_HUB_URL` | Auto | RSI Hub base URL (injected by RSI for workers) |
| `RSI_HUB_TOKEN` | Auto | Worker Hub Token (injected by RSI for workers) |
| `PORT` | No | Backend port (default: 4001) |
| `HOST` | No | Backend host (default: 127.0.0.1) |
| `NODE_ENV` | No | Environment (development/production) |
| `APP_URL` | No | Public URL of the app (default: `http://localhost:5173`). Used for invitation links. Set in production to prevent host header injection |
| `DISABLE_DEV_LOGIN` | No | Set to `true` to disable `/api/auth/dev-login` |

## API Reference

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | - | Register: `{email, name}` → sends PIN |
| POST | `/api/auth/login` | - | Login: `{email}` → sends PIN |
| POST | `/api/auth/verify-pin` | - | Verify: `{email, pin, purpose?}` → JWT |
| POST | `/api/auth/refresh` | Bearer | Refresh JWT |
| GET | `/api/auth/dev-login` | localhost | Auto-login for testing |

### Passkeys (WebAuthn)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/passkey/register/begin` | Bearer | Begin passkey registration → registration options |
| POST | `/api/auth/passkey/register/complete` | Bearer | Complete passkey registration: `{response, deviceName?}` |
| POST | `/api/auth/passkey/login/begin` | - | Begin passkey login: `{email}` → authentication options |
| POST | `/api/auth/passkey/login/complete` | - | Complete passkey login: `{email, response}` → JWT |

### Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users/me` | Bearer | Get current user |
| PUT | `/api/users/me` | Bearer | Update `{name?, avatar_url?}` |
| PUT | `/api/users/me/settings` | Bearer | Update settings JSONB |

### Organizations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/organizations` | Bearer | List user's orgs |
| POST | `/api/organizations` | Bearer | Create `{name, slug}` |
| GET | `/api/organizations/:id` | Bearer + X-Org | Get org |
| PUT | `/api/organizations/:id` | Bearer + X-Org | Update `{name?, logo_url?, settings?}` |
| GET | `/api/organizations/:id/members` | Bearer + X-Org | List members |

### Invitations

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/invitations` | Bearer + X-Org | Send invite `{email, role?}` (role: admin|member|viewer, default: member) |
| GET | `/api/invitations/:token` | - | Get invite details |
| POST | `/api/invitations/:token/accept` | Bearer | Accept invitation |

### Hub & AI

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/hub/status` | - | Hub connectivity status |
| POST | `/api/ai/chat` | Bearer | Chat: `{message, history?}` |
| GET | `/api/health` | - | Health check |

## Database

### Schema

**organizations** — Multi-tenant organizations
**users** — Users (no password, passwordless auth)
**org_memberships** — User↔Org many-to-many (roles: owner/admin/member/viewer)
**auth_pins** — Short-lived PINs for login/verification (bcrypt hashed)
**invitations** — Organization invitations (7-day expiry)

### Adding a Migration

1. Create `database/migrations/NNN_description.sql`
2. Run `npm run migrate -w backend`

Migrations track applied files in `_migrations` table and skip already-applied ones.

### Database Query Helpers

```typescript
import { query, queryOne, withTransaction } from './database.js';

// Execute query, get all rows
const result = await query<MyType>('SELECT * FROM users WHERE org_id = $1', [orgId]);
result.rows; // MyType[]

// Get single row or null
const user = await queryOne<User>('SELECT * FROM users WHERE id = $1', [id]);

// Run multiple operations in a transaction (auto-commits or rolls back)
const result = await withTransaction(async (client) => {
  await client.query('INSERT INTO users ...', [...]);
  await client.query('INSERT INTO org_memberships ...', [...]);
  return someValue;
});
```

## Auth System

### Passwordless Flow

1. **Login**: POST `/api/auth/login` with email → 6-digit PIN sent via Email Hub
2. **Verify**: POST `/api/auth/verify-pin` with email+PIN → JWT (7-day)
3. **Frontend**: Store JWT in `localStorage('token')`, send as `Authorization: Bearer <token>`

### Passkeys / WebAuthn

Users can register hardware keys, biometrics, or platform authenticators as an alternative to PIN login. Implemented via `@simplewebauthn/server`.

**Registration** (requires existing JWT session):
1. POST `/api/auth/passkey/register/begin` → WebAuthn registration options
2. Browser performs ceremony, POST `/api/auth/passkey/register/complete` with `{response, deviceName?}` → credential stored

**Login** (unauthenticated):
1. POST `/api/auth/passkey/login/begin` with `{email}` → WebAuthn authentication options
2. Browser performs ceremony, POST `/api/auth/passkey/login/complete` with `{email, response}` → JWT

Challenges are stored server-side in memory maps (`registrationChallenges` keyed by userId, `authenticationChallenges` keyed by email). Each entry carries a TTL expiry (`AUTH.CHALLENGE_TTL_MS`, 5 minutes); stale entries are pruned on insert.

### Security Constants

All security-governing constants are centralized in `backend/src/constants.ts`:

```typescript
import { AUTH, RATE_LIMITS, SETTINGS } from './constants.js';

// AUTH constants
AUTH.PIN_LENGTH        // 6
AUTH.PIN_TTL_MS        // 5 * 60 * 1000  (5 minutes)
AUTH.PIN_MAX_ATTEMPTS  // 5
AUTH.BCRYPT_ROUNDS     // 10
AUTH.INVITATION_TTL_MS // 7 * 24 * 60 * 60 * 1000  (7 days)
AUTH.JWT_EXPIRY        // '7d'
AUTH.CHALLENGE_TTL_MS  // 5 * 60 * 1000  (5 minutes, WebAuthn challenge expiry)

// Rate limit configs (used with Fastify rate-limit plugin)
RATE_LIMITS.REGISTER    // { max: 5,  timeWindow: '1 minute' }
RATE_LIMITS.LOGIN       // { max: 5,  timeWindow: '1 minute' }
RATE_LIMITS.VERIFY_PIN  // { max: 10, timeWindow: '1 minute' }
RATE_LIMITS.REFRESH     // { max: 10, timeWindow: '1 minute' }
RATE_LIMITS.INVITATIONS // { max: 20, timeWindow: '1 hour' }

// Other limits
SETTINGS.MAX_SIZE_BYTES // 10_000 (user and org settings JSONB size limit)
```

### PIN Security

- 6-digit random PIN (cryptographically secure; length governed by `AUTH.PIN_LENGTH`)
- bcrypt hashed before storage (`AUTH.BCRYPT_ROUNDS` rounds)
- 5-minute expiry (`AUTH.PIN_TTL_MS`)
- Max 5 attempts per PIN (`AUTH.PIN_MAX_ATTEMPTS`)
- Old PINs invalidated on new request
- Verify-pin rate limit is keyed per IP+email to prevent cross-account brute-force
- Login returns 200 for unknown emails (prevents user enumeration)
- Email format validated on register/login/verify-pin; name validated on register; PIN format (`^[0-9]{6}$`) validated on verify-pin
- Refresh endpoint uses `preHandler: [requireAuth]` middleware and is rate-limited per IP
- Invitation `role` validated against allowed values (admin, member, viewer); defaults to member

### JWT

- 7-day expiry (`AUTH.JWT_EXPIRY`)
- Signed with `JWT_SECRET`
- Payload: `{ userId, email }`
- Frontend auto-injects via `api/index.ts`

### Organization Auth

Routes requiring org context need `X-Organization-Id` header:

```typescript
import { requireAuth } from '../middleware/auth.js';
import { resolveOrg } from '../middleware/org-context.js';

app.get('/api/orgs/:id/data', { preHandler: [requireAuth, resolveOrg] }, async (request) => {
  request.organizationId; // Set by resolveOrg
  request.orgRole;        // owner/admin/member/viewer
});
```

### Dev Login (Testing)

For localhost testing (Playwright workers, E2E tests):

```javascript
// Playwright
const res = await page.request.get('/api/auth/dev-login');
const { token } = await res.json();
await page.evaluate(t => localStorage.setItem('token', t), token);
await page.goto('/');  // Now authenticated as Dev User
```

**Security**: IP-restricted to 127.0.0.1/::1 only. Disable in production with `DISABLE_DEV_LOGIN=true`.

## Frontend Patterns

### Adding an API Call

```typescript
import { api } from '../api/index.js';

// GET
const data = await api.get<MyType>('/endpoint');

// POST
const result = await api.post<ResponseType>('/endpoint', { key: 'value' });

// PUT
await api.put('/endpoint', { updates });
```

### Adding a New Page

1. Create `frontend/src/pages/MyPage.vue`
2. Add route in `frontend/src/app/router.ts`:
   ```typescript
   { path: '/my-page', component: () => import('../pages/MyPage.vue'), meta: { auth: true } }
   ```
3. Add nav link in `frontend/src/components/layout/Sidebar.vue`

### Adding a Database Table

1. Create migration: `database/migrations/002_my_table.sql`
2. Run: `npm run migrate -w backend`
3. Add TypeScript type in `backend/src/types.ts`
4. Add route in `backend/src/routes/my-route.ts`
5. Register route in `backend/src/index.ts`

## Hub Integration

### Email Hub

```typescript
import { sendPin, sendInvitation, sendWelcome } from './services/email.js';

// Send PIN email
await sendPin('user@example.com', '123456');

// Send invitation
await sendInvitation('user@example.com', 'Acme Corp', 'Alice', 'https://app.example.com/invite/token');
```

**Security**: `sendInvitation` HTML-escapes `orgName` and `inviterName` before embedding them in the email body to prevent HTML injection.

### AI Hub

```typescript
import { chat, complete, json } from './services/ai.js';

// Multi-turn chat
const { reply } = await chat([
  { role: 'user', content: 'Hello!' }
]);

// Single completion
const text = await complete('Summarize this: ...');

// Structured JSON output
const data = await json<MySchema>('Extract data from: ...');
```

### Hub Status Check

```typescript
import { hubClient } from './services/hub-client.js';

if (hubClient.isConfigured) {
  // RSI_HUB_TOKEN is set — Hub features available
}
```

**Note**: `RSI_HUB_TOKEN` is automatically injected by RSI for workers. For deployed products, generate a token using `npx tsx scripts/generate-hub-token.ts <product-id>` on the RSI server.

## Dark Mode

Implemented via Tailwind `darkMode: 'class'`:

```typescript
import { useDarkMode } from '../composables/useDarkMode.js';
const { isDark, toggle } = useDarkMode();
```

In templates:
```html
<div class="bg-white dark:bg-gray-900 text-gray-900 dark:text-white">
```

Uses `localStorage('theme')` for persistence, falls back to system preference.

## Deployment

### Build Commands

```bash
# Backend
cd backend && npm install && npm run build  # → backend/dist/index.js

# Frontend
cd frontend && npm install && npm run build  # → frontend/dist/
```

### Production

The backend serves the frontend's `dist/` as static files. Start with:

```bash
node backend/dist/index.js
```

Or via RSI deploy config: `startCommand: 'cd backend && node dist/index.js'`

### Required Environment in Production

```bash
DATABASE_URL=postgresql://user:pass@host:5432/db
JWT_SECRET=<random-secret>
RSI_HUB_TOKEN=<your-hub-token>
PORT=4001
HOST=127.0.0.1
NODE_ENV=production
DISABLE_DEV_LOGIN=true
```

## RSI Self-Service API

Workers can update deployment config via the Product API:

```bash
# Update health probes after changing stack
curl -X PUT -H "Authorization: WorkerHub $RSI_HUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"probes": [...]}' \
  https://rsi.digify.no/api/product-api/health-probes

# Update deploy config
curl -X PUT -H "Authorization: WorkerHub $RSI_HUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"buildCommand": "...", "startCommand": "..."}' \
  https://rsi.digify.no/api/product-api/deploy-config
```

See full API docs: https://rsi.digify.no/api/product-api/docs
