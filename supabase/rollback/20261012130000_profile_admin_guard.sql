BEGIN;
DROP TRIGGER IF EXISTS trg_guard_profile_admin_fields ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_profile_admin_fields();
DROP FUNCTION IF EXISTS public.set_member_role(uuid, text);
DROP FUNCTION IF EXISTS public.remove_member(uuid);
-- Audit history deliberately retained.
DROP FUNCTION IF EXISTS public.set_member_admin_fields(uuid, text, uuid, text);
COMMIT;
