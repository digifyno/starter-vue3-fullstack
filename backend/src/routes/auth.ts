import type { FastifyInstance } from 'fastify';
import { query, queryOne, withTransaction } from '../database.js';
import { createPin, generatePin, verifyPin } from '../services/pin.js';
import { sendPin } from '../services/email.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { AUTH, RATE_LIMITS } from '../constants.js';
import type { User, Organization, OrgMembership, PasskeyCredential } from '../types.js';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pinRegex = /^[0-9]{6}$/;

const errorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
  },
} as const;

// In-memory challenge stores with TTL (keyed by userId for registration, by email for authentication)
interface ChallengeEntry {
  challenge: string;
  expiresAt: number;
}

const registrationChallenges = new Map<string, ChallengeEntry>();
const authenticationChallenges = new Map<string, ChallengeEntry>();

function pruneExpiredChallenges<K>(map: Map<K, ChallengeEntry>): void {
  const now = Date.now();
  for (const [key, entry] of map.entries()) {
    if (now > entry.expiresAt) map.delete(key);
  }
}

function storeChallenge<K>(map: Map<K, ChallengeEntry>, key: K, challenge: string): void {
  if (map.size >= 10_000) pruneExpiredChallenges(map);
  map.set(key, { challenge, expiresAt: Date.now() + AUTH.CHALLENGE_TTL_MS });
}

type ConsumeResult = { challenge: string } | { error: 'not_found' | 'expired' };

