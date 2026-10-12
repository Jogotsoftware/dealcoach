-- Author only; do not apply in lane P0.
BEGIN;
CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text, p_user_id uuid)
 RETURNS TABLE(success boolean, invitation_type text, org_id uuid, role text, message text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_invitation invitations%ROWTYPE; v_user_email text;
BEGIN
  SELECT email INTO v_user_email FROM auth.users WHERE id = p_user_id;
  IF v_user_email IS NULL THEN RETURN QUERY SELECT false, NULL::text, NULL::uuid, NULL::text, 'User not found or not authenticated'::text; RETURN; END IF;
  SELECT * INTO v_invitation FROM invitations WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN QUERY SELECT false, NULL::text, NULL::uuid, NULL::text, 'Invitation not found'::text; RETURN; END IF;
  -- to_jsonb safely reads an optional target_app without requiring the column.
  IF v_invitation.invitation_type IS NULL OR v_invitation.invitation_type NOT IN ('teammate', 'new_instance')
     OR to_jsonb(v_invitation)->>'target_app' = 'evaluation_room' THEN
    RETURN QUERY SELECT false, NULL::text, NULL::uuid, NULL::text, 'This invitation cannot be accepted here.'::text; RETURN;
  END IF;
  IF auth.uid() IS DISTINCT FROM p_user_id AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN QUERY SELECT false, NULL::text, NULL::uuid, NULL::text, 'This invitation cannot be accepted here.'::text; RETURN;
  END IF;
  IF LOWER(v_user_email) <> LOWER(v_invitation.email) THEN RETURN QUERY SELECT false, v_invitation.invitation_type, v_invitation.org_id, v_invitation.role, 'This invitation is for a different email address. Please sign in with ' || v_invitation.email; RETURN; END IF;
  IF v_invitation.expires_at < NOW() THEN RETURN QUERY SELECT false, v_invitation.invitation_type, v_invitation.org_id, v_invitation.role, 'This invitation has expired. Please request a new invitation.'::text; RETURN; END IF;
  IF v_invitation.status = 'accepted' THEN RETURN QUERY SELECT true, v_invitation.invitation_type, v_invitation.org_id, v_invitation.role, 'Invitation already accepted'::text; RETURN; END IF;
  IF v_invitation.status = 'revoked' THEN RETURN QUERY SELECT false, v_invitation.invitation_type, v_invitation.org_id, v_invitation.role, 'This invitation has been revoked.'::text; RETURN; END IF;
  IF v_invitation.invitation_type = 'teammate' THEN UPDATE profiles SET org_id = v_invitation.org_id, role = v_invitation.role, updated_at = NOW() WHERE id = p_user_id; END IF;
  UPDATE invitations SET status = 'accepted', accepted_at = NOW() WHERE id = v_invitation.id;
  RETURN QUERY SELECT true, v_invitation.invitation_type, v_invitation.org_id, v_invitation.role, 'Invitation accepted'::text;
END; $function$;
CREATE OR REPLACE FUNCTION public.get_invitation_by_token(p_token text)
 RETURNS TABLE(id uuid, email text, token text, role text, invitation_type text, org_id uuid, org_name text, status text, expires_at timestamptz, accepted_at timestamptz, invited_name text, personal_message text, inviter_name text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT i.id, i.email, i.token, i.role, i.invitation_type, i.org_id, o.name, i.status, i.expires_at, i.accepted_at, i.invited_name, i.personal_message, p.full_name
  FROM invitations i LEFT JOIN organizations o ON o.id = i.org_id LEFT JOIN profiles p ON p.id = i.invited_by WHERE i.token = p_token AND i.invitation_type IN ('teammate', 'new_instance') AND (to_jsonb(i)->>'target_app') IS DISTINCT FROM 'evaluation_room' LIMIT 1;
$function$;
COMMIT;
