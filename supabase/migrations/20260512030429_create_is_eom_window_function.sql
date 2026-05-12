-- Phase 1.11: returns true when today is in the last 5 days of the current month
CREATE OR REPLACE FUNCTION is_eom_window() RETURNS boolean AS $$
  SELECT CURRENT_DATE >= (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '5 days')::date;
$$ LANGUAGE sql STABLE;

GRANT EXECUTE ON FUNCTION is_eom_window() TO authenticated;
GRANT EXECUTE ON FUNCTION is_eom_window() TO service_role;