function consumeChallenge<K>(map: Map<K, ChallengeEntry>, key: K): ConsumeResult {
  const entry = map.get(key);
  if (!entry) return { error: 'not_found' };
  map.delete(key);
  if (Date.now() > entry.expiresAt) return { error: 'expired' };
  return { challenge: entry.challenge };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/auth/register — create user + send verification PIN
  app.post<{ Body: { email: string; name: string } }>(
    '/api/auth/register',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'name'],
          properties: {
            email: { type: 'string', maxLength: 255 },
            name: { type: 'string', maxLength: 255 },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: { message: { type: 'string' } },
          },
          400: errorSchema,
          409: errorSchema,
        },
      },
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

      const pin = generatePin();
      try {
        await sendPin(email.toLowerCase(), pin);
      } catch {
        return reply.status(503).send({ error: 'Email service unavailable. Please try again later.' });
      }

      await withTransaction(async (client) => {
        await client.query(
          'INSERT INTO users (email, name) VALUES ($1, $2)',
          [email.toLowerCase(), name],
        );
        await createPin(email.toLowerCase(), 'verification', client, pin);
      });

      return { message: 'Verification PIN sent to your email' };
    },
  );

  // POST /api/auth/login — send login PIN
  app.post<{ Body: { email: string } }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', maxLength: 255 },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: { message: { type: 'string' } },
          },
          400: errorSchema,
        },
      },
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
      schema: {
        body: {
          type: 'object',
          required: ['email', 'pin'],
          properties: {
            email: { type: 'string', maxLength: 255 },
            pin: { type: 'string' },
            purpose: { type: 'string', enum: ['login', 'verification'] },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: {
              token: { type: 'string' },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  email: { type: 'string' },
                  name: { type: 'string' },
                  avatar_url: { type: 'string', nullable: true },
                  email_verified: { type: 'boolean' },
                },
              },
              organizations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    slug: { type: 'string' },
                    role: { type: 'string' },
                  },
                },
              },
            },
          },
          400: errorSchema,
          401: errorSchema,
        },
      },
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
      query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]).catch((err) => {
        logger.warn({ err, userId: user.id }, 'Failed to update last_login_at — non-fatal but unexpected');
      });

      const token = await signToken({ userId: user.id, email: user.email });

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
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { token: { type: 'string' } },
          },
          401: errorSchema,
        },
      },
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

      const token = await signToken({ userId: user.id, email: user.email });
      return { token };
    },
  );

  // GET /api/auth/dev-login — localhost-only auto-login for testing
  app.get('/api/auth/dev-login', {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                email: { type: 'string' },
                name: { type: 'string' },
                avatar_url: { type: 'string', nullable: true },
                email_verified: { type: 'boolean' },
              },
            },
            organizations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  slug: { type: 'string' },
                  role: { type: 'string' },
                },
              },
            },
          },
        },
        403: errorSchema,
        500: errorSchema,
      },
    },
  }, async (request, reply) => {
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

    const token = await signToken({ userId: user.id, email: user.email });

    return {
      token,
      user: { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url, email_verified: true },
      organizations: [{ id: org.id, name: org.name, slug: org.slug, role: 'owner' }],
    };
  });

  // POST /api/auth/passkey/register/begin — begin passkey registration (requires auth)
  app.post(
    '/api/auth/passkey/register/begin',
    {
      schema: {
        response: {
          200: { type: 'object', additionalProperties: true },
          401: errorSchema,
          500: errorSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const userId = request.userId;
      if (!userId) return reply.status(401).send({ error: 'Authentication required' });

      const user = await queryOne<User>('SELECT id, email, name FROM users WHERE id = $1', [userId]);
      if (!user) return reply.status(401).send({ error: 'User not found' });

      // Get existing credentials to exclude
      const existingCreds = await query<PasskeyCredential>(
        'SELECT credential_id FROM passkey_credentials WHERE user_id = $1',
        [userId],
      );

      const options = await generateRegistrationOptions({
        rpID: config.rpId,
        rpName: config.rpName,
        userName: user.email,
        userID: new TextEncoder().encode(userId),
        excludeCredentials: existingCreds.rows.map((c) => ({ id: c.credential_id })),
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
      });

      // Store challenge keyed by userId
      storeChallenge(registrationChallenges, userId, options.challenge);

      return options;
    },
  );

  // POST /api/auth/passkey/register/complete — complete passkey registration (requires auth)
  app.post<{ Body: { response: RegistrationResponseJSON; deviceName?: string } }>(
    '/api/auth/passkey/register/complete',
    {
      schema: {
        body: {
          type: 'object',
          required: ['response'],
          properties: {
            response: { type: 'object', additionalProperties: true },
            deviceName: { type: 'string', maxLength: 255 },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              credentialId: { type: 'string' },
            },
          },
          400: errorSchema,
          401: errorSchema,
          409: errorSchema,
        },
      },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      const userId = request.userId;
      if (!userId) return reply.status(401).send({ error: 'Authentication required' });

      const regResult = consumeChallenge(registrationChallenges, userId);
      if (!('challenge' in regResult)) {
        const msg = regResult.error === 'expired'
          ? 'Registration challenge has expired. Please begin registration again.'
          : 'No registration challenge found. Please begin registration first.';
        return reply.status(400).send({ error: msg });
      }
      const expectedChallenge = regResult.challenge;

      const { response, deviceName } = request.body;

      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response,
          expectedChallenge,
          expectedOrigin: config.appUrl,
          expectedRPID: config.rpId,
          requireUserVerification: false,
        });
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : 'Registration verification failed' });
      }

      if (!verification.verified || !verification.registrationInfo) {
        return reply.status(400).send({ error: 'Registration verification failed' });
      }

      const { credential, aaguid, credentialBackedUp } = verification.registrationInfo;

      // Insert into passkey_credentials
      try {
        await query(
          `INSERT INTO passkey_credentials (user_id, credential_id, public_key, sign_count, aaguid, device_name, backed_up)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            userId,
            credential.id,
            Buffer.from(credential.publicKey),
            credential.counter,
            aaguid ?? null,
            deviceName ?? null,
            credentialBackedUp,
          ],
        );
      } catch (err) {
        if (err instanceof Error && (err as Error & { code?: string }).code === '23505') {
          return reply.status(409).send({ error: 'This passkey is already registered' });
        }
        throw err;
      }

      return { success: true, credentialId: credential.id };
    },
  );

  // POST /api/auth/passkey/login/begin — begin passkey authentication (unauthenticated)
  app.post<{ Body: { email: string } }>(
    '/api/auth/passkey/login/begin',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', maxLength: 255 },
          },
          additionalProperties: false,
        },
        response: {
          200: { type: 'object', additionalProperties: true },
          400: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const { email } = request.body;
      if (!email) return reply.status(400).send({ error: 'Email required' });
      if (!emailRegex.test(email)) return reply.status(400).send({ error: 'Invalid email address' });

      const normalizedEmail = email.toLowerCase();

      // Look up user and their credentials (don't reveal if user exists)
      const user = await queryOne<User>('SELECT id FROM users WHERE email = $1', [normalizedEmail]);

      let allowCredentials: { id: string }[] = [];
      if (user) {
        const creds = await query<PasskeyCredential>(
          'SELECT credential_id FROM passkey_credentials WHERE user_id = $1',
          [user.id],
        );
        allowCredentials = creds.rows.map((c) => ({ id: c.credential_id }));
      }

      const options = await generateAuthenticationOptions({
        rpID: config.rpId,
        allowCredentials,
        userVerification: 'preferred',
      });

      // Store challenge keyed by email
      storeChallenge(authenticationChallenges, normalizedEmail, options.challenge);

      return options;
    },
  );

  // POST /api/auth/passkey/login/complete — complete passkey authentication (unauthenticated)
  app.post<{ Body: { email: string; response: AuthenticationResponseJSON } }>(
    '/api/auth/passkey/login/complete',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'response'],
          properties: {
            email: { type: 'string', maxLength: 255 },
            response: { type: 'object', additionalProperties: true },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: {
              token: { type: 'string' },
              user: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  email: { type: 'string' },
                  name: { type: 'string' },
                  avatar_url: { type: 'string', nullable: true },
                  email_verified: { type: 'boolean' },
                },
              },
            },
          },
          400: errorSchema,
          401: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const { email, response } = request.body;
      if (!email) return reply.status(400).send({ error: 'Email required' });
      if (!emailRegex.test(email)) return reply.status(400).send({ error: 'Invalid email address' });

      const normalizedEmail = email.toLowerCase();

      const authResult = consumeChallenge(authenticationChallenges, normalizedEmail);
      if (!('challenge' in authResult)) {
        const msg = authResult.error === 'expired'
          ? 'Authentication challenge has expired. Please begin authentication again.'
          : 'No authentication challenge found. Please begin authentication first.';
        return reply.status(400).send({ error: msg });
      }
      const expectedChallenge = authResult.challenge;

      const user = await queryOne<User>('SELECT id, email, name, avatar_url, email_verified FROM users WHERE email = $1', [normalizedEmail]);
      if (!user) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      // Find matching credential by credential ID
      const credentialId = response.id;
      const cred = await queryOne<PasskeyCredential>(
        'SELECT id, credential_id, public_key, sign_count FROM passkey_credentials WHERE credential_id = $1 AND user_id = $2',
        [credentialId, user.id],
      );

      if (!cred) {
        return reply.status(401).send({ error: 'Credential not found' });
      }

      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response,
          expectedChallenge,
          expectedOrigin: config.appUrl,
          expectedRPID: config.rpId,
          credential: {
            id: cred.credential_id,
            publicKey: new Uint8Array(cred.public_key),
            counter: cred.sign_count,
          },
          requireUserVerification: false,
        });
      } catch (err) {
        return reply.status(401).send({ error: err instanceof Error ? err.message : 'Authentication verification failed' });
      }

      if (!verification.verified) {
        return reply.status(401).send({ error: 'Authentication verification failed' });
      }

      const { newCounter } = verification.authenticationInfo;

      // Check sign_count monotonicity to detect cloned authenticators
      if (cred.sign_count > 0 && newCounter > 0 && newCounter <= cred.sign_count) {
        return reply.status(401).send({ error: 'Authenticator clone detected. Please contact support.' });
      }

      // Update last_used_at and sign_count
      await query(
        'UPDATE passkey_credentials SET last_used_at = NOW(), sign_count = $1 WHERE id = $2',
        [newCounter, cred.id],
      );

      // Update last_login_at
      query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]).catch((err) => {
        logger.warn({ err, userId: user.id }, 'Failed to update last_login_at — non-fatal but unexpected');
      });

      const token = await signToken({ userId: user.id, email: user.email });

      return {
        token,
        user: { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url, email_verified: user.email_verified },
      };
    },
  );
}
