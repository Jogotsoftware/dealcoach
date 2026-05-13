-- Per-org default for profiles.access_mode. When a new profile is created with
-- access_mode='full' (the column default) AND the org's default_access_mode is
-- 'dealroom_only', a BEFORE INSERT trigger promotes the new profile to
-- 'dealroom_only'. Per-user overrides still work via direct UPDATE.
--
-- BDR-role users are excluded — they have their own role-based restriction and
-- need to reach /bdr/* routes that aren't in the dealroom_only allow-list.

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS default_access_mode TEXT NOT NULL DEFAULT 'full';

ALTER TABLE organizations
  DROP CONSTRAINT IF EXISTS organizations_default_access_mode_check;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_default_access_mode_check
  CHECK (default_access_mode IN ('full', 'dealroom_only'));

COMMENT ON COLUMN organizations.default_access_mode IS
  'Default value for profiles.access_mode when a new profile is created in this org. Set to ''dealroom_only'' to make this an AE-pilot org where every new user is restricted to pipeline + deal room. Per-user overrides via profiles.access_mode still work.';

CREATE OR REPLACE FUNCTION public.apply_org_default_access_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default TEXT;
BEGIN
  -- Only act when access_mode is the column default ('full') AND the user
  -- isn't a BDR (BDRs need their own role-based nav, not dealroom_only).
  IF NEW.access_mode = 'full' AND NEW.org_id IS NOT NULL AND COALESCE(NEW.role, 'rep') <> 'bdr' THEN
    SELECT default_access_mode INTO v_default FROM organizations WHERE id = NEW.org_id;
    IF v_default = 'dealroom_only' THEN
      NEW.access_mode := 'dealroom_only';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_apply_org_default_access_mode ON profiles;

CREATE TRIGGER trg_apply_org_default_access_mode
  BEFORE INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_org_default_access_mode();
