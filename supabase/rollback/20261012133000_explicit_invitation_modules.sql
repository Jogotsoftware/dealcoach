-- Author only; do not apply in lane P0.
BEGIN;
CREATE OR REPLACE FUNCTION public.apply_invitation_module_access(p_invitation_id uuid, p_user_id uuid)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_modules jsonb; v_module_key text; v_module_id uuid; v_invited_by uuid; v_count integer := 0;
BEGIN
  SELECT modules, invited_by INTO v_modules, v_invited_by FROM invitations WHERE id = p_invitation_id;
  IF v_modules IS NULL THEN RETURN 0; END IF;  -- "NULL means inherit org defaults — no rows inserted"
  FOR v_module_key IN SELECT jsonb_array_elements_text(v_modules) LOOP
    SELECT id INTO v_module_id FROM modules WHERE module_key = v_module_key AND active = true;
    IF v_module_id IS NOT NULL THEN
      INSERT INTO user_module_access (user_id, module_id, granted_by) VALUES (p_user_id, v_module_id, v_invited_by) ON CONFLICT DO NOTHING;
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END; $function$;
COMMENT ON FUNCTION public.apply_invitation_module_access(uuid, uuid) IS NULL;
-- Retain registry labels: grants/references may have been created since apply.
-- Removing them without a full dependency inventory is not a safe rollback.
COMMIT;
