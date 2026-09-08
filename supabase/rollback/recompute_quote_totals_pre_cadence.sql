-- Rollback artifact: public.recompute_quote_totals as it stood before
-- 20260908130000_billing_cadence_quarterly_then_annual.sql (captured from
-- pg_get_functiondef on 2026-09-08). Rolls the whole year-1 figure, percent
-- surcharges included, across the term.
CREATE OR REPLACE FUNCTION public.recompute_quote_totals(p_quote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_quote record;
  v_term public.contract_terms%ROWTYPE;
  v_y1_subscription numeric := 0;
  v_y1_percent numeric := 0;
  v_yoy_subscription_sum numeric := 0;
  v_yoy_percent_sum numeric := 0;
  v_year_idx integer;
  v_year_subscription numeric;
  v_year_percent numeric;
  v_signing_bonus numeric := 0;
  v_sage_impl numeric := 0;
  v_partner_subs numeric := 0;
  v_partner_impl numeric := 0;
  v_sage_total numeric;
  v_partner_total numeric;
BEGIN
  SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'quote not found');
  END IF;

  -- Y1 subscription = sage_subscription_total minus percent surcharges
  -- (we stored net_total which includes percents; pull them apart)
  v_y1_subscription := COALESCE(v_quote.sage_subscription_total, 0) - COALESCE(v_quote.percent_lines_total, 0);
  v_y1_percent := COALESCE(v_quote.percent_lines_total, 0);

  -- Roll Sage subscription across the term applying YoY caps
  v_yoy_subscription_sum := 0;
  v_yoy_percent_sum := 0;

  IF v_quote.contract_term_id IS NOT NULL THEN
    SELECT * INTO v_term FROM public.contract_terms WHERE id = v_quote.contract_term_id;
    
    v_year_subscription := v_y1_subscription;
    v_year_percent := v_y1_percent;
    
    FOR v_year_idx IN 1..v_term.term_years LOOP
      IF v_year_idx > 1 THEN
        v_year_subscription := ROUND(v_year_subscription * (1 + v_term.yoy_caps[v_year_idx]), 2);
        -- percent surcharge scales with subscription base
        v_year_percent := CASE WHEN v_y1_subscription > 0 
                          THEN ROUND(v_y1_percent * (v_year_subscription / v_y1_subscription), 2)
                          ELSE 0 END;
      END IF;
      v_yoy_subscription_sum := v_yoy_subscription_sum + v_year_subscription;
      v_yoy_percent_sum := v_yoy_percent_sum + v_year_percent;
    END LOOP;
  ELSE
    -- No term selected yet: just count Y1
    v_yoy_subscription_sum := v_y1_subscription;
    v_yoy_percent_sum := v_y1_percent;
  END IF;

  -- Compute signing bonus actual amount
  IF v_quote.signing_bonus_amount > 0 THEN
    v_signing_bonus := v_quote.signing_bonus_amount;
  ELSIF v_quote.signing_bonus_months > 0 AND v_y1_subscription > 0 THEN
    -- months × (annual / 12)
    v_signing_bonus := ROUND(v_quote.signing_bonus_months * (v_y1_subscription / 12.0), 2);
  ELSE
    v_signing_bonus := 0;
  END IF;

  -- Sage implementation total
  SELECT COALESCE(SUM(total_amount), 0) INTO v_sage_impl
  FROM public.quote_implementation_items
  WHERE quote_id = p_quote_id AND source = 'sage';

  -- Partner subscription total: sum of partner lines × their block term_years
  SELECT COALESCE(SUM(pl.extended * b.term_years), 0) INTO v_partner_subs
  FROM public.quote_partner_lines pl
  JOIN public.quote_partner_blocks b ON b.id = pl.block_id
  WHERE pl.quote_id = p_quote_id;

  -- Partner implementation total
  SELECT COALESCE(SUM(total_amount), 0) INTO v_partner_impl
  FROM public.quote_implementation_items
  WHERE quote_id = p_quote_id AND source = 'partner';

  v_sage_total := v_yoy_subscription_sum + v_yoy_percent_sum + v_sage_impl - v_signing_bonus;
  v_partner_total := v_partner_subs + v_partner_impl;

  UPDATE public.quotes
  SET sage_implementation_total = v_sage_impl,
      sage_total = v_sage_total,
      partner_subscription_total = v_partner_subs,
      partner_implementation_total = v_partner_impl,
      partner_total = v_partner_total,
      solution_total = v_sage_total + v_partner_total,
      updated_at = now()
  WHERE id = p_quote_id;

  RETURN jsonb_build_object(
    'sage_subscription_y1', v_y1_subscription,
    'sage_subscription_tcv', v_yoy_subscription_sum,
    'sage_percent_surcharges_tcv', v_yoy_percent_sum,
    'sage_implementation_total', v_sage_impl,
    'signing_bonus', v_signing_bonus,
    'sage_total', v_sage_total,
    'partner_subscription_total', v_partner_subs,
    'partner_implementation_total', v_partner_impl,
    'partner_total', v_partner_total,
    'solution_total', v_sage_total + v_partner_total
  );
END;
$function$;
