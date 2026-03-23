import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { healthRoutes } from './health.js';

const mockQuery = vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] });
const mockGenerateAuthenticationOptions = vi.fn();

vi.mock("../database.js", () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
  query: vi.fn().mockResolvedValue({ rows: [] } as any),
  queryOne: vi.fn().mockResolvedValue(null),
}));

vi.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: mockGenerateAuthenticationOptions,
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
}));

describe("Health Routes - passkey field", () => {
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(healthRoutes);
    await app.ready();
  });

  afterAll(() => app.close());
  beforeEach(() => vi.clearAllMocks());

  it("includes passkey: true when passkey check passes", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
    mockGenerateAuthenticationOptions.mockResolvedValueOnce({ challenge: "test-challenge" });

    const res = await app.inject({ method: "GET", url: "/api/health" });
    const body = JSON.parse(res.body);

    expect(body.passkey).toBe(true);
    expect(body.passkeyError).toBeUndefined();
  });

  it("includes passkey: false and passkeyError when passkey library throws", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
    mockGenerateAuthenticationOptions.mockRejectedValueOnce(new Error("WebAuthn library unavailable"));

    const res = await app.inject({ method: "GET", url: "/api/health" });
    const body = JSON.parse(res.body);

    expect(body.passkey).toBe(false);
    expect(body.passkeyError).toBe("WebAuthn library unavailable");
  });

  it("returns degraded status when passkey fails even if database is reachable", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
    mockGenerateAuthenticationOptions.mockRejectedValueOnce(new Error("passkey failure"));

    const res = await app.inject({ method: "GET", url: "/api/health" });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe("degraded");
    expect(body.database).toBe(true);
    expect(body.passkey).toBe(false);
  });

  it("returns degraded when challenge generation returns no challenge", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ "?column?": 1 }] });
    mockGenerateAuthenticationOptions.mockResolvedValueOnce({ challenge: "" });

    const res = await app.inject({ method: "GET", url: "/api/health" });
    const body = JSON.parse(res.body);

    expect(body.status).toBe("degraded");
    expect(body.passkey).toBe(false);
    expect(body.passkeyError).toBe("challenge generation failed");
  });

  it("returns degraded when both database and passkey fail", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    mockGenerateAuthenticationOptions.mockRejectedValueOnce(new Error("passkey error"));

    const res = await app.inject({ method: "GET", url: "/api/health" });
    const body = JSON.parse(res.body);

    expect(body.status).toBe("degraded");
    expect(body.database).toBe(false);
    expect(body.passkey).toBe(false);
  });
});
