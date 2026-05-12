-- Phase 1.3: extend deal_forecast_predictions for glass-box confidence
ALTER TABLE deal_forecast_predictions
  ADD COLUMN IF NOT EXISTS confidence_factors jsonb,
  ADD COLUMN IF NOT EXISTS raw_score numeric,
  ADD COLUMN IF NOT EXISTS calibration_adjustment numeric,
  ADD COLUMN IF NOT EXISTS biggest_lever_dimension text,
  ADD COLUMN IF NOT EXISTS biggest_lever_potential numeric;
