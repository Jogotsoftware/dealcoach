-- Author only; do not apply in lane P0.
BEGIN;
ALTER VIEW public.deal_open_barriers_v SET (security_invoker = true);
ALTER VIEW public.deal_extractions_with_source SET (security_invoker = true);
ALTER VIEW public.deal_latest_snapshot SET (security_invoker = true);
-- Keep bdr_my_lead_status's caller-filtered bypass; remove only write grants.
DO $$ DECLARE v record; BEGIN
  FOR v IN SELECT schemaname, viewname FROM pg_catalog.pg_views WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE %I.%I FROM anon, authenticated', v.schemaname, v.viewname);
  END LOOP;
END $$;
COMMIT;
