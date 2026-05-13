-- v2 of apply_org_default_access_mode: exclude platform admins. Platform
-- admins manage the system and must retain full access regardless of which
-- org they're nominally a member of (e.g. when joe.pacheco@sage.com lives
-- in Intacct - Direct - NA but needs the Super Admin nav for support).

CREATE OR REPLACE FUNCTION public.apply_org_default_access_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default TEXT;
  v_is_platform_admin BOOLEAN;
BEGIN
  -- Skip if access_mode was set explicitly, no org, or BDR role.
  IF NEW.access_mode <> 'full' OR NEW.org_id IS NULL OR COALESCE(NEW.role, 'rep') = 'bdr' THEN
    RETURN NEW;
  END IF;

  -- Skip platform admins — they need full access for support / debugging
  -- regardless of which org they live in.
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = NEW.id) INTO v_is_platform_admin;
  IF v_is_platform_admin THEN
    RETURN NEW;
  END IF;

  SELECT default_access_mode INTO v_default FROM organizations WHERE id = NEW.org_id;
  IF v_default = 'dealroom_only' THEN
    NEW.access_mode := 'dealroom_only';
  END IF;
  RETURN NEW;
END
$$;

-- Backfill: any platform admin who got swept into dealroom_only by a prior
-- bulk update gets restored to full.
UPDATE profiles
  SET access_mode = 'full'
  WHERE id IN (SELECT user_id FROM platform_admins)
    AND access_mode = 'dealroom_only';
