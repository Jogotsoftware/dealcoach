-- Author only; do not apply in lane P0.
BEGIN;
ALTER VIEW public.deal_open_barriers_v RESET (security_invoker);
ALTER VIEW public.deal_extractions_with_source RESET (security_invoker);
ALTER VIEW public.deal_latest_snapshot RESET (security_invoker);
-- Restores the broad grants recorded in the 2026-10-12 snapshot; security regression.
DO $$ DECLARE v record; BEGIN
  FOR v IN SELECT schemaname, viewname FROM pg_catalog.pg_views WHERE schemaname = 'public' LOOP
    EXECUTE format('GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE %I.%I TO anon, authenticated', v.schemaname, v.viewname);
  END LOOP;
END $$;
COMMIT;
