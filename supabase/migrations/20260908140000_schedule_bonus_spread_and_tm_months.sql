-- Payment schedule (2026-09-08, Atlanta Scales):
--
-- generate_payment_schedule v3
--   The signing bonus comes off the year's subscription first, and what is
--   left is split evenly across that year's invoices: four equal quarters
--   under quarterly billing (v2 drew the bonus down invoice by invoice, so
--   Q1-Q3 were $0 and Q4 carried everything). Any bonus a year cannot absorb
--   carries to the next year's invoices.
--
-- regenerate_implementation_arrears v2
--   Time-and-materials implementation is billed evenly over the months the
--   implementation actually runs. When the item carries no dates and no
--   tm_weeks, the window now comes from the deal's implementation timeline
--   (deal_rooms.implementation_anchor_date, then the MSP kickoff, then the
--   contract start; length = the last week on implementation_items), then
--   from the SOW's stated duration, and only then from the old 90-day
--   default. Atlanta Scales: 18 weeks from 2026-10-05 = 4 monthly invoices of
--   $9,762.50 instead of 2 x $19,525 over a guessed 90 days.
--
-- Rollback: supabase/rollback/generate_payment_schedule_v2.sql (v2 is also
-- the tail of 20260908130000) and
-- supabase/rollback/regenerate_implementation_arrears_v1.sql.

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
  v_net_year numeric := 0;
  v_per numeric := 0;
  v_amount numeric := 0;
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
  -- Comes off the year's subscription; the remainder is split evenly across
  -- that year's invoices. What a year cannot absorb carries forward.
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

      v_applied := LEAST(v_credit, v_year_subscription);
      v_credit := v_credit - v_applied;
      v_net_year := v_year_subscription - v_applied;

      IF NOT v_quarterly THEN
        v_seq := v_seq + 1;
        INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, invoice_date, period_start, period_end, amount, description, line_breakdown)
        VALUES (p_quote_id, v_seq, 'subscription_year', 'sage', v_year_start, v_year_start, v_year_start + ('12 months')::interval - INTERVAL '1 day',
          v_net_year,
          format('Sage Year %s subscription%s', v_year_idx, CASE WHEN v_applied > 0 THEN format(' (signing bonus -$%s applied)', v_applied::text) ELSE '' END),
          CASE WHEN v_year_idx = 1 THEN v_breakdown ELSE '[]'::jsonb END);
      ELSE
        v_per := ROUND(v_net_year / 4.0, 2);
        FOR v_invoice_idx IN 1..4 LOOP
          v_invoice_date := v_year_start + ((v_invoice_idx - 1) * 3 || ' months')::interval;
          v_amount := CASE WHEN v_invoice_idx = 4 THEN v_net_year - 3 * v_per ELSE v_per END;
          v_seq := v_seq + 1;
          INSERT INTO public.quote_payment_schedule (quote_id, sequence_number, payment_type, source, invoice_date, period_start, period_end, amount, description, line_breakdown)
          VALUES (p_quote_id, v_seq, 'subscription_quarter', 'sage', v_invoice_date, v_invoice_date, v_invoice_date + ('3 months')::interval - INTERVAL '1 day',
            v_amount,
            format('Sage Year %s Q%s subscription%s', v_year_idx, v_invoice_idx, CASE WHEN v_applied > 0 THEN format(' (signing bonus -$%s applied, split over 4 quarters)', ROUND(v_applied / 4.0, 2)::text) ELSE '' END),
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

  RETURN jsonb_build_object('ok', true, 'version', 'v3', 'rows_generated', v_seq, 'rows_kept_manually_edited', v_rows_kept, 'signing_bonus_applied', v_signing_bonus - v_credit, 'signing_bonus_unapplied', v_credit, 'first_year_only', v_first_year_only, 'free_months_placed', COALESCE(v_quote.free_months, 0), 'kickoff', v_kickoff, 'impl_anchor', v_impl_anchor, 'has_sow', v_has_sow, 'impl_emitted', v_emit_impl);
END;
$function$;

CREATE OR REPLACE FUNCTION public.regenerate_implementation_arrears(p_quote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  v_deal_id uuid;
  v_seq int;
  v_start date;
  v_end date;
  v_weeks numeric;
  v_months int;
  v_per numeric;
  v_allocated numeric;
  v_i int;
  v_period_start date;
  v_period_end date;
  v_written int := 0;
  v_source text := null;
begin
  select deal_id into v_deal_id from public.quotes where id = p_quote_id;

  delete from public.quote_payment_schedule
  where quote_id = p_quote_id and payment_type = 'implementation_arrears';

  select coalesce(max(sequence_number), 0) into v_seq
  from public.quote_payment_schedule where quote_id = p_quote_id;

  for r in
    select * from public.quote_implementation_items
    where quote_id = p_quote_id and billing_type = 'tm_monthly'
    order by sort_order
  loop
    v_start := r.estimated_start_date;
    v_end := r.estimated_completion_date;
    v_source := case when v_start is not null and v_end is not null then 'item dates' else null end;

    -- Start: the item's own date, else the room's implementation anchor,
    -- else the MSP kickoff, else the contract start.
    if v_start is null then
      select implementation_anchor_date into v_start
      from public.deal_rooms where deal_id = v_deal_id and implementation_anchor_date is not null
      order by created_at desc limit 1;
    end if;
    if v_start is null then
      select min(coalesce(s.start_date::date, s.due_date::date)) into v_start
      from public.msp_stages s
      where s.deal_id = v_deal_id
        and (s.stage_name ilike '%kick off%' or s.stage_name ilike '%kickoff%' or s.stage_name ilike '%kick-off%');
    end if;
    if v_start is null then
      select coalesce(contract_start_date, current_date) into v_start from public.quotes where id = p_quote_id;
    end if;

    -- End: the item's own weeks, else the deal's implementation timeline
    -- (its last week), else the SOW's stated duration, else 90 days.
    if v_end is null and r.tm_weeks is not null and r.tm_weeks > 0 then
      v_end := v_start + (r.tm_weeks * 7);
      v_source := coalesce(v_source, 'tm_weeks');
    end if;
    if v_end is null then
      select max(greatest(coalesce(end_week, 0), coalesce(start_week, 0))) into v_weeks
      from public.implementation_items where deal_id = v_deal_id;
      if v_weeks is not null and v_weeks > 0 then
        v_end := v_start + (v_weeks * 7)::int;
        v_source := coalesce(v_source, 'implementation timeline');
      end if;
    end if;
    if v_end is null then
      select max(coalesce(duration_to_complete_weeks, duration_to_live_weeks)) into v_weeks
      from public.sow_documents where deal_id = v_deal_id;
      if v_weeks is not null and v_weeks > 0 then
        v_end := v_start + (v_weeks * 7)::int;
        v_source := coalesce(v_source, 'SOW duration');
      end if;
    end if;
    if v_end is null then
      v_end := v_start + 90;
      v_source := coalesce(v_source, '90-day default');
    end if;

    -- Whole months only. A partial tail rolls into the final instalment rather
    -- than becoming a stub invoice, and the final period runs to the real
    -- end date. A mid-month kickoff behaves the same way: periods run from
    -- the start date, not from month boundaries.
    v_months := greatest(1, floor((v_end - v_start)::numeric / 30.4375)::int);
    v_per := round(r.total_amount / v_months, 2);
    v_allocated := 0;

    for v_i in 1..v_months loop
      v_period_start := (v_start + ((v_i - 1) || ' months')::interval)::date;
      if v_i = v_months then
        v_period_end := v_end;
        v_per := round(r.total_amount - v_allocated, 2);
      else
        v_period_end := (v_start + (v_i || ' months')::interval - interval '1 day')::date;
      end if;
      v_allocated := v_allocated + v_per;
      v_seq := v_seq + 1;

      insert into public.quote_payment_schedule (
        quote_id, sequence_number, payment_type, source, implementor_name,
        invoice_date, period_start, period_end, amount, description, notes, implementation_item_id
      ) values (
        p_quote_id, v_seq, 'implementation_arrears', 'sage', r.implementor_name,
        v_period_end, v_period_start, v_period_end, v_per,
        format('%s — Month %s of %s (T&M, in arrears)', r.name, v_i, v_months),
        format('Estimate. Time and materials billed monthly in arrears over the implementation (%s); actuals may differ.', v_source),
        r.id
      );
      v_written := v_written + 1;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'version', 'v2', 'rows', v_written);
end
$function$;
