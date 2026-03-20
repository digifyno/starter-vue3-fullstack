import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { authRoutes, registrationChallenges, authenticationChallenges } from './auth.js';

// ── Database mock ────────────────────────────────────────────────────────────
vi.mock('../database.js', () => {
  const query = vi.fn().mockResolvedValue({ rows: [] } as any);
  const queryOne = vi.fn().mockResolvedValue(null);
  const withTransaction = vi.fn().mockImplementation(
    async (fn: (client: { query: typeof query }) => Promise<unknown>) => fn({ query }),
  );
  return { query, queryOne, withTransaction };
});

// ── Email + PIN mocks (auth.ts imports these) ─────────────────────────────────
vi.mock('../services/email.js', () => ({
  sendPin: vi.fn().mockResolvedValue(undefined),
  sendWelcome: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/pin.js', () => ({
  createPin: vi.fn().mockResolvedValue('123456'),
  verifyPin: vi.fn().mockResolvedValue(false),
}));

// ── Auth middleware mock ──────────────────────────────────────────────────────
vi.mock('../middleware/auth.js', () => ({
  signToken: vi.fn().mockReturnValue('mock-jwt-token'),
  optionalAuth: vi.fn().mockImplementation(async () => {}),
  requireAuth: vi.fn().mockImplementation(async (request: any, reply: any) => {
    const auth = request.headers?.authorization;
    if (!auth?.startsWith('Bearer ')) {
      reply.status(401).send({ error: 'Authentication required' });
      return;
    }
    request.userId = 'user-1';
    request.userEmail = 'user@example.com';
  }),
}));

// ── Config mock (includes WebAuthn rpId / appUrl) ─────────────────────────────
vi.mock('../config.js', () => ({
  config: {
    disableDevLogin: false,
    nodeEnv: 'test',
    port: 4001,
    host: '127.0.0.1',
    jwtSecret: 'test-secret',
    appUrl: 'http://localhost:5173',
    rpId: 'localhost',
    rpName: 'Test App',
  },
}));

// ── @simplewebauthn/server mock ───────────────────────────────────────────────
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({
    challenge: 'test-reg-challenge',
    rp: { id: 'localhost', name: 'Test App' },
    user: { id: 'dXNlci0x', name: 'user@example.com', displayName: 'user@example.com' },
    pubKeyCredParams: [],
    timeout: 60000,
    excludeCredentials: [],
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    attestation: 'none',
  }),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn().mockResolvedValue({
    challenge: 'test-auth-challenge',
    timeout: 60000,
    rpId: 'localhost',
    allowCredentials: [],
    userVerification: 'preferred',
  }),
  verifyAuthenticationResponse: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────

