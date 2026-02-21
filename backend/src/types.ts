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
