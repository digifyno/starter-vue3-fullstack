import type { FastifyRequest, FastifyReply } from 'fastify';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';
import type { JwtPayload } from '../types.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    userEmail?: string;
  }
}

function extractToken(request: FastifyRequest): string | null {
  // Cookie takes precedence (httpOnly, not accessible to JS)
  const cookieToken = request.cookies?.token;
  if (cookieToken) return cookieToken;
  // Fallback: Authorization: Bearer header (for non-browser clients, existing tests)
  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function getSecret(): Uint8Array {
  return new TextEncoder().encode(config.jwtSecret);
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractToken(request);
  if (!token) {
    reply.status(401).send({ error: 'Authentication required' });
    return;
  }

  try {
    const { payload } = await jwtVerify(token, getSecret());
    request.userId = payload.userId as string;
    request.userEmail = payload.email as string;
  } catch {
    reply.status(401).send({ error: 'Invalid or expired token' });
  }
}

export async function optionalAuth(request: FastifyRequest): Promise<void> {
  const token = extractToken(request);
  if (!token) return;

  try {
    const { payload } = await jwtVerify(token, getSecret());
    request.userId = payload.userId as string;
    request.userEmail = payload.email as string;
  } catch {
    // Ignore invalid tokens for optional auth
  }
}

export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime(config.jwtExpiresIn)
    .sign(getSecret());
}
