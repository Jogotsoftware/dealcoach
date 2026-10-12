-- Author only; do not apply in lane P0.
BEGIN;
DROP POLICY IF EXISTS p0_deal_documents_org_fence ON storage.objects;
DROP FUNCTION IF EXISTS public.storage_deal_in_caller_org(uuid);
COMMIT;
