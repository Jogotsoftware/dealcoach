-- QDC disposition state on the deal record. Drives the QDC widget's status
-- pill and persists the AE's feedback/decision metadata. Stage transitions
-- (approved -> discovery, not_approved/cancelled -> disqualified) still
-- happen via the existing flow; these columns capture the *why* and *who*.
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS qdc_status text
    CHECK (qdc_status IS NULL OR qdc_status IN ('pending_approval','approved','not_approved','cancelled')),
  ADD COLUMN IF NOT EXISTS qdc_disposition_reason_id uuid REFERENCES public.im_rejection_reasons(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qdc_feedback text,
  ADD COLUMN IF NOT EXISTS qdc_dispositioned_at timestamptz,
  ADD COLUMN IF NOT EXISTS qdc_dispositioned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Seed the 3 QDC rejection reasons that aren't already covered by the
-- existing per-org im_rejection_reasons seeds. no_budget + no_authority
-- already exist with applies_to='both' so the QDC widget's filter
-- (applies_to IN ('pre_qdc','both')) picks them up.
-- ON CONFLICT against the existing unique (org_id, code) so re-runs are safe.
INSERT INTO public.im_rejection_reasons (org_id, code, label, applies_to, sort_order, active)
SELECT o.id, v.code, v.label, 'pre_qdc', v.sort_order, true
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('no_timeframe',    'No timeframe',    50),
    ('project_delayed', 'Project delayed', 51),
    ('no_pain',         'No pain',         52)
) AS v(code, label, sort_order)
ON CONFLICT (org_id, code) DO NOTHING;
