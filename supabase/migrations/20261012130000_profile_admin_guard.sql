-- Author only. Schema: lead's 2026-10-12 p0.schema.md.
BEGIN;
CREATE OR REPLACE FUNCTION public.guard_profile_admin_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF (NEW.org_id, NEW.role, NEW.access_mode, NEW.module_access, NEW.beta_features)
     IS DISTINCT FROM
     (OLD.org_id, OLD.role, OLD.access_mode, OLD.module_access, OLD.beta_features)
     AND current_user NOT IN ('postgres', 'supabase_admin', 'service_role')
     AND NOT COALESCE(public.is_platform_admin(), false)
     AND current_setting('app.allow_profile_admin_change', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION 'Administrative profile fields require an authorized RPC' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_profile_admin_fields ON public.profiles;
CREATE TRIGGER trg_guard_profile_admin_fields BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_admin_fields();

CREATE OR REPLACE FUNCTION public.set_member_role(p_user_id uuid, p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_before public.profiles%ROWTYPE;
  v_flag text := current_setting('app.allow_profile_admin_change', true);
  v_actor_role text := (SELECT role FROM public.profiles WHERE id = auth.uid());
BEGIN
  IF p_role IS NULL OR p_role NOT IN ('admin', 'manager', 'rep', 'bdr', 'sc') THEN
    RAISE EXCEPTION 'Invalid member role' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_before FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0002'; END IF;
  IF auth.uid() IS NULL OR NOT (COALESCE(public.is_platform_admin(), false)
      OR COALESCE(public.is_org_admin(v_before.org_id), false)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.allow_profile_admin_change', 'on', true);
  UPDATE public.profiles SET role = p_role WHERE id = p_user_id;
  PERFORM set_config('app.allow_profile_admin_change', COALESCE(v_flag, ''), true);
  INSERT INTO public.audit_log(org_id, actor_id, actor_role, action, entity_table, entity_id, before_state, after_state)
  VALUES (v_before.org_id, auth.uid(), v_actor_role,
    'set_member_role', 'profiles', p_user_id, jsonb_build_object('role', v_before.role), jsonb_build_object('role', p_role));
END;
$$;
ALTER FUNCTION public.set_member_role(uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_role(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_member(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_before public.profiles%ROWTYPE;
  v_flag text := current_setting('app.allow_profile_admin_change', true);
  v_actor_role text := (SELECT role FROM public.profiles WHERE id = auth.uid());
BEGIN
  SELECT * INTO v_before FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0002'; END IF;
  IF auth.uid() IS NULL OR NOT (COALESCE(public.is_platform_admin(), false)
      OR COALESCE(public.is_org_admin(v_before.org_id), false)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.allow_profile_admin_change', 'on', true);
  UPDATE public.profiles SET org_id = NULL, role = 'rep' WHERE id = p_user_id;
  PERFORM set_config('app.allow_profile_admin_change', COALESCE(v_flag, ''), true);
  INSERT INTO public.audit_log(org_id, actor_id, actor_role, action, entity_table, entity_id, before_state, after_state)
  VALUES (v_before.org_id, auth.uid(), v_actor_role,
    'remove_member', 'profiles', p_user_id,
    jsonb_build_object('org_id', v_before.org_id, 'role', v_before.role), jsonb_build_object('org_id', NULL, 'role', 'rep'));
END;
$$;
ALTER FUNCTION public.remove_member(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.remove_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_member(uuid) TO authenticated;
-- Preserve the platform console's atomic organization/role/access-mode editor.
CREATE OR REPLACE FUNCTION public.set_member_admin_fields(p_user_id uuid, p_role text, p_org_id uuid, p_access_mode text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_before public.profiles%ROWTYPE; v_flag text := current_setting('app.allow_profile_admin_change', true);
  v_actor_role text := (SELECT role FROM public.profiles WHERE id = auth.uid());
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_platform_admin(), false) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_before FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0002'; END IF;
  IF p_role IS NULL OR (p_role NOT IN ('admin', 'manager', 'rep', 'bdr', 'sc')
     AND NOT (p_role = 'system_admin' AND v_before.role = 'system_admin'))
     OR p_access_mode IS NULL OR p_access_mode NOT IN ('full', 'dealroom_only') THEN
    RAISE EXCEPTION 'Invalid role or access mode' USING ERRCODE = '22023';
  END IF;
  IF p_access_mode <> 'full' AND EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'Platform admins require full access' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.allow_profile_admin_change', 'on', true);
  UPDATE public.profiles SET role = p_role, org_id = p_org_id, access_mode = p_access_mode WHERE id = p_user_id;
  PERFORM set_config('app.allow_profile_admin_change', COALESCE(v_flag, ''), true);
  INSERT INTO public.audit_log(org_id, actor_id, actor_role, action, entity_table, entity_id, before_state, after_state)
  VALUES (v_before.org_id, auth.uid(), v_actor_role,
    'set_member_admin_fields', 'profiles', p_user_id,
    jsonb_build_object('org_id', v_before.org_id, 'role', v_before.role, 'access_mode', v_before.access_mode),
    jsonb_build_object('org_id', p_org_id, 'role', p_role, 'access_mode', p_access_mode));
END;
$$;
ALTER FUNCTION public.set_member_admin_fields(uuid, text, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_admin_fields(uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_admin_fields(uuid, text, uuid, text) TO authenticated;
COMMIT;
