import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../database.js';
import { createPin, verifyPin } from '../services/pin.js';
import { sendPin, sendWelcome } from '../services/email.js';
import { signToken } from '../middleware/auth.js';
import { config } from '../config.js';
import type { User, Organization, OrgMembership } from '../types.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/auth/register — create user + send verification PIN
  app.post<{ Body: { email: string; name: string } }>('/api/auth/register', async (request, reply) => {
    const { email, name } = request.body;
    if (!email || !name) return reply.status(400).send({ error: 'Email and name required' });

    const existing = await queryOne<User>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing) return reply.status(409).send({ error: 'User already exists. Please log in.' });

    // Create unverified user
    await query(
      'INSERT INTO users (email, name) VALUES ($1, $2)',
      [email.toLowerCase(), name],
    );

    // Send verification PIN
    const pin = await createPin(email.toLowerCase(), 'verification');
    await sendPin(email.toLowerCase(), pin);

    return { message: 'Verification PIN sent to your email' };
  });

  // POST /api/auth/login — send login PIN
  app.post<{ Body: { email: string } }>('/api/auth/login', async (request, reply) => {
    const { email } = request.body;
    if (!email) return reply.status(400).send({ error: 'Email required' });

    const user = await queryOne<User>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!user) return reply.status(404).send({ error: 'No account found. Please register first.' });

    const pin = await createPin(email.toLowerCase(), 'login');
    await sendPin(email.toLowerCase(), pin);

    return { message: 'Login PIN sent to your email' };
  });

  // POST /api/auth/verify-pin — verify PIN and return JWT
  app.post<{ Body: { email: string; pin: string; purpose?: string } }>('/api/auth/verify-pin', async (request, reply) => {
    const { email, pin, purpose = 'login' } = request.body;
    if (!email || !pin) return reply.status(400).send({ error: 'Email and PIN required' });

    const validPurpose = purpose === 'verification' ? 'verification' : 'login';
    const valid = await verifyPin(email.toLowerCase(), pin, validPurpose as 'login' | 'verification');
    if (!valid) return reply.status(401).send({ error: 'Invalid or expired PIN' });

    // Mark email as verified if this was a verification PIN
    if (validPurpose === 'verification') {
      await query('UPDATE users SET email_verified = true WHERE email = $1', [email.toLowerCase()]);
    }

    const user = await queryOne<User>('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    if (!user) return reply.status(404).send({ error: 'User not found' });

    // Update last login
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    // Get user's organizations
    const orgs = await query<Organization & { role: string }>(
      `SELECT o.*, m.role FROM organizations o
       JOIN org_memberships m ON m.organization_id = o.id
       WHERE m.user_id = $1 ORDER BY o.name`,
      [user.id],
    );

    const token = signToken({ userId: user.id, email: user.email });

    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url, email_verified: user.email_verified },
      organizations: orgs.rows.map((o) => ({ id: o.id, name: o.name, slug: o.slug, role: o.role })),
    };
  });

  // POST /api/auth/refresh — refresh JWT (requires valid token)
  app.post('/api/auth/refresh', async (request, reply) => {
    // Uses optionalAuth — if token is valid, issue a new one
    if (!request.userId) return reply.status(401).send({ error: 'Valid token required' });

    const user = await queryOne<User>('SELECT * FROM users WHERE id = $1', [request.userId]);
    if (!user) return reply.status(404).send({ error: 'User not found' });

    const token = signToken({ userId: user.id, email: user.email });
    return { token };
  });

  // GET /api/auth/dev-login — localhost-only auto-login for testing
  app.get('/api/auth/dev-login', async (request, reply) => {
    if (config.disableDevLogin) {
      return reply.status(403).send({ error: 'Dev login is disabled' });
    }

    const ip = request.ip;
    const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
    if (!isLocalhost) {
      return reply.status(403).send({ error: 'Dev login only available from localhost' });
    }

    // Find or create dev user
    let user = await queryOne<User>('SELECT * FROM users WHERE email = $1', ['dev@localhost']);
    if (!user) {
      await query(
        'INSERT INTO users (email, name, email_verified) VALUES ($1, $2, true)',
        ['dev@localhost', 'Dev User'],
      );
      user = await queryOne<User>('SELECT * FROM users WHERE email = $1', ['dev@localhost']);
    }
    if (!user) return reply.status(500).send({ error: 'Failed to create dev user' });

    // Ensure dev org exists
    let org = await queryOne<Organization>("SELECT * FROM organizations WHERE slug = 'dev'");
    if (!org) {
      await query(
        "INSERT INTO organizations (name, slug) VALUES ('Development', 'dev')",
      );
      org = await queryOne<Organization>("SELECT * FROM organizations WHERE slug = 'dev'");
    }
    if (!org) return reply.status(500).send({ error: 'Failed to create dev org' });

    // Ensure membership
    const membership = await queryOne<OrgMembership>(
      'SELECT * FROM org_memberships WHERE user_id = $1 AND organization_id = $2',
      [user.id, org.id],
    );
    if (!membership) {
      await query(
        "INSERT INTO org_memberships (user_id, organization_id, role) VALUES ($1, $2, 'owner')",
        [user.id, org.id],
      );
    }

    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const token = signToken({ userId: user.id, email: user.email });

    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url, email_verified: true },
      organizations: [{ id: org.id, name: org.name, slug: org.slug, role: 'owner' }],
    };
  });
}
