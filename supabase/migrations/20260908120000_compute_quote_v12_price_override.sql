-- compute_quote v12 (2026-09-08): a percent_of_total line may carry a pinned
-- price in quote_lines.custom_fields->>'price_override'.
--
-- A percent_of_total product (Quarterly payment surcharge, Sandbox, Platform
-- Services) has a $0 unit price: the engine derives its amount from the other
-- lines. That left a rep no way to make the line match a figure on Sage paper
-- -- typing into the List box wrote quote_lines.unit_price, which this
-- function never read for such a line, so the number snapped straight back.
--
-- With a pinned price the line is treated as flat at that unit price: it
-- leaves the percent loops, counts toward list_subtotal and the blended
-- denominator at the pinned figure, and still takes its line / global
-- discount. Remove the key (or set it to a non-number) and the line derives
-- again. Nothing else changes; a quote with no pinned line computes exactly
-- as under v11. Previous definition: supabase/rollback/compute_quote_v11.sql.
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

  -- bundle children: extended and discount_amount both 0
  UPDATE _wq SET extended = 0, discount_amount = 0 WHERE is_bundle_child;

  -- flat lines (including pinned percent lines)
  UPDATE _wq
  SET extended = ROUND(quantity * unit_price * (1 - effective_discount_pct), 2),
      discount_amount = ROUND(quantity * unit_price * effective_discount_pct, 2)
  WHERE NOT is_percent AND NOT is_bundle_child;

  -- list-base % (single pass)
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

  -- net-base % (iterate to convergence)
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
      v_warning := format('v12: Quote did not converge after %s iterations', v_max_iter);
      EXIT;
    END IF;
  END LOOP;

  -- Persist per-line extended + discount_amount + effective_discount_pct
  UPDATE public.quote_lines ql
  SET extended = w.extended,
      discount_amount = w.discount_amount,
      effective_discount_pct = w.effective_discount_pct,
      updated_at = now()
  FROM _wq w
  WHERE ql.id = w.line_id;

  -- Quote-level totals
  SELECT
    COALESCE(SUM(CASE WHEN NOT is_percent AND NOT is_bundle_child THEN list_price * quantity ELSE 0 END), 0),
    COALESCE(SUM(discount_amount), 0),
    COALESCE(SUM(CASE WHEN is_percent THEN extended ELSE 0 END), 0),
    COALESCE(SUM(extended), 0)
  INTO v_list_subtotal, v_discount_total, v_percent_total, v_net_total
  FROM _wq;

  -- Blended discount: exclude entity lines and bundle children.
  -- numerator = sum of discount $ on non-entity, non-child lines
  -- denominator = sum of pre-discount value on the same set
  --   - flat lines:    list_price * quantity
  --   - percent lines: extended + discount_amount  (i.e. base * percentage_value before discount)
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
      blended_discount_pct = v_blended_pct,
      compute_warning = v_warning,
      updated_at = now()
  WHERE id = p_quote_id;

  PERFORM public.recompute_quote_totals(p_quote_id);

  RETURN jsonb_build_object(
    'converged', v_converged,
    'iterations', v_iter,
    'warning', v_warning,
    'version', 'v12',
    'totals', jsonb_build_object(
      'list_subtotal', ROUND(v_list_subtotal, 2),
      'discount_total', ROUND(v_discount_total, 2),
      'percent_lines_total', ROUND(v_percent_total, 2),
      'sage_subscription_total', ROUND(v_net_total, 2),
      'blended_discount_pct', v_blended_pct
    )
  );
END;
$function$;
