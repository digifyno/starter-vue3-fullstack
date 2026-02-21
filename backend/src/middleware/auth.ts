import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { JwtPayload } from '../types.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    userEmail?: string;
  }
}

function extractToken(request: FastifyRequest): string | null {
  const auth = request.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractToken(request);
  if (!token) {
    reply.status(401).send({ error: 'Authentication required' });
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    request.userId = payload.userId;
    request.userEmail = payload.email;
  } catch {
    reply.status(401).send({ error: 'Invalid or expired token' });
  }
}

export async function optionalAuth(request: FastifyRequest): Promise<void> {
  const token = extractToken(request);
  if (!token) return;

  try {
    const payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
    request.userId = payload.userId;
    request.userEmail = payload.email;
  } catch {
    // Ignore invalid tokens for optional auth
  }
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}
