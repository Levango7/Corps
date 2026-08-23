-- RLS initialization for multi-tenant isolation
-- This script runs once on first container startup

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