describe('Passkey Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    // authRoutes defines full paths (/api/auth/passkey/...) — register without prefix
    await app.register(authRoutes);
    await app.ready();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    vi.clearAllMocks();
    registrationChallenges.clear();
    authenticationChallenges.clear();
  });

  // ── POST /api/auth/passkey/register/begin ─────────────────────────────────

  describe('POST /api/auth/passkey/register/begin', () => {
    it('returns 401 without an auth token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/begin',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns registration options with challenge and rpId when authenticated', async () => {
      const { queryOne, query } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
      });
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/begin',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.challenge).toBe('test-reg-challenge');
      expect(body.rp.id).toBe('localhost');
    });

    it('excludes already-registered credentials from options', async () => {
      const { queryOne, query } = await import('../database.js');
      const { generateRegistrationOptions } = await import('@simplewebauthn/server');
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
      });
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ credential_id: 'existing-cred-id' }],
      } as any);

      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/begin',
        headers: { authorization: 'Bearer valid-token' },
      });

      expect(vi.mocked(generateRegistrationOptions)).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeCredentials: [{ id: 'existing-cred-id' }],
        }),
      );
    });

    it('second register/begin call replaces the first challenge for the same user', async () => {
      const { queryOne, query } = await import('../database.js');
      const { generateRegistrationOptions, verifyRegistrationResponse } = await import('@simplewebauthn/server');

      // Return distinct challenges for each begin call
      const baseOptions = {
        rp: { id: 'localhost', name: 'Test App' },
        user: { id: 'dXNlci0x', name: 'user@example.com', displayName: 'user@example.com' },
        pubKeyCredParams: [],
        timeout: 60000,
        excludeCredentials: [],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
        attestation: 'none',
      };
      vi.mocked(generateRegistrationOptions)
        .mockResolvedValueOnce({ ...baseOptions, challenge: 'first-challenge' } as any)
        .mockResolvedValueOnce({ ...baseOptions, challenge: 'second-challenge' } as any);

      // First begin call
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'user-1', email: 'user@example.com', name: 'Test User' });
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/begin',
        headers: { authorization: 'Bearer valid-token' },
      });

      // Second begin call — replaces the first challenge in the store
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'user-1', email: 'user@example.com', name: 'Test User' });
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/begin',
        headers: { authorization: 'Bearer valid-token' },
      });

      // complete must call verifyRegistrationResponse with the SECOND challenge, not the first
      vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
        verified: true,
        registrationInfo: {
          credential: { id: 'cred-concurrent', publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
          aaguid: null,
          credentialBackedUp: false,
        },
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/complete',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          response: {
            id: 'cred-concurrent',
            rawId: 'cred-concurrent',
            response: { attestationObject: 'test', clientDataJSON: 'test' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(vi.mocked(verifyRegistrationResponse)).toHaveBeenCalledWith(
        expect.objectContaining({ expectedChallenge: 'second-challenge' }),
      );
    });
  });

  // ── POST /api/auth/passkey/register/complete ──────────────────────────────

  describe('POST /api/auth/passkey/register/complete', () => {
    it('returns 401 without an auth token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/complete',
        payload: { response: {} },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 400 when no registration challenge exists (begin was never called)', async () => {
      const { requireAuth } = await import('../middleware/auth.js');
      // Use a userId that has never had begin called → no challenge in store
      vi.mocked(requireAuth).mockImplementationOnce(async (request: any) => {
        request.userId = 'user-never-registered';
        request.userEmail = 'nobegin@example.com';
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/complete',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          response: {
            id: 'cred-id',
            rawId: 'cred-id',
            response: { attestationObject: 'test', clientDataJSON: 'test' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('No registration challenge');
    });

    it('stores credential and returns credentialId on successful registration', async () => {
      const { queryOne, query } = await import('../database.js');
      const { verifyRegistrationResponse } = await import('@simplewebauthn/server');

      // Call begin first to populate the challenge
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
      });
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/begin',
        headers: { authorization: 'Bearer valid-token' },
      });

      // Complete registration with a valid response
      vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'new-cred-id',
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
          },
          aaguid: 'test-aaguid',
          credentialBackedUp: false,
        },
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/complete',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          response: {
            id: 'new-cred-id',
            rawId: 'new-cred-id',
            response: { attestationObject: 'base64-cbor', clientDataJSON: 'base64-json' },
            type: 'public-key',
          },
          deviceName: 'My Phone',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.credentialId).toBe('new-cred-id');

      // Credential was inserted into the database
      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO passkey_credentials'),
        expect.arrayContaining(['user-1', 'new-cred-id']),
      );
    });

    it('returns 400 when verifyRegistrationResponse throws (e.g., wrong rpId)', async () => {
      const { queryOne, query } = await import('../database.js');
      const { verifyRegistrationResponse } = await import('@simplewebauthn/server');

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
      });
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/begin',
        headers: { authorization: 'Bearer valid-token' },
      });

      vi.mocked(verifyRegistrationResponse).mockRejectedValueOnce(
        new Error('Unexpected RP ID "evil.com"'),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/complete',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          response: {
            id: 'cred-id',
            rawId: 'cred-id',
            response: { attestationObject: 'bad', clientDataJSON: 'bad' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Unexpected RP ID');
    });

    it('returns 400 when verification returns verified=false', async () => {
      const { queryOne, query } = await import('../database.js');
      const { verifyRegistrationResponse } = await import('@simplewebauthn/server');

      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
      });
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/begin',
        headers: { authorization: 'Bearer valid-token' },
      });

      vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
        verified: false,
        registrationInfo: undefined,
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/complete',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          response: {
            id: 'cred-id',
            rawId: 'cred-id',
            response: { attestationObject: 'bad', clientDataJSON: 'bad' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('verification failed');
    });

    it('rejects a replayed challenge (challenge deleted after first use)', async () => {
      const { queryOne, query } = await import('../database.js');
      const { verifyRegistrationResponse } = await import('@simplewebauthn/server');

      // Begin
      vi.mocked(queryOne).mockResolvedValueOnce({
        id: 'user-1',
        email: 'user@example.com',
        name: 'Test User',
      });
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/begin',
        headers: { authorization: 'Bearer valid-token' },
      });

      // First complete: succeeds, consuming the challenge
      vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
        verified: true,
        registrationInfo: {
          credential: { id: 'cred-id', publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
          aaguid: null,
          credentialBackedUp: false,
        },
      } as any);
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/complete',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          response: {
            id: 'cred-id',
            rawId: 'cred-id',
            response: { attestationObject: 'a', clientDataJSON: 'a' },
            type: 'public-key',
          },
        },
      });

      // Second complete with same response: challenge already consumed → 400
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/complete',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          response: {
            id: 'cred-id',
            rawId: 'cred-id',
            response: { attestationObject: 'a', clientDataJSON: 'a' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('No registration challenge');
    });

    it('returns 409 when the credential ID already exists in the database (unique constraint violation)', async () => {
      const { queryOne, query } = await import('../database.js');
      const { verifyRegistrationResponse } = await import('@simplewebauthn/server');

      // begin: user exists, no existing creds
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'user-1', email: 'user@example.com', name: 'Test User' });
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/begin',
        headers: { authorization: 'Bearer valid-token' },
      });

      // verify: succeeds
      vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
        verified: true,
        registrationInfo: {
          credential: { id: 'dup-cred-id', publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
          aaguid: null,
          credentialBackedUp: false,
        },
      } as any);

      // INSERT fails with a DB unique constraint violation (credential_id already registered)
      vi.mocked(query).mockRejectedValueOnce(
        Object.assign(
          new Error('duplicate key value violates unique constraint "passkey_credentials_credential_id_key"'),
          { code: '23505' },
        ),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/complete',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          response: {
            id: 'dup-cred-id',
            rawId: 'dup-cred-id',
            response: { attestationObject: 'test', clientDataJSON: 'test' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error).toBe('This passkey is already registered');
    });
  });

  // ── POST /api/auth/passkey/login/begin ────────────────────────────────────

  describe('POST /api/auth/passkey/login/begin', () => {
    it('returns 400 for invalid email format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/begin',
        payload: { email: 'not-an-email' },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('Invalid email');
    });

    it('returns authentication options with challenge for a known user', async () => {
      const { queryOne, query } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'user-1' });
      vi.mocked(query).mockResolvedValueOnce({
        rows: [{ credential_id: 'existing-cred-id' }],
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/begin',
        payload: { email: 'user@example.com' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.challenge).toBe('test-auth-challenge');
    });

    it('returns options for unknown email without revealing user existence', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/begin',
        payload: { email: 'ghost@example.com' },
      });

      // Must return 200 even if no account exists (prevents user enumeration)
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.challenge).toBeDefined();
    });

    it('returns 400 when the email field is missing from the request body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/begin',
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // ── POST /api/auth/passkey/login/complete ─────────────────────────────────

  describe('POST /api/auth/passkey/login/complete', () => {
    it('returns 400 when no challenge exists (begin was never called for this email)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/complete',
        payload: {
          email: 'nochallenge-unique@example.com',
          response: {
            id: 'cred-id',
            rawId: 'cred-id',
            response: { authenticatorData: 'a', clientDataJSON: 'a', signature: 'a' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('No authentication challenge');
    });

    it('returns 401 when user is not found at complete time', async () => {
      const { queryOne } = await import('../database.js');
      // begin: user found → challenge stored
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'user-1' });
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/begin',
        payload: { email: 'vanished@example.com' },
      });

      // complete: user no longer in DB
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/complete',
        payload: {
          email: 'vanished@example.com',
          response: {
            id: 'cred-id',
            rawId: 'cred-id',
            response: { authenticatorData: 'a', clientDataJSON: 'a', signature: 'a' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when credential ID is not registered for the user', async () => {
      const { queryOne } = await import('../database.js');
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'user-1' });
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/begin',
        payload: { email: 'user@example.com' },
      });

      // complete: user found, but credential not found
      vi.mocked(queryOne)
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'user@example.com',
          name: 'Test User',
          avatar_url: null,
          email_verified: true,
        })
        .mockResolvedValueOnce(null); // credential lookup returns null

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/complete',
        payload: {
          email: 'user@example.com',
          response: {
            id: 'unknown-cred',
            rawId: 'unknown-cred',
            response: { authenticatorData: 'a', clientDataJSON: 'a', signature: 'a' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toBe('Credential not found');
    });

    it('returns JWT and user on successful assertion', async () => {
      const { queryOne } = await import('../database.js');
      const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');

      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'user-1' });
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/begin',
        payload: { email: 'user@example.com' },
      });

      vi.mocked(queryOne)
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'user@example.com',
          name: 'Test User',
          avatar_url: null,
          email_verified: true,
        })
        .mockResolvedValueOnce({
          id: 'pk-row-1',
          credential_id: 'cred-id',
          public_key: Buffer.from([1, 2, 3]),
          sign_count: 5,
        });

      vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
        verified: true,
        authenticationInfo: { newCounter: 6 },
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/complete',
        payload: {
          email: 'user@example.com',
          response: {
            id: 'cred-id',
            rawId: 'cred-id',
            response: { authenticatorData: 'a', clientDataJSON: 'a', signature: 'a' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.token).toBe('mock-jwt-token');
      expect(body.user.email).toBe('user@example.com');
    });

    it('updates sign_count in the database after successful assertion', async () => {
      const { queryOne, query } = await import('../database.js');
      const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');

      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'user-1' });
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/begin',
        payload: { email: 'user@example.com' },
      });

      vi.mocked(queryOne)
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'user@example.com',
          name: 'Test User',
          avatar_url: null,
          email_verified: true,
        })
        .mockResolvedValueOnce({
          id: 'pk-row-1',
          credential_id: 'cred-id',
          public_key: Buffer.from([1, 2, 3]),
          sign_count: 3,
        });

      vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
        verified: true,
        authenticationInfo: { newCounter: 4 },
      } as any);

      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/complete',
        payload: {
          email: 'user@example.com',
          response: {
            id: 'cred-id',
            rawId: 'cred-id',
            response: { authenticatorData: 'a', clientDataJSON: 'a', signature: 'a' },
            type: 'public-key',
          },
        },
      });

      expect(vi.mocked(query)).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE passkey_credentials'),
        expect.arrayContaining([4, 'pk-row-1']),
      );
    });

    it('rejects counter regression — newCounter < stored sign_count (cloned authenticator)', async () => {
      const { queryOne } = await import('../database.js');
      const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');

      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'user-1' });
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/begin',
        payload: { email: 'user@example.com' },
      });

      vi.mocked(queryOne)
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'user@example.com',
          name: 'Test User',
          avatar_url: null,
          email_verified: true,
        })
        .mockResolvedValueOnce({
          id: 'pk-row-1',
          credential_id: 'cred-id',
          public_key: Buffer.from([1, 2, 3]),
          sign_count: 10,
        });

      // newCounter=5 is less than stored 10 → authenticator clone
      vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
        verified: true,
        authenticationInfo: { newCounter: 5 },
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/complete',
        payload: {
          email: 'user@example.com',
          response: {
            id: 'cred-id',
            rawId: 'cred-id',
            response: { authenticatorData: 'a', clientDataJSON: 'a', signature: 'a' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toContain('clone detected');
    });

    it('rejects counter equal to stored sign_count (also indicates clone)', async () => {
      const { queryOne } = await import('../database.js');
      const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');

      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'user-1' });
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/begin',
        payload: { email: 'user@example.com' },
      });

      vi.mocked(queryOne)
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'user@example.com',
          name: 'Test User',
          avatar_url: null,
          email_verified: true,
        })
        .mockResolvedValueOnce({
          id: 'pk-row-1',
          credential_id: 'cred-id',
          public_key: Buffer.from([1, 2, 3]),
          sign_count: 5,
        });

      // newCounter == sign_count → also suspicious (counter should strictly increase)
      vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
        verified: true,
        authenticationInfo: { newCounter: 5 },
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/complete',
        payload: {
          email: 'user@example.com',
          response: {
            id: 'cred-id',
            rawId: 'cred-id',
            response: { authenticatorData: 'a', clientDataJSON: 'a', signature: 'a' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toContain('clone detected');
    });

    it('rejects a replayed challenge (challenge deleted after first successful assertion)', async () => {
      const { queryOne } = await import('../database.js');
      const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');

      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'user-1' });
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/begin',
        payload: { email: 'replay-test@example.com' },
      });

      // First complete: succeeds
      vi.mocked(queryOne)
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'replay-test@example.com',
          name: 'Test',
          avatar_url: null,
          email_verified: true,
        })
        .mockResolvedValueOnce({
          id: 'pk-1',
          credential_id: 'cred',
          public_key: Buffer.from([1]),
          sign_count: 0,
        });
      vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      } as any);

      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/complete',
        payload: {
          email: 'replay-test@example.com',
          response: {
            id: 'cred',
            rawId: 'cred',
            response: { authenticatorData: 'a', clientDataJSON: 'a', signature: 'a' },
            type: 'public-key',
          },
        },
      });

      // Second complete with same credential response: challenge already consumed → 400
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/complete',
        payload: {
          email: 'replay-test@example.com',
          response: {
            id: 'cred',
            rawId: 'cred',
            response: { authenticatorData: 'a', clientDataJSON: 'a', signature: 'a' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('No authentication challenge');
    });

    it('returns 401 when verifyAuthenticationResponse throws', async () => {
      const { queryOne } = await import('../database.js');
      const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');

      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'user-1' });
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/begin',
        payload: { email: 'user@example.com' },
      });

      vi.mocked(queryOne)
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'user@example.com',
          name: 'Test User',
          avatar_url: null,
          email_verified: true,
        })
        .mockResolvedValueOnce({
          id: 'pk-1',
          credential_id: 'cred',
          public_key: Buffer.from([1]),
          sign_count: 0,
        });

      vi.mocked(verifyAuthenticationResponse).mockRejectedValueOnce(
        new Error('Invalid authenticator data structure'),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/complete',
        payload: {
          email: 'user@example.com',
          response: {
            id: 'cred',
            rawId: 'cred',
            response: { authenticatorData: 'bad', clientDataJSON: 'bad', signature: 'bad' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 401 when verifyAuthenticationResponse returns verified=false', async () => {
      const { queryOne } = await import('../database.js');
      const { verifyAuthenticationResponse } = await import('@simplewebauthn/server');

      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'user-1' });
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/begin',
        payload: { email: 'user@example.com' },
      });

      vi.mocked(queryOne)
        .mockResolvedValueOnce({
          id: 'user-1',
          email: 'user@example.com',
          name: 'Test User',
          avatar_url: null,
          email_verified: true,
        })
        .mockResolvedValueOnce({
          id: 'pk-row-1',
          credential_id: 'cred-verified-false',
          public_key: Buffer.from([1, 2, 3]),
          sign_count: 0,
        });

      vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
        verified: false,
        authenticationInfo: undefined,
      } as any);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/complete',
        payload: {
          email: 'user@example.com',
          response: {
            id: 'cred-verified-false',
            rawId: 'cred-verified-false',
            response: { authenticatorData: 'test', clientDataJSON: 'test', signature: 'test' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toBe('Authentication verification failed');
    });

    it('returns 401 when login/complete is called after login/begin with an unregistered email', async () => {
      const { queryOne } = await import('../database.js');

      // begin: user does not exist, but the challenge is still stored (no user enumeration)
      vi.mocked(queryOne).mockResolvedValueOnce(null);
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/begin',
        payload: { email: 'ghost-complete@example.com' },
      });

      // complete: challenge is consumed, user lookup returns null → 401 with generic error
      vi.mocked(queryOne).mockResolvedValueOnce(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/complete',
        payload: {
          email: 'ghost-complete@example.com',
          response: {
            id: 'any-cred',
            rawId: 'any-cred',
            response: { authenticatorData: 'a', clientDataJSON: 'a', signature: 'a' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(401);
      // Error must not reveal whether the email is registered
      expect(JSON.parse(res.body).error).toBe('Invalid credentials');
    });
  });

  // ── Challenge TTL expiry ──────────────────────────────────────────────────

  describe('Challenge TTL expiry', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns 400 when a registration challenge has expired', async () => {
      const { queryOne, query } = await import('../database.js');
      const { verifyRegistrationResponse } = await import('@simplewebauthn/server');

      // Populate the challenge via begin
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'user-1', email: 'user@example.com', name: 'Test User' });
      vi.mocked(query).mockResolvedValueOnce({ rows: [] } as any);
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/begin',
        headers: { authorization: 'Bearer valid-token' },
      });

      // Set up verification to succeed (ensures without TTL the route would return 200, not 400)
      vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
        verified: true,
        registrationInfo: {
          credential: { id: 'cred-id', publicKey: new Uint8Array([1, 2, 3]), counter: 0 },
          aaguid: null,
          credentialBackedUp: false,
        },
      } as any);

      // Advance time past the 5-minute TTL
      vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1000);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/register/complete',
        headers: { authorization: 'Bearer valid-token' },
        payload: {
          response: {
            id: 'cred-id',
            rawId: 'cred-id',
            response: { attestationObject: 'test', clientDataJSON: 'test' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('expired');
    });

    it('returns 400 when an authentication challenge has expired', async () => {
      const { queryOne } = await import('../database.js');

      // Populate the challenge via begin
      vi.mocked(queryOne).mockResolvedValueOnce({ id: 'user-1' });
      await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/begin',
        payload: { email: 'ttl-test@example.com' },
      });

      // Advance time past the 5-minute TTL
      vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1000);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/passkey/login/complete',
        payload: {
          email: 'ttl-test@example.com',
          response: {
            id: 'cred-id',
            rawId: 'cred-id',
            response: { authenticatorData: 'a', clientDataJSON: 'a', signature: 'a' },
            type: 'public-key',
          },
        },
      });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain('expired');
    });
  });

});
