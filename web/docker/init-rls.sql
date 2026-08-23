-- RLS initialization for local docker dev
-- NOTE: this file runs on FIRST container startup, BEFORE any tables exist
-- (Prisma db push / migrate creates them later). RLS policies therefore live in
-- ../../db/schema.sql and must be applied AFTER schema creation when hardening
-- production (see its ACTIVATION section). The helpers below are kept for
-- psql debugging convenience only — application code calls set_config() directly.

CREATE SCHEMA IF NOT EXISTS app;

-- Set application-level workspace context
CREATE OR REPLACE FUNCTION app.set_workspace_id(wid uuid)
RETURNS void AS $$
BEGIN
  SET LOCAL app.workspace_id = wid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verify current workspace (for debugging)
CREATE OR REPLACE FUNCTION app.get_workspace_id()
RETURNS uuid AS $$
BEGIN
  RETURN current_setting('app.workspace_id', true)::uuid;
EXCEPTION WHEN others THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

