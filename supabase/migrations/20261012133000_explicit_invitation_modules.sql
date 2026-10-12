-- Author only; do not apply in lane P0.
BEGIN;
-- Registry labels only: do not grant access or change plan/org membership.
INSERT INTO public.modules(module_key, module_name, active)
SELECT v.key, v.label, true FROM (VALUES ('deal_room', 'Deal Room'), ('scoping', 'Scoping')) v(key, label)
WHERE NOT EXISTS (SELECT 1 FROM public.modules m WHERE m.module_key = v.key);
CREATE OR REPLACE FUNCTION public.apply_invitation_module_access(p_invitation_id uuid, p_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_inv public.invitations%ROWTYPE; v_key text; v_id uuid; v_count integer := 0; v_rows integer;
BEGIN
  SELECT * INTO v_inv FROM public.invitations WHERE id = p_invitation_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  -- Unsupported invitations can never materialize DealCoach grants.
  IF v_inv.invitation_type IS NULL OR v_inv.invitation_type NOT IN ('teammate', 'new_instance')
     OR to_jsonb(v_inv)->>'target_app' = 'evaluation_room' THEN RETURN 0; END IF;
  -- Only the accepted recipient (or the service-backed signup) can materialize.
  IF (auth.uid() IS DISTINCT FROM p_user_id AND COALESCE(auth.role(), '') <> 'service_role')
     OR v_inv.status <> 'accepted'
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id AND lower(email) = lower(v_inv.email)) THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;
  -- Serialize grants for this recipient even across different invitations.
  PERFORM 1 FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  -- NULL means NO MODULES; it does not inherit organization defaults.
  IF v_inv.modules IS NULL OR jsonb_typeof(v_inv.modules) <> 'array' THEN RETURN 0; END IF;
  FOR v_key IN SELECT DISTINCT jsonb_array_elements_text(v_inv.modules) LOOP
    SELECT id INTO v_id FROM public.modules WHERE module_key = v_key AND active = true LIMIT 1;
    IF v_id IS NOT NULL THEN
      INSERT INTO public.user_module_access(id, user_id, module_id, granted_by)
      SELECT gen_random_uuid(), p_user_id, v_id, v_inv.invited_by
      WHERE NOT EXISTS (SELECT 1 FROM public.user_module_access WHERE user_id = p_user_id AND module_id = v_id)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_count := v_count + v_rows;
    END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
ALTER FUNCTION public.apply_invitation_module_access(uuid, uuid) OWNER TO postgres;
COMMENT ON FUNCTION public.apply_invitation_module_access(uuid, uuid) IS 'Explicit invitation module grants only. NULL or [] means no modules, never inherit org defaults.';
COMMIT;
