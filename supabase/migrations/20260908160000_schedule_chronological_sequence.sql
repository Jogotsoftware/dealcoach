-- Payment schedule order (2026-09-08): regenerate_implementation_arrears v4
-- renumbers the whole schedule by due date once it has appended its rows,
-- so the stored sequence is chronological (implementation invoices fall
-- between the quarterly subscription invoices they overlap). The Evaluation
-- Room also sorts by due date on screen; this is for every reader that
-- trusts sequence_number. No unique constraint exists on
-- (quote_id, sequence_number), so a single UPDATE is safe.
--
-- Rollback: supabase/rollback/regenerate_implementation_arrears_v3.sql.

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
  v_start_src text;
  v_end_src text;
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
    -- Start: the item's own date, else the MSP implementation kickoff
    -- (milestone, then stage), else the room's implementation anchor, else
    -- the contract start.
    v_start := r.estimated_start_date;
    v_start_src := case when v_start is not null then 'item start date' end;
    if v_start is null then
      select min(due_date::date) into v_start from public.msp_milestones
      where deal_id = v_deal_id and milestone_name ilike '%kick%off%';
      v_start_src := case when v_start is not null then 'MSP kickoff milestone' end;
    end if;
    if v_start is null then
      select min(coalesce(s.start_date::date, s.due_date::date)) into v_start
      from public.msp_stages s where s.deal_id = v_deal_id and s.stage_name ilike '%kick%off%';
      v_start_src := case when v_start is not null then 'MSP kickoff stage' end;
    end if;
    if v_start is null then
      select implementation_anchor_date into v_start
      from public.deal_rooms where deal_id = v_deal_id and implementation_anchor_date is not null
      order by created_at desc limit 1;
      v_start_src := case when v_start is not null then 'room anchor date' end;
    end if;
    if v_start is null then
      select coalesce(contract_start_date, current_date) into v_start from public.quotes where id = p_quote_id;
      v_start_src := 'contract start';
    end if;

    -- End: the item's own date, else the MSP go-live (milestone, then the
    -- implementation stage's end), else the item's weeks, else the deal's
    -- implementation timeline, else the SOW's duration, else 90 days.
    v_end := r.estimated_completion_date;
    v_end_src := case when v_end is not null then 'item completion date' end;
    if v_end is null then
      select min(due_date::date) into v_end from public.msp_milestones
      where deal_id = v_deal_id and due_date::date > v_start
        and (milestone_name ilike '%go live%' or milestone_name ilike '%go-live%' or milestone_name ilike '%golive%');
      v_end_src := case when v_end is not null then 'MSP go-live milestone' end;
    end if;
    if v_end is null then
      select min(coalesce(s.end_date::date, s.due_date::date)) into v_end
      from public.msp_stages s where s.deal_id = v_deal_id and s.stage_name ilike '%implementation%'
        and coalesce(s.end_date::date, s.due_date::date) > v_start;
      v_end_src := case when v_end is not null then 'MSP implementation stage end' end;
    end if;
    if v_end is null and r.tm_weeks is not null and r.tm_weeks > 0 then
      v_end := v_start + (r.tm_weeks * 7);
      v_end_src := 'item weeks';
    end if;
    if v_end is null then
      select max(greatest(coalesce(end_week, 0), coalesce(start_week, 0))) into v_weeks
      from public.implementation_items where deal_id = v_deal_id;
      if v_weeks is not null and v_weeks > 0 then
        v_end := v_start + (v_weeks * 7)::int;
        v_end_src := 'implementation timeline';
      end if;
    end if;
    if v_end is null then
      select max(coalesce(duration_to_complete_weeks, duration_to_live_weeks)) into v_weeks
      from public.sow_documents where deal_id = v_deal_id;
      if v_weeks is not null and v_weeks > 0 then
        v_end := v_start + (v_weeks * 7)::int;
        v_end_src := 'SOW duration';
      end if;
    end if;
    if v_end is null then
      v_end := v_start + 90;
      v_end_src := '90-day default';
    end if;

    -- Evenly over the months the window spans. A partial final month is its
    -- own invoice, ending on the real end date, so kickoff-to-go-live of ten
    -- or twelve weeks bills three times, not two. Periods run from the start
    -- date, not from month boundaries.
    v_months := greatest(1, ceil((v_end - v_start)::numeric / 30.4375)::int);
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
        format('Estimate. Time and materials billed monthly in arrears from %s (%s) to %s (%s); actuals may differ.', v_start::text, v_start_src, v_end::text, v_end_src),
        r.id
      );
      v_written := v_written + 1;
    end loop;
  end loop;

  -- Every generator appends its rows at the end of the sequence, so the
  -- stored order was subscription first and implementation last. Renumber
  -- by due date (undated rows last) so anything reading by sequence -- the
  -- customer's Schedules tab, DealCoach's own builder -- lists the schedule
  -- chronologically without sorting for itself.
  with ordered as (
    select id, row_number() over (order by invoice_date nulls last, sequence_number, created_at) as rn
    from public.quote_payment_schedule where quote_id = p_quote_id
  )
  update public.quote_payment_schedule s set sequence_number = o.rn
  from ordered o where o.id = s.id and s.sequence_number is distinct from o.rn;

  return jsonb_build_object('ok', true, 'version', 'v4', 'rows', v_written);
end
$function$;
