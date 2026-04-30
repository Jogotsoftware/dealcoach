-- AE-side per-row visibility toggle for the customer-facing Proposal > Schedules tab.
-- The row stays in the database (so totals and the AE's editor reconcile) but
-- ProposalView filters it out of the customer view when set to false.

ALTER TABLE public.quote_payment_schedule
  ADD COLUMN IF NOT EXISTS show_in_proposal boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.quote_payment_schedule.show_in_proposal IS
  'Whether this row appears in the customer-facing Proposal > Schedules tab. AE can hide rows without deleting them. Defaults to true.';

-- Re-snapshot must include the new column + notes so the customer view honors
-- AE toggles. The body of snapshot_proposal is unchanged otherwise.
CREATE OR REPLACE FUNCTION public.snapshot_proposal(p_quote_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_quote record;
  v_deal record;
  v_org record;
  v_term record;
  v_signer record;
  v_room_id uuid;
  v_snapshot jsonb;
BEGIN
  SELECT * INTO v_quote FROM public.quotes WHERE id = p_quote_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'quote not found'); END IF;

  SELECT * INTO v_deal FROM public.deals WHERE id = v_quote.deal_id;
  SELECT * INTO v_org FROM public.organizations WHERE id = v_quote.org_id;
  SELECT * INTO v_term FROM public.contract_terms WHERE id = v_quote.contract_term_id;
  SELECT name, email, title INTO v_signer
    FROM public.contacts WHERE id = v_quote.signer_contact_id;

  SELECT id INTO v_room_id FROM public.deal_rooms WHERE deal_id = v_quote.deal_id;
  IF v_room_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no deal room for this deal');
  END IF;

  v_snapshot := jsonb_build_object(
    'snapshotted_at', now(),
    'quote_id', v_quote.id,
    'quote_name', v_quote.name,
    'quote_version', v_quote.version,
    'display_config', COALESCE(v_quote.deal_room_display_config, '{}'::jsonb),
    'signer_contact', CASE WHEN v_signer.name IS NOT NULL
      THEN jsonb_build_object('name', v_signer.name, 'email', v_signer.email, 'title', v_signer.title)
      ELSE NULL END,
    'deal', jsonb_build_object(
      'id', v_deal.id,
      'company_name', v_deal.company_name,
      'customer_logo_url', v_deal.customer_logo_url
    ),
    'org', jsonb_build_object(
      'id', v_org.id,
      'name', v_org.name,
      'logo_url', v_org.logo_url
    ),
    'term', CASE WHEN v_term IS NOT NULL THEN jsonb_build_object(
      'name', v_term.name,
      'term_years', v_term.term_years,
      'yoy_caps', v_term.yoy_caps,
      'description', v_term.description
    ) ELSE NULL END,
    'contract_start_date', v_quote.contract_start_date,
    'free_months', v_quote.free_months,
    'free_months_placement', v_quote.free_months_placement,
    'billing_cadence', v_quote.billing_cadence,
    'signing_bonus_amount', v_quote.signing_bonus_amount,
    'signing_bonus_months', v_quote.signing_bonus_months,
    'totals', jsonb_build_object(
      'sage_subscription', v_quote.sage_subscription_total,
      'sage_implementation', v_quote.sage_implementation_total,
      'sage_total', v_quote.sage_total,
      'partner_subscription', v_quote.partner_subscription_total,
      'partner_implementation', v_quote.partner_implementation_total,
      'partner_total', v_quote.partner_total,
      'solution_total', v_quote.solution_total
    ),
    'sage_lines', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', ql.id,
        'parent_line_id', ql.parent_line_id,
        'sku', p.sku,
        'name', p.name,
        'is_bundle', p.is_bundle,
        'is_bundle_child', (ql.parent_line_id IS NOT NULL),
        'quantity', ql.quantity,
        'unit_price', ql.unit_price,
        'extended', ql.extended,
        'discount_pct', ql.discount_pct,
        'pricing_method', p.pricing_method
      ) ORDER BY ql.line_order), '[]'::jsonb)
      FROM public.quote_lines ql
      JOIN public.products p ON p.id = ql.product_id
      WHERE ql.quote_id = p_quote_id
    ),
    'sage_implementation', (
      SELECT COALESCE(jsonb_agg(to_jsonb(i.*) ORDER BY i.sort_order), '[]'::jsonb)
      FROM public.quote_implementation_items i
      WHERE i.quote_id = p_quote_id AND i.source = 'sage'
    ),
    'partner_blocks', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'block', to_jsonb(b.*),
        'lines', (
          SELECT COALESCE(jsonb_agg(to_jsonb(pl.*) ORDER BY pl.sort_order), '[]'::jsonb)
          FROM public.quote_partner_lines pl WHERE pl.block_id = b.id
        ),
        'implementation', (
          SELECT COALESCE(jsonb_agg(to_jsonb(i.*) ORDER BY i.sort_order), '[]'::jsonb)
          FROM public.quote_implementation_items i
          WHERE i.quote_id = p_quote_id AND i.source = 'partner'
            AND i.implementor_name = b.partner_name
        )
      ) ORDER BY b.sort_order), '[]'::jsonb)
      FROM public.quote_partner_blocks b
      WHERE b.quote_id = p_quote_id
    ),
    'payment_schedule', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'sequence_number', s.sequence_number,
        'source', s.source,
        'implementor_name', s.implementor_name,
        'payment_type', s.payment_type,
        'invoice_date', s.invoice_date,
        'period_start', s.period_start,
        'period_end', s.period_end,
        'amount', s.amount,
        'description', s.description,
        'notes', s.notes,
        'show_in_proposal', s.show_in_proposal
      ) ORDER BY s.sequence_number), '[]'::jsonb)
      FROM public.quote_payment_schedule s
      WHERE s.quote_id = p_quote_id
    )
  );

  UPDATE public.deal_rooms
  SET proposal_snapshot = v_snapshot,
      proposal_snapshotted_at = now(),
      proposal_snapshot_quote_id = p_quote_id,
      updated_at = now()
  WHERE id = v_room_id;

  RETURN jsonb_build_object(
    'ok', true,
    'deal_room_id', v_room_id,
    'snapshotted_at', now()
  );
END;
$function$;
