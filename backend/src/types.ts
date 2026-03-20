export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  email_verified: boolean;
  settings: Record<string, unknown>;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OrgMembership {
  id: string;
  user_id: string;
  organization_id: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  invited_by: string | null;
  joined_at: string;
}

export interface Invitation {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  token: string;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface AuthPin {
  id: string;
  email: string;
  pin_hash: string;
  purpose: 'login' | 'verification';
  expires_at: string;
  used_at: string | null;
  attempts: number;
  created_at: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
}

export interface PasskeyCredential {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: Buffer;
  sign_count: number;
  aaguid: string | null;
  device_name: string | null;
  backed_up: boolean;
  created_at: Date;
  last_used_at: Date | null;
}

// Fastify decorator type augmentations for service layer DI
import type { OrganizationService } from './services/organization-service.js';
import type { UserService } from './services/user-service.js';
import type { InvitationService } from './services/invitation-service.js';

declare module 'fastify' {
  interface FastifyInstance {
    orgService: OrganizationService;
    userService: UserService;
    invitationService: InvitationService;
  }
}

export interface PasskeyDevice {
  id: string;
  deviceName: string | null;
  createdAt: string;
}
