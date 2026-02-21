# CLAUDE.md — Vue 3 Fullstack SaaS Starter

## Project Overview

Full-stack SaaS application with:
- **Frontend**: Vue 3 + Tailwind CSS + TypeScript (Vite)
- **Backend**: Fastify + TypeScript + PostgreSQL
- **Auth**: Passwordless email+PIN via RSI Email Hub
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
│   │   ├── database.ts     # PG pool + query helpers
│   │   ├── migrate.ts      # Migration runner
│   │   ├── types.ts        # Shared TypeScript types
│   │   ├── routes/         # API route handlers
│   │   │   ├── auth.ts     # /api/auth/* (login, register, verify-pin, dev-login)
│   │   │   ├── users.ts    # /api/users/me
│   │   │   ├── organizations.ts  # /api/organizations/*
│   │   │   ├── invitations.ts    # /api/invitations/*
│   │   │   ├── health.ts   # /api/health
│   │   │   └── ai.ts       # /api/ai/chat, /api/hub/status
│   │   ├── middleware/
│   │   │   ├── auth.ts     # JWT validation (requireAuth, optionalAuth, signToken)
│   │   │   └── org-context.ts  # resolveOrg (checks X-Organization-Id header)
│   │   └── services/
│   │       ├── hub-client.ts  # Base Hub API client
│   │       ├── email.ts    # sendPin, sendInvitation, sendWelcome
│   │       ├── ai.ts       # chat, complete, json
│   │       └── pin.ts      # PIN generation, hashing, verification
│   └── package.json
└── frontend/
    ├── src/
    │   ├── main.ts         # App entry point
    │   ├── App.vue         # Root component with layout
    │   ├── style.css       # Tailwind + CSS variables (light/dark)
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
    │   │   ├── Register.vue     # Name + email → verify → dashboard
    │   │   ├── Dashboard.vue    # Hub status + AI chat widget
    │   │   ├── AiChat.vue       # Full-page AI chat
    │   │   ├── UserSettings.vue # Name, email, dark mode toggle
    │   │   ├── OrgSettings.vue  # Org name, members, invite
    │   │   └── InviteAccept.vue # Accept invitation
    │   ├── stores/
    │   │   ├── auth.ts    # Pinia auth store
    │   │   └── org.ts     # Pinia org store
    │   └── router/index.ts  # Vue Router with auth guards
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
| POST | `/api/invitations` | Bearer + X-Org | Send invite `{email, role?}` |
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
**auth_pins** — Short-lived PINs for login/verification (SHA-256 hashed)
**invitations** — Organization invitations (7-day expiry)

### Adding a Migration

1. Create `database/migrations/NNN_description.sql`
2. Run `npm run migrate -w backend`

Migrations track applied files in `_migrations` table and skip already-applied ones.

### Database Query Helpers

```typescript
import { query, queryOne } from './database.js';

// Execute query, get all rows
const result = await query<MyType>('SELECT * FROM users WHERE org_id = $1', [orgId]);
result.rows; // MyType[]

// Get single row or null
const user = await queryOne<User>('SELECT * FROM users WHERE id = $1', [id]);
```

## Auth System

### Passwordless Flow

1. **Login**: POST `/api/auth/login` with email → 6-digit PIN sent via Email Hub
2. **Verify**: POST `/api/auth/verify-pin` with email+PIN → JWT (7-day)
3. **Frontend**: Store JWT in `localStorage('token')`, send as `Authorization: Bearer <token>`

### PIN Security

- 6-digit random PIN (cryptographically secure)
- SHA-256 hashed before storage
- 5-minute expiry
- Max 5 attempts per PIN
- Old PINs invalidated on new request

### JWT

- 7-day expiry
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
2. Add route in `frontend/src/router/index.ts`:
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
