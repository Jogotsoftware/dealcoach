-- Phase 1.8: deals next_steps AI suggestion fields (red/green); AE choice stays in next_steps_color
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS next_steps_ai_status text,
  ADD COLUMN IF NOT EXISTS next_steps_ai_reasoning text,
  ADD COLUMN IF NOT EXISTS next_steps_ai_evaluated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.deals'::regclass AND conname = 'deals_next_steps_ai_status_check'
  ) THEN
    ALTER TABLE deals
      ADD CONSTRAINT deals_next_steps_ai_status_check
      CHECK (next_steps_ai_status IN ('red','green') OR next_steps_ai_status IS NULL);
  END IF;
END $$;
