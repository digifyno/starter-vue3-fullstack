-- Enable Row-Level Security on tenant-scoped tables.
--
-- NOTE: FORCE ROW LEVEL SECURITY is intentionally omitted. The application connects
-- as the table owner (rsi), which bypasses policies by default. For full RLS
-- enforcement, create a dedicated non-owner application role and enable FORCE RLS.
-- These policies protect any additional roles added in the future and establish
-- the correct isolation framework.
--
-- The queryWithContext() helper in database.ts sets app.current_user_id /
-- app.current_org_id session variables, allowing route handlers to explicitly
-- opt into policy-enforced queries today (and ready for full FORCE RLS later).

-- Enable RLS on tenant-scoped tables
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- org_memberships: user sees only memberships for orgs they belong to.
-- current_setting with missing_ok=true returns NULL when the variable is unset,
-- so NULL::uuid matches nothing — an empty result rather than an error.
CREATE POLICY org_memberships_isolation ON org_memberships
  FOR SELECT
  USING (
    organization_id IN (
      SELECT organization_id
      FROM org_memberships AS m
      WHERE m.user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- organizations: user sees only orgs they are a member of.
CREATE POLICY organizations_isolation ON organizations
  FOR SELECT
  USING (
    id IN (
      SELECT organization_id
      FROM org_memberships
      WHERE user_id = current_setting('app.current_user_id', true)::uuid
    )
  );

-- invitations: visible only within an explicit org context.
CREATE POLICY invitations_org_isolation ON invitations
  FOR SELECT
  USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
  );
