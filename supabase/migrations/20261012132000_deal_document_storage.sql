-- Author only; do not apply in lane P0.
BEGIN;
CREATE OR REPLACE FUNCTION public.storage_deal_in_caller_org(p_deal uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.deals d JOIN public.profiles p ON p.org_id = d.org_id
    WHERE d.id = p_deal AND p.id = auth.uid() AND p.org_id IS NOT NULL
  );
$$;
ALTER FUNCTION public.storage_deal_in_caller_org(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.storage_deal_in_caller_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.storage_deal_in_caller_org(uuid) TO authenticated;
DROP POLICY IF EXISTS p0_deal_documents_org_fence ON storage.objects;
CREATE POLICY p0_deal_documents_org_fence ON storage.objects AS RESTRICTIVE
FOR ALL TO authenticated
USING (
  CASE WHEN bucket_id <> 'deal-documents' THEN true
       WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       THEN public.storage_deal_in_caller_org(split_part(name, '/', 1)::uuid)
       ELSE false END
)
WITH CHECK (
  CASE WHEN bucket_id <> 'deal-documents' THEN true
       WHEN split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       THEN public.storage_deal_in_caller_org(split_part(name, '/', 1)::uuid)
       ELSE false END
);
-- deal-room-library: path shape unknown; see docs/P0-VERIFICATION.md re-pathing plan.
COMMIT;
