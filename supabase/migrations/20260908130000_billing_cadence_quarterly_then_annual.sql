-- Billing cadence "quarterly_then_annual" (2026-09-08): quarterly invoices in
-- the first contract year, one annual invoice for each year after.
--
-- Three functions learn the rule; two columns carry the one number the deal
-- room cannot work out for itself.
--
--   quotes.finance_charges_total / finance_charges_list
--     Net and pre-discount basis of root lines whose product_type is
--     'Finance Charges' (the quarterly payment surcharge SKUs). Written by
--     compute_quote (v13). A finance charge recurs in later years ONLY when
--     billing_cadence = 'quarterly'; under quarterly_then_annual (and annual)
--     it is a first-year cost, which is what the "First Year of Contract Only"
--     SKU has always said.
--
--   recompute_quote_totals (v2)
--     Rolls (year-1 subscription minus first-year-only charges) across the
--     term instead of rolling the whole year-1 figure.
--
--   generate_payment_schedule (v2)
--     - quarterly_then_annual: 4 invoices in year 1, 1 per year after.
--     - Year starts are counted forward from the contract start (year 2 also
--       skips back-placed free months). The old MAX(period_start) + 12 months
--       lookup measured from the LAST quarterly invoice, so year 3 of a
--       quarterly quote began nine months late (Atlanta Scales: Y2 Q4 on
--       2028-10-30, Y3 Q1 on 2029-10-30).
--     - The signing bonus is drawn down across the year-1 invoices in order
--       instead of being subtracted from the first one, which produced a
--       negative invoice (Atlanta Scales: Y1 Q1 = -$20,299.25).
--     - First-year-only finance charges are billed in year 1 and not rolled.
--
-- Rollback for the functions: supabase/rollback/*_pre_cadence.sql.

ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_billing_cadence_check;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_billing_cadence_check
  CHECK (billing_cadence = ANY (ARRAY['annual'::text, 'quarterly'::text, 'quarterly_then_annual'::text]));

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS finance_charges_total numeric NOT NULL DEFAULT 0;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS finance_charges_list numeric NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.quotes.finance_charges_total IS 'Net (extended) of root lines whose product_type = Finance Charges, e.g. the quarterly payment surcharge. Written by compute_quote. Recurs in later years only when billing_cadence = quarterly.';
COMMENT ON COLUMN public.quotes.finance_charges_list IS 'Pre-discount basis (extended + discount_amount) of the same Finance Charges lines. Written by compute_quote.';

-- ─── compute_quote v13 = v12 + finance charge totals ─────────────────────
CREATE OR REPLACE FUNCTION public.compute_quote(p_quote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_max_iter constant int := 20;
  v_tolerance constant numeric := 0.01;
  v_iter int := 0;
  v_max_delta numeric;
  v_converged boolean := false;
  v_warning text := null;
  v_list_subtotal numeric := 0;
  v_discount_total numeric := 0;
  v_percent_total numeric := 0;
  v_net_total numeric := 0;
  v_fin_total numeric := 0;
  v_fin_list numeric := 0;
  v_global_discount numeric := 0;
  v_blended_num numeric := 0;
  v_blended_den numeric := 0;
  v_blended_pct numeric := 0;
  r record;
  v_base numeric;
  v_new_ext numeric;
  v_delta numeric;
BEGIN
  SELECT COALESCE(global_discount_pct, 0) INTO v_global_discount
  FROM public.quotes WHERE id = p_quote_id;

  CREATE TEMP TABLE _wq (
    line_id uuid PRIMARY KEY,
    product_id uuid,
    parent_line_id uuid,
    is_bundle_child boolean,
    quantity numeric,
    unit_price numeric,
    list_price numeric,
    line_discount_pct numeric,
    effective_discount_pct numeric,
    pricing_method text,
    percentage_value numeric,
    percent_base_type text,
    percent_base_includes_types text[],
    excluded_from_percent_base boolean,
    non_discountable boolean,
    is_entity boolean,
    product_type text,
    extended numeric,
    discount_amount numeric,
    is_percent boolean
  ) ON COMMIT DROP;

  INSERT INTO _wq
  SELECT
    ql.id, ql.product_id, ql.parent_line_id,
    (ql.parent_line_id IS NOT NULL),
    ql.quantity,
    COALESCE(ov.pinned, ql.unit_price),
    COALESCE(ov.pinned, p.list_price),
    ql.discount_pct,
    CASE
      WHEN ql.parent_line_id IS NOT NULL THEN 0
      WHEN COALESCE(p.non_discountable, false) THEN 0
      WHEN COALESCE(ql.discount_pct, 0) > 0 THEN ql.discount_pct
      WHEN ql.apply_global_discount = true THEN v_global_discount
      WHEN ql.apply_global_discount = false THEN 0
      WHEN COALESCE(p.excluded_from_global_discount, false) THEN 0
      ELSE v_global_discount
    END,
    p.pricing_method,
    COALESCE(p.percentage_value, 0),
    p.percent_base_type,
    COALESCE(p.percent_base_includes_types, '{}'::text[]),
    (COALESCE(p.excluded_from_percent_base, false) OR ql.parent_line_id IS NOT NULL),
    COALESCE(p.non_discountable, false),
    COALESCE(p.is_entity, false),
    p.product_type,
    0::numeric,
    0::numeric,
    (p.pricing_method = 'percent_of_total' AND ql.parent_line_id IS NULL AND ov.pinned IS NULL)
  FROM public.quote_lines ql
  JOIN public.products p ON p.id = ql.product_id
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN p.pricing_method = 'percent_of_total'
       AND ql.parent_line_id IS NULL
       AND (ql.custom_fields->>'price_override') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN (ql.custom_fields->>'price_override')::numeric
    END AS pinned
  ) ov
  WHERE ql.quote_id = p_quote_id;

  UPDATE _wq SET extended = 0, discount_amount = 0 WHERE is_bundle_child;

  UPDATE _wq
  SET extended = ROUND(quantity * unit_price * (1 - effective_discount_pct), 2),
      discount_amount = ROUND(quantity * unit_price * effective_discount_pct, 2)
  WHERE NOT is_percent AND NOT is_bundle_child;

  FOR r IN SELECT * FROM _wq WHERE is_percent AND COALESCE(percent_base_type, 'list') = 'list' LOOP
    SELECT COALESCE(SUM(o.quantity * o.list_price), 0) INTO v_base
    FROM _wq o
    WHERE o.line_id <> r.line_id AND NOT o.excluded_from_percent_base AND NOT o.is_percent
      AND (
        array_length(r.percent_base_includes_types, 1) IS NULL
        OR r.percent_base_includes_types = '{}'::text[]
        OR o.product_type = ANY(r.percent_base_includes_types)
      );
    UPDATE _wq
    SET extended = ROUND(v_base * r.percentage_value * (1 - r.effective_discount_pct), 2),
        discount_amount = ROUND(v_base * r.percentage_value * r.effective_discount_pct, 2)
    WHERE line_id = r.line_id;
  END LOOP;

  LOOP
    v_iter := v_iter + 1;
    v_max_delta := 0;
    FOR r IN SELECT * FROM _wq WHERE is_percent AND percent_base_type = 'net' LOOP
      SELECT COALESCE(SUM(o.extended), 0) INTO v_base
      FROM _wq o
      WHERE o.line_id <> r.line_id AND NOT o.excluded_from_percent_base
        AND (
          array_length(r.percent_base_includes_types, 1) IS NULL
          OR r.percent_base_includes_types = '{}'::text[]
          OR o.product_type = ANY(r.percent_base_includes_types)
        );
      v_new_ext := ROUND(v_base * r.percentage_value * (1 - r.effective_discount_pct), 2);
      SELECT extended INTO v_delta FROM _wq WHERE line_id = r.line_id;
      v_delta := abs(v_new_ext - v_delta);
      IF v_delta > v_max_delta THEN v_max_delta := v_delta; END IF;
      UPDATE _wq
      SET extended = v_new_ext,
          discount_amount = ROUND(v_base * r.percentage_value * r.effective_discount_pct, 2)
      WHERE line_id = r.line_id;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM _wq WHERE is_percent AND percent_base_type = 'net') THEN
      v_converged := true; EXIT;
    END IF;
    IF v_max_delta < v_tolerance THEN v_converged := true; EXIT; END IF;
    IF v_iter >= v_max_iter THEN
      v_warning := format('v13: Quote did not converge after %s iterations', v_max_iter);
      EXIT;
    END IF;
  END LOOP;

  UPDATE public.quote_lines ql
  SET extended = w.extended,
      discount_amount = w.discount_amount,
      effective_discount_pct = w.effective_discount_pct,
      updated_at = now()
  FROM _wq w
  WHERE ql.id = w.line_id;

  SELECT
    COALESCE(SUM(CASE WHEN NOT is_percent AND NOT is_bundle_child THEN list_price * quantity ELSE 0 END), 0),
    COALESCE(SUM(discount_amount), 0),
    COALESCE(SUM(CASE WHEN is_percent THEN extended ELSE 0 END), 0),
    COALESCE(SUM(extended), 0)
  INTO v_list_subtotal, v_discount_total, v_percent_total, v_net_total
  FROM _wq;

  -- Finance charges (the quarterly payment surcharge): kept apart so the
  -- term roll-up and the schedule can bill them in year 1 only when the
  -- cadence says so.
  SELECT COALESCE(SUM(extended), 0), COALESCE(SUM(extended + discount_amount), 0)
  INTO v_fin_total, v_fin_list
  FROM _wq WHERE NOT is_bundle_child AND product_type = 'Finance Charges';

  SELECT
    COALESCE(SUM(discount_amount), 0),
    COALESCE(SUM(
      CASE
        WHEN is_bundle_child THEN 0
        WHEN is_percent THEN extended + discount_amount
        ELSE list_price * quantity
      END
    ), 0)
  INTO v_blended_num, v_blended_den
  FROM _wq
  WHERE NOT is_entity AND NOT is_bundle_child;

  v_blended_pct := CASE WHEN v_blended_den > 0
                        THEN ROUND(v_blended_num / v_blended_den, 6)
                        ELSE 0 END;

  UPDATE public.quotes
  SET list_subtotal = ROUND(v_list_subtotal, 2),
      discount_total = ROUND(v_discount_total, 2),
      percent_lines_total = ROUND(v_percent_total, 2),
      net_total = ROUND(v_net_total, 2),
      sage_subscription_total = ROUND(v_net_total, 2),
      finance_charges_total = ROUND(v_fin_total, 2),
      finance_charges_list = ROUND(v_fin_list, 2),
      blended_discount_pct = v_blended_pct,
      compute_warning = v_warning,
      updated_at = now()
  WHERE id = p_quote_id;

  PERFORM public.recompute_quote_totals(p_quote_id);

  RETURN jsonb_build_object(
    'converged', v_converged,
    'iterations', v_iter,
    'warning', v_warning,
    'version', 'v13',
    'totals', jsonb_build_object(
      'list_subtotal', ROUND(v_list_subtotal, 2),
      'discount_total', ROUND(v_discount_total, 2),
      'percent_lines_total', ROUND(v_percent_total, 2),
      'finance_charges_total', ROUND(v_fin_total, 2),
      'sage_subscription_total', ROUND(v_net_total, 2),
      'blended_discount_pct', v_blended_pct
    )
  );
END;
$function$;

-- ─── recompute_quote_totals v2 ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_quote_totals(p_quote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_quote record;
  v_term public.contract_terms%ROWTYPE;
  v_y1_total numeric := 0;
  v_y1_subscription numeric := 0;
  v_first_year_only numeric := 0;
  v_recurring numeric := 0;
  v_year numeric := 0;
  v_subscription_tcv numeric := 0;
  v_year_idx integer;
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

  -- Year 1 is everything on the quote. Finance charges recur only under
  -- quarterly billing for the whole term; otherwise they are a year-1 cost.
  v_y1_total := COALESCE(v_quote.sage_subscription_total, 0);
  v_first_year_only := CASE WHEN v_quote.billing_cadence = 'quarterly' THEN 0
                            ELSE COALESCE(v_quote.finance_charges_total, 0) END;
  v_recurring := v_y1_total - v_first_year_only;
  -- Flat subscription (no percent lines): the base the months-style signing
  -- bonus has always been measured against.
  v_y1_subscription := v_y1_total - COALESCE(v_quote.percent_lines_total, 0);

  v_subscription_tcv := v_y1_total;
  IF v_quote.contract_term_id IS NOT NULL THEN
    SELECT * INTO v_term FROM public.contract_terms WHERE id = v_quote.contract_term_id;
    v_year := v_recurring;
    FOR v_year_idx IN 2..v_term.term_years LOOP
      v_year := ROUND(v_year * (1 + COALESCE(v_term.yoy_caps[v_year_idx], 0)), 2);
      v_subscription_tcv := v_subscription_tcv + v_year;
    END LOOP;
  END IF;

  IF v_quote.signing_bonus_amount > 0 THEN
    v_signing_bonus := v_quote.signing_bonus_amount;
  ELSIF v_quote.signing_bonus_months > 0 AND v_y1_subscription > 0 THEN
    v_signing_bonus := ROUND(v_quote.signing_bonus_months * (v_y1_subscription / 12.0), 2);
  ELSE
    v_signing_bonus := 0;
  END IF;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_sage_impl
  FROM public.quote_implementation_items
  WHERE quote_id = p_quote_id AND source = 'sage';

  SELECT COALESCE(SUM(pl.extended * b.term_years), 0) INTO v_partner_subs
  FROM public.quote_partner_lines pl
  JOIN public.quote_partner_blocks b ON b.id = pl.block_id
  WHERE pl.quote_id = p_quote_id;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_partner_impl
  FROM public.quote_implementation_items
  WHERE quote_id = p_quote_id AND source = 'partner';

  v_sage_total := v_subscription_tcv + v_sage_impl - v_signing_bonus;
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
    'version', 'v2',
    'sage_subscription_y1', v_y1_total,
    'sage_first_year_only', v_first_year_only,
    'sage_subscription_tcv', v_subscription_tcv,
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

-- ─── generate_payment_schedule v2 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_payment_schedule(p_quote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_quote record;
  v_term public.contract_terms%ROWTYPE;
  v_start date;
  v_y1_total numeric := 0;
  v_y1_subscription numeric := 0;
  v_first_year_only numeric := 0;
  v_signing_bonus numeric := 0;
  v_credit numeric := 0;
  v_applied numeric := 0;
  v_gross numeric := 0;
  v_year_idx int;
  v_year_subscription numeric;
  v_year_start date;
  v_next_year_start date;
  v_quarterly boolean;
  v_seq int := 0;
  v_rows_kept int := 0;
  v_breakdown jsonb;
  r record;
  v_n_invoices int;
  v_per_invoice numeric;
  v_invoice_idx int;
  v_invoice_date date;
  v_block record;
  v_block_year int;
  v_block_year_start date;
  v_free_idx int;
  v_free_date date;
  v_kickoff date;
  v_impl_anchor date;
  v_has_sow boolean;
  v_emit_impl boolean;
BEGIN
  SELECT q.*, COALESCE(q.contract_start_date, current_date) AS effective_start
  INTO v_quote FROM public.quotes q WHERE q.id = p_quote_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'quote not found'); END IF;

  SELECT EXISTS (SELECT 1 FROM public.sow_documents WHERE deal_id = v_quote.deal_id) INTO v_has_sow;

  SELECT MIN(COALESCE(start_date::date, due_date::date)) INTO v_kickoff
  FROM public.msp_stages
  WHERE deal_id = v_quote.deal_id
    AND (stage_name ILIKE '%kick off%' OR stage_name ILIKE '%kickoff%' OR stage_name ILIKE '%kick-off%');
  IF v_kickoff IS NULL THEN
    SELECT target_kickoff INTO v_kickoff FROM public.project_dates WHERE deal_id = v_quote.deal_id LIMIT 1;
  END IF;
  IF v_kickoff IS NULL THEN
    SELECT kickoff_date INTO v_kickoff FROM public.deal_analysis WHERE deal_id = v_quote.deal_id LIMIT 1;
  END IF;
  IF v_kickoff IS NOT NULL THEN
    v_impl_anchor := (date_trunc('month', v_kickoff)::date + INTERVAL '1 month' - INTERVAL '1 day')::date + INTERVAL '30 days';
  END IF;

  v_emit_impl := v_has_sow AND v_impl_anchor IS NOT NULL;

  DROP TABLE IF EXISTS _kept_rows;
  CREATE TEMP TABLE _kept_rows ON COMMIT DROP AS
    SELECT * FROM public.quote_payment_schedule
    WHERE quote_id = p_quote_id AND manually_edited = true;
  SELECT count(*) INTO v_rows_kept FROM _kept_rows;
  DELETE FROM public.quote_payment_schedule WHERE quote_id = p_quote_id;

  -- Year 1 bills everything on the quote. Finance charges (the quarterly
  -- surcharge) roll into later years only when the whole term is quarterly.
  v_y1_total := COALESCE(v_quote.sage_subscription_total, 0);
  v_first_year_only := CASE WHEN v_quote.billing_cadence = 'quarterly' THEN 0
                            ELSE COALESCE(v_quote.finance_charges_total, 0) END;
  v_y1_subscription := v_y1_total - COALESCE(v_quote.percent_lines_total, 0);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('quote_line_id', ql.id, 'product_sku', p.sku, 'product_name', p.name, 'qty', ql.quantity, 'unit_price', ql.unit_price, 'line_amount', ql.extended) ORDER BY ql.line_order), '[]'::jsonb)
  INTO v_breakdown
  FROM public.quote_lines ql JOIN public.products p ON p.id = ql.product_id
  WHERE ql.quote_id = p_quote_id AND ql.parent_line_id IS NULL;

  IF v_quote.signing_bonus_amount > 0 THEN v_signing_bonus := v_quote.signing_bonus_amount;
  ELSIF v_quote.signing_bonus_months > 0 AND v_y1_subscription > 0 THEN
    v_signing_bonus := ROUND(v_quote.signing_bonus_months * (v_y1_subscription / 12.0), 2);
  END IF;
  -- Drawn down across the subscription invoices in order. An invoice never
  -- goes below zero; what the bonus does not cover this invoice, it covers
  -- on the next.
  v_credit := v_signing_bonus;

  IF v_quote.contract_term_id IS NOT NULL AND v_y1_total > 0 THEN
    SELECT * INTO v_term FROM public.contract_terms WHERE id = v_quote.contract_term_id;
    v_start := v_quote.effective_start;
    IF v_quote.free_months > 0 AND v_quote.free_months_placement = 'front' THEN
      v_start := v_start + (v_quote.free_months || ' months')::interval;
    END IF;
    v_next_year_start := v_start;
    v_year_subscription := v_y1_total;
    FOR v_year_idx IN 1..v_term.term_years LOOP
      IF v_year_idx = 2 THEN
        v_year_subscription := ROUND((v_y1_total - v_first_year_only) * (1 + COALESCE(v_term.yoy_caps[v_year_idx], 0)), 2);
      ELSIF v_year_idx > 2 THEN
        v_year_subscription := ROUND(v_year_subscription * (1 + COALESCE(v_term.yoy_caps[v_year_idx], 0)), 2);
      END IF;
      v_year_start := v_next_year_start;

      IF v_year_idx = 1 AND v_quote.free_months > 0 AND v_quote.free_months_placement = 'front' THEN
        FOR v_free_idx IN 1..v_quote.free_months LOOP
          v_free_date := v_quote.effective_start + ((v_free_idx - 1) || ' months')::interval;
          v_seq := v_seq + 1;
          INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, invoice_date, period_start, period_end, amount, description)
          VALUES (p_quote_id, v_seq, 'free_month', 'sage', v_free_date, v_free_date, v_free_date + ('1 month')::interval - INTERVAL '1 day', 0, 'Free month');
        END LOOP;
      END IF;

      v_quarterly := (v_quote.billing_cadence = 'quarterly')
                  OR (v_quote.billing_cadence = 'quarterly_then_annual' AND v_year_idx = 1);

      IF NOT v_quarterly THEN
        v_gross := v_year_subscription;
        v_applied := LEAST(v_credit, v_gross);
        v_credit := v_credit - v_applied;
        v_seq := v_seq + 1;
        INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, invoice_date, period_start, period_end, amount, description, line_breakdown)
        VALUES (p_quote_id, v_seq, 'subscription_year', 'sage', v_year_start, v_year_start, v_year_start + ('12 months')::interval - INTERVAL '1 day',
          v_gross - v_applied,
          format('Sage Year %s subscription%s', v_year_idx, CASE WHEN v_applied > 0 THEN format(' (signing bonus -$%s applied)', v_applied::text) ELSE '' END),
          CASE WHEN v_year_idx = 1 THEN v_breakdown ELSE '[]'::jsonb END);
      ELSE
        FOR v_invoice_idx IN 1..4 LOOP
          v_invoice_date := v_year_start + ((v_invoice_idx - 1) * 3 || ' months')::interval;
          v_gross := ROUND(v_year_subscription / 4.0, 2);
          IF v_invoice_idx = 4 THEN v_gross := v_year_subscription - 3 * ROUND(v_year_subscription / 4.0, 2); END IF;
          v_applied := LEAST(v_credit, v_gross);
          v_credit := v_credit - v_applied;
          v_seq := v_seq + 1;
          INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, invoice_date, period_start, period_end, amount, description, line_breakdown)
          VALUES (p_quote_id, v_seq, 'subscription_quarter', 'sage', v_invoice_date, v_invoice_date, v_invoice_date + ('3 months')::interval - INTERVAL '1 day',
            v_gross - v_applied,
            format('Sage Year %s Q%s subscription%s', v_year_idx, v_invoice_idx, CASE WHEN v_applied > 0 THEN format(' (signing bonus -$%s applied)', v_applied::text) ELSE '' END),
            CASE WHEN v_year_idx = 1 AND v_invoice_idx = 1 THEN v_breakdown ELSE '[]'::jsonb END);
        END LOOP;
      END IF;

      v_next_year_start := (v_year_start + ('12 months')::interval)::date;
      IF v_year_idx = 1 AND v_quote.free_months > 0 AND v_quote.free_months_placement = 'back' THEN
        FOR v_free_idx IN 1..v_quote.free_months LOOP
          v_free_date := v_year_start + ('12 months')::interval + ((v_free_idx - 1) || ' months')::interval;
          v_seq := v_seq + 1;
          INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, invoice_date, period_start, period_end, amount, description)
          VALUES (p_quote_id, v_seq, 'free_month', 'sage', v_free_date, v_free_date, v_free_date + ('1 month')::interval - INTERVAL '1 day', 0, 'Free month');
        END LOOP;
        v_next_year_start := (v_next_year_start + (v_quote.free_months || ' months')::interval)::date;
      END IF;
    END LOOP;
  END IF;

  IF v_emit_impl THEN
    FOR r IN SELECT * FROM public.quote_implementation_items WHERE quote_id = p_quote_id AND source = 'sage' ORDER BY sort_order LOOP
      IF r.billing_type = 'fixed_bid_50_50' THEN
        v_seq := v_seq + 1;
        INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, implementor_name, invoice_date, amount, description, notes, implementation_item_id)
        VALUES (p_quote_id, v_seq, 'implementation_milestone', 'sage', r.implementor_name, v_impl_anchor, ROUND(r.total_amount * 0.5, 2), format('%s — 50%% at signing', r.name), 'First half of Fixed Bid implementation', r.id);
        v_seq := v_seq + 1;
        INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, implementor_name, invoice_date, amount, description, notes, implementation_item_id)
        VALUES (p_quote_id, v_seq, 'implementation_milestone', 'sage', r.implementor_name, COALESCE(r.estimated_completion_date, v_impl_anchor + INTERVAL '90 days'), ROUND(r.total_amount * 0.5, 2), format('%s — 50%% at completion', r.name), 'Second half of Fixed Bid implementation', r.id);
      ELSIF r.billing_type = 'tm_monthly' AND r.tm_weeks IS NOT NULL AND r.tm_weeks > 0 THEN
        v_n_invoices := CEIL(r.tm_weeks::numeric / 4.0);
        v_per_invoice := ROUND(r.total_amount / v_n_invoices, 2);
        FOR v_invoice_idx IN 1..v_n_invoices LOOP
          v_seq := v_seq + 1;
          INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, implementor_name, invoice_date, amount, description, notes, implementation_item_id)
          VALUES (p_quote_id, v_seq, 'implementation_arrears', 'sage', r.implementor_name, v_impl_anchor + ((v_invoice_idx - 1) || ' months')::interval, v_per_invoice, format('%s — Month %s of %s (T&M arrears)', r.name, v_invoice_idx, v_n_invoices), format('T&M billed monthly, %s weeks total', r.tm_weeks), r.id);
        END LOOP;
      ELSIF r.billing_type = 'one_time' THEN
        v_seq := v_seq + 1;
        INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, implementor_name, invoice_date, amount, description, implementation_item_id)
        VALUES (p_quote_id, v_seq, 'one_time_service', 'sage', r.implementor_name, v_impl_anchor, r.total_amount, format('%s — one-time fee', r.name), r.id);
      END IF;
    END LOOP;
  END IF;

  FOR v_block IN SELECT b.*, COALESCE(SUM(pl.extended), 0) AS block_y1_total FROM public.quote_partner_blocks b LEFT JOIN public.quote_partner_lines pl ON pl.block_id = b.id WHERE b.quote_id = p_quote_id GROUP BY b.id ORDER BY b.sort_order LOOP
    IF v_block.block_y1_total > 0 THEN
      FOR v_block_year IN 1..v_block.term_years LOOP
        v_block_year_start := v_quote.effective_start + ((v_block_year - 1) * 12 || ' months')::interval;
        v_seq := v_seq + 1;
        INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, implementor_name, invoice_date, period_start, period_end, amount, description)
        VALUES (p_quote_id, v_seq, 'partner_subscription_year', 'partner', v_block.partner_name, v_block_year_start, v_block_year_start, v_block_year_start + ('12 months')::interval - INTERVAL '1 day', v_block.block_y1_total, format('%s Year %s subscription', v_block.partner_name, v_block_year));
      END LOOP;
    END IF;
  END LOOP;

  IF v_emit_impl THEN
    FOR r IN SELECT * FROM public.quote_implementation_items WHERE quote_id = p_quote_id AND source = 'partner' ORDER BY sort_order LOOP
      IF r.billing_type = 'fixed_bid_50_50' THEN
        v_seq := v_seq + 1;
        INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, implementor_name, invoice_date, amount, description, implementation_item_id)
        VALUES (p_quote_id, v_seq, 'implementation_milestone', 'partner', r.implementor_name, v_impl_anchor, ROUND(r.total_amount * 0.5, 2), format('%s (%s) — 50%% at signing', r.name, r.implementor_name), r.id);
        v_seq := v_seq + 1;
        INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, implementor_name, invoice_date, amount, description, implementation_item_id)
        VALUES (p_quote_id, v_seq, 'implementation_milestone', 'partner', r.implementor_name, COALESCE(r.estimated_completion_date, v_impl_anchor + INTERVAL '90 days'), ROUND(r.total_amount * 0.5, 2), format('%s (%s) — 50%% at completion', r.name, r.implementor_name), r.id);
      ELSIF r.billing_type = 'tm_monthly' AND r.tm_weeks IS NOT NULL AND r.tm_weeks > 0 THEN
        v_n_invoices := CEIL(r.tm_weeks::numeric / 4.0);
        v_per_invoice := ROUND(r.total_amount / v_n_invoices, 2);
        FOR v_invoice_idx IN 1..v_n_invoices LOOP
          v_seq := v_seq + 1;
          INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, implementor_name, invoice_date, amount, description, implementation_item_id)
          VALUES (p_quote_id, v_seq, 'implementation_arrears', 'partner', r.implementor_name, v_impl_anchor + ((v_invoice_idx - 1) || ' months')::interval, v_per_invoice, format('%s (%s) — Month %s of %s', r.name, r.implementor_name, v_invoice_idx, v_n_invoices), r.id);
        END LOOP;
      ELSIF r.billing_type = 'one_time' THEN
        v_seq := v_seq + 1;
        INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, implementor_name, invoice_date, amount, description, implementation_item_id)
        VALUES (p_quote_id, v_seq, 'one_time_service', 'partner', r.implementor_name, v_impl_anchor, r.total_amount, format('%s (%s) — one-time fee', r.name, r.implementor_name), r.id);
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.quote_payment_schedule
    (id, quote_id, sequence_number, payment_type, source, implementor_name, invoice_date, period_start, period_end, amount, description, line_breakdown, manually_edited, notes, implementation_item_id, created_at, updated_at)
  SELECT id, quote_id, sequence_number, payment_type, source, implementor_name, invoice_date, period_start, period_end, amount, description, line_breakdown, true, notes, implementation_item_id, created_at, now() FROM _kept_rows;

  RETURN jsonb_build_object('ok', true, 'version', 'v2', 'rows_generated', v_seq, 'rows_kept_manually_edited', v_rows_kept, 'signing_bonus_applied', v_signing_bonus - v_credit, 'signing_bonus_unapplied', v_credit, 'first_year_only', v_first_year_only, 'free_months_placed', COALESCE(v_quote.free_months, 0), 'kickoff', v_kickoff, 'impl_anchor', v_impl_anchor, 'has_sow', v_has_sow, 'impl_emitted', v_emit_impl);
END;
$function$;
