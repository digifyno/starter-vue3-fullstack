import type { FastifyInstance } from 'fastify';
import { query, queryOne, withTransaction } from '../database.js';
import { createPin, verifyPin } from '../services/pin.js';
import { sendPin, sendWelcome } from '../services/email.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { config } from '../config.js';
import { RATE_LIMITS } from '../constants.js';
import type { User, Organization, OrgMembership } from '../types.js';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pinRegex = /^[0-9]{6}$/;

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/auth/register — create user + send verification PIN
  app.post<{ Body: { email: string; name: string } }>(
    '/api/auth/register',
    {
      config: {
        rateLimit: {
          ...RATE_LIMITS.REGISTER,
          keyGenerator: (request) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const { email, name } = request.body;
      if (!email || !name) return reply.status(400).send({ error: 'Email and name required' });
      if (!emailRegex.test(email)) return reply.status(400).send({ error: 'Invalid email address' });
      if (name.trim().length === 0) return reply.status(400).send({ error: 'Name cannot be empty' });
      if (name.length > 255) return reply.status(400).send({ error: 'Name too long' });

      const existing = await queryOne<User>('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      if (existing) return reply.status(409).send({ error: 'User already exists. Please log in.' });

      await withTransaction(async (client) => {
        await client.query(
          'INSERT INTO users (email, name) VALUES ($1, $2)',
          [email.toLowerCase(), name],
        );
        const pin = await createPin(email.toLowerCase(), 'verification', client);
        await sendPin(email.toLowerCase(), pin);
      });

      return { message: 'Verification PIN sent to your email' };
    },
  );

  // POST /api/auth/login — send login PIN
  app.post<{ Body: { email: string } }>(
    '/api/auth/login',
    {
      config: {
        rateLimit: {
          ...RATE_LIMITS.LOGIN,
          keyGenerator: (request) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const { email } = request.body;
      if (!email) return reply.status(400).send({ error: 'Email required' });
      if (!emailRegex.test(email)) return reply.status(400).send({ error: 'Invalid email address' });

      const user = await queryOne<User>('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      if (!user) {
        // Don't reveal whether account exists
        return { message: 'If an account exists, a PIN has been sent to your email' };
      }

      const pin = await createPin(email.toLowerCase(), 'login');
      await sendPin(email.toLowerCase(), pin);

      return { message: 'If an account exists, a PIN has been sent to your email' };
    },
  );

  // POST /api/auth/verify-pin — verify PIN and return JWT
  app.post<{ Body: { email: string; pin: string; purpose?: string } }>(
    '/api/auth/verify-pin',
    {
      config: {
        rateLimit: {
          ...RATE_LIMITS.VERIFY_PIN,
          keyGenerator: (request) => {
            const body = request.body as { email?: string };
            return `${request.ip}:${(body?.email || '').toLowerCase()}`;
          },
        },
      },
    },
    async (request, reply) => {
      const { email, pin, purpose = 'login' } = request.body;
      if (!email || !pin) return reply.status(400).send({ error: 'Email and PIN required' });
      if (!emailRegex.test(email)) return reply.status(400).send({ error: 'Invalid email address' });
      if (!pinRegex.test(pin)) return reply.status(400).send({ error: 'PIN must be 6 digits' });

      const validPurpose = purpose === 'verification' ? 'verification' : 'login';
      const valid = await verifyPin(email.toLowerCase(), pin, validPurpose as 'login' | 'verification');
      if (!valid) return reply.status(401).send({ error: 'Invalid or expired PIN' });

      // Mark email as verified if this was a verification PIN
      if (validPurpose === 'verification') {
        await query('UPDATE users SET email_verified = true WHERE email = $1', [email.toLowerCase()]);
      }

      // Fetch user and organizations in parallel
      const [user, orgs] = await Promise.all([
        queryOne<User>(
          'SELECT id, email, name, avatar_url, email_verified FROM users WHERE email = $1',
          [email.toLowerCase()],
        ),
        query<Organization & { role: string }>(
          `SELECT o.id, o.name, o.slug, m.role
           FROM organizations o
           JOIN org_memberships m ON m.organization_id = o.id
           JOIN users u ON u.id = m.user_id AND u.email = $1
           ORDER BY o.name`,
          [email.toLowerCase()],
        ),
      ]);

      if (!user) return reply.status(401).send({ error: 'Invalid or expired PIN' });

      // Fire-and-forget: non-critical
      query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]).catch(() => {});

      const token = signToken({ userId: user.id, email: user.email });

      return {
        token,
        user: { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url, email_verified: user.email_verified },
        organizations: orgs.rows.map((o) => ({ id: o.id, name: o.name, slug: o.slug, role: o.role })),
      };
    },
  );

  // POST /api/auth/refresh — refresh JWT (requires valid token)
  app.post(
    '/api/auth/refresh',
    {
      preHandler: [requireAuth],
      config: {
        rateLimit: {
          ...RATE_LIMITS.REFRESH,
          keyGenerator: (request) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const user = await queryOne<User>('SELECT id, email, name, avatar_url, email_verified FROM users WHERE id = $1', [request.userId]);
      if (!user) return reply.status(401).send({ error: 'Invalid or expired token' });

      const token = signToken({ userId: user.id, email: user.email });
      return { token };
    },
  );

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
    let user = await queryOne<User>('SELECT id, email, name, avatar_url, email_verified FROM users WHERE email = $1', ['dev@localhost']);
    if (!user) {
      await query(
        'INSERT INTO users (email, name, email_verified) VALUES ($1, $2, true)',
        ['dev@localhost', 'Dev User'],
      );
      user = await queryOne<User>('SELECT id, email, name, avatar_url, email_verified FROM users WHERE email = $1', ['dev@localhost']);
    }
    if (!user) return reply.status(500).send({ error: 'Failed to create dev user' });

    // Ensure dev org exists
    let org = await queryOne<Organization>("SELECT id, name, slug, logo_url, settings, created_at FROM organizations WHERE slug = 'dev'");
    if (!org) {
      await query(
        "INSERT INTO organizations (name, slug) VALUES ('Development', 'dev')",
      );
      org = await queryOne<Organization>("SELECT id, name, slug, logo_url, settings, created_at FROM organizations WHERE slug = 'dev'");
    }
    if (!org) return reply.status(500).send({ error: 'Failed to create dev org' });

    // Ensure membership
    const membership = await queryOne<OrgMembership>(
      'SELECT id FROM org_memberships WHERE user_id = $1 AND organization_id = $2',
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
