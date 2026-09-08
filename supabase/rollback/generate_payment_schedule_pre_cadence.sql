-- Rollback artifact: public.generate_payment_schedule as it stood before
-- 20260908130000_billing_cadence_quarterly_then_annual.sql (captured from
-- pg_get_functiondef on 2026-09-08). Known defects it carries: the signing
-- bonus is subtracted whole from the first invoice (can go negative), and
-- year starts after a quarterly year are measured from the last quarterly
-- invoice (year 3 lands nine months late).
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
  v_y1_subscription numeric := 0;
  v_signing_bonus numeric := 0;
  v_year_idx int;
  v_year_subscription numeric;
  v_year_start date;
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

  v_y1_subscription := COALESCE(v_quote.sage_subscription_total, 0);

  SELECT COALESCE(jsonb_agg(jsonb_build_object('quote_line_id', ql.id, 'product_sku', p.sku, 'product_name', p.name, 'qty', ql.quantity, 'unit_price', ql.unit_price, 'line_amount', ql.extended) ORDER BY ql.line_order), '[]'::jsonb)
  INTO v_breakdown
  FROM public.quote_lines ql JOIN public.products p ON p.id = ql.product_id
  WHERE ql.quote_id = p_quote_id AND ql.parent_line_id IS NULL;

  IF v_quote.signing_bonus_amount > 0 THEN v_signing_bonus := v_quote.signing_bonus_amount;
  ELSIF v_quote.signing_bonus_months > 0 AND v_y1_subscription > 0 THEN
    v_signing_bonus := ROUND(v_quote.signing_bonus_months * (v_y1_subscription / 12.0), 2);
  END IF;

  IF v_quote.contract_term_id IS NOT NULL AND v_y1_subscription > 0 THEN
    SELECT * INTO v_term FROM public.contract_terms WHERE id = v_quote.contract_term_id;
    v_start := v_quote.effective_start;
    IF v_quote.free_months > 0 AND v_quote.free_months_placement = 'front' THEN
      v_start := v_start + (v_quote.free_months || ' months')::interval;
    END IF;
    v_year_subscription := v_y1_subscription;
    FOR v_year_idx IN 1..v_term.term_years LOOP
      IF v_year_idx > 1 THEN
        v_year_subscription := ROUND(v_year_subscription * (1 + v_term.yoy_caps[v_year_idx]), 2);
      END IF;
      IF v_year_idx = 1 THEN v_year_start := v_start;
      ELSIF v_year_idx = 2 AND v_quote.free_months > 0 AND v_quote.free_months_placement = 'back' THEN
        v_year_start := v_quote.effective_start + ('12 months')::interval + (v_quote.free_months || ' months')::interval;
      ELSE
        SELECT MAX(period_start) + ('12 months')::interval INTO v_year_start
        FROM public.quote_payment_schedule WHERE quote_id = p_quote_id AND payment_type IN ('subscription_year','subscription_quarter');
        IF v_year_start IS NULL THEN v_year_start := v_start + ((v_year_idx - 1) * 12 || ' months')::interval; END IF;
      END IF;
      IF v_year_idx = 1 AND v_quote.free_months > 0 AND v_quote.free_months_placement = 'front' THEN
        FOR v_free_idx IN 1..v_quote.free_months LOOP
          v_free_date := v_quote.effective_start + ((v_free_idx - 1) || ' months')::interval;
          v_seq := v_seq + 1;
          INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, invoice_date, period_start, period_end, amount, description)
          VALUES (p_quote_id, v_seq, 'free_month', 'sage', v_free_date, v_free_date, v_free_date + ('1 month')::interval - INTERVAL '1 day', 0, 'Free month');
        END LOOP;
      END IF;
      IF v_quote.billing_cadence = 'annual' THEN
        v_seq := v_seq + 1;
        INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, invoice_date, period_start, period_end, amount, description, line_breakdown)
        VALUES (p_quote_id, v_seq, 'subscription_year', 'sage', v_year_start, v_year_start, v_year_start + ('12 months')::interval - INTERVAL '1 day',
          v_year_subscription - CASE WHEN v_year_idx = 1 THEN v_signing_bonus ELSE 0 END,
          format('Sage Year %s subscription%s', v_year_idx, CASE WHEN v_year_idx = 1 AND v_signing_bonus > 0 THEN format(' (signing bonus -$%s applied)', v_signing_bonus::text) ELSE '' END),
          CASE WHEN v_year_idx = 1 THEN v_breakdown ELSE '[]'::jsonb END);
      ELSE
        FOR v_invoice_idx IN 1..4 LOOP
          v_invoice_date := v_year_start + ((v_invoice_idx - 1) * 3 || ' months')::interval;
          v_seq := v_seq + 1;
          INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, invoice_date, period_start, period_end, amount, description, line_breakdown)
          VALUES (p_quote_id, v_seq, 'subscription_quarter', 'sage', v_invoice_date, v_invoice_date, v_invoice_date + ('3 months')::interval - INTERVAL '1 day',
            ROUND(v_year_subscription / 4.0, 2) - CASE WHEN v_year_idx = 1 AND v_invoice_idx = 1 THEN v_signing_bonus ELSE 0 END,
            format('Sage Year %s Q%s subscription', v_year_idx, v_invoice_idx),
            CASE WHEN v_year_idx = 1 AND v_invoice_idx = 1 THEN v_breakdown ELSE '[]'::jsonb END);
        END LOOP;
      END IF;
      IF v_year_idx = 1 AND v_quote.free_months > 0 AND v_quote.free_months_placement = 'back' THEN
        FOR v_free_idx IN 1..v_quote.free_months LOOP
          v_free_date := v_year_start + ('12 months')::interval + ((v_free_idx - 1) || ' months')::interval;
          v_seq := v_seq + 1;
          INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, invoice_date, period_start, period_end, amount, description)
          VALUES (p_quote_id, v_seq, 'free_month', 'sage', v_free_date, v_free_date, v_free_date + ('1 month')::interval - INTERVAL '1 day', 0, 'Free month');
        END LOOP;
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

  RETURN jsonb_build_object('ok', true, 'rows_generated', v_seq, 'rows_kept_manually_edited', v_rows_kept, 'signing_bonus_applied', v_signing_bonus, 'free_months_placed', COALESCE(v_quote.free_months, 0), 'kickoff', v_kickoff, 'impl_anchor', v_impl_anchor, 'has_sow', v_has_sow, 'impl_emitted', v_emit_impl);
END;
$function$;
