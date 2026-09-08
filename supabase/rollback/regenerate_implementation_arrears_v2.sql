-- Rollback artifact: regenerate_implementation_arrears v2 (from 20260908140000), superseded by v3 in 20260908150000.
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
