# Vue 3 Fullstack SaaS Starter

Full-stack SaaS template with Vue 3, Tailwind CSS, shadcn-vue, Fastify, PostgreSQL, passwordless auth, and RSI Hub integration.

## Features

- **Frontend**: Vue 3 + Tailwind CSS + shadcn-vue design system + TypeScript
- **Backend**: Fastify + TypeScript + PostgreSQL
- **Auth**: Passwordless email+PIN login (via RSI Email Hub)
- **Multi-tenant**: Organizations, memberships, invitations
- **Dark mode**: System-aware with manual toggle
- **AI Chat**: Built-in AI assistant (via RSI AI Hub)
- **Dev Login**: Localhost-only auto-login for testing

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your DATABASE_URL and JWT_SECRET

# Run migrations
npm run migrate -w backend

# Start development
npm run dev
```

## Project Structure

See [CLAUDE.md](./CLAUDE.md) for full development guide.
