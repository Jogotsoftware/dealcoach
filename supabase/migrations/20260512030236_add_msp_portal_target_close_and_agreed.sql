-- Phase 1.0c: Extend msp_customer_portals with MSP target_close_date and prospect agreement tracking
ALTER TABLE msp_customer_portals
  ADD COLUMN IF NOT EXISTS target_close_date date,
  ADD COLUMN IF NOT EXISTS prospect_agreed_flag boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS prospect_agreed_at timestamptz;
