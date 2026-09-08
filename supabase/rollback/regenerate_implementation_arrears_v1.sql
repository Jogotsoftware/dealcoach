-- Rollback artifact: public.regenerate_implementation_arrears as it stood
-- before 20260908140000_schedule_bonus_spread_and_tm_months.sql (captured
-- from pg_get_functiondef on 2026-09-08). Window = item dates, else kickoff /
-- contract start plus tm_weeks, else 90 days.
CREATE OR REPLACE FUNCTION public.regenerate_implementation_arrears(p_quote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  v_seq int;
  v_start date;
  v_end date;
  v_months int;
  v_per numeric;
  v_allocated numeric;
  v_i int;
  v_period_start date;
  v_period_end date;
  v_written int := 0;
begin
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

    -- Without a window there is nothing honest to say about timing, so fall
    -- back to the stated duration and only then to a three month default.
    if v_start is null then
      select min(coalesce(s.start_date::date, s.due_date::date)) into v_start
      from public.msp_stages s
      join public.quotes q on q.id = p_quote_id
      where s.deal_id = q.deal_id
        and (s.stage_name ilike '%kick off%' or s.stage_name ilike '%kickoff%' or s.stage_name ilike '%kick-off%');
    end if;
    if v_start is null then
      select coalesce(contract_start_date, current_date) into v_start from public.quotes where id = p_quote_id;
    end if;

    if v_end is null and r.tm_weeks is not null and r.tm_weeks > 0 then
      v_end := v_start + (r.tm_weeks * 7);
    end if;
    if v_end is null then
      v_end := v_start + 90;
    end if;

    -- Whole months only. A partial tail rolls into the final instalment rather
    -- than becoming a stub invoice, and the final period runs to the real
    -- go-live date. A mid-month kickoff behaves the same way: periods run from
    -- the kickoff date, not from month boundaries.
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
        'Estimate. Time and materials billed monthly in arrears; actuals may differ.',
        r.id
      );
      v_written := v_written + 1;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'rows', v_written);
end
$function$;
