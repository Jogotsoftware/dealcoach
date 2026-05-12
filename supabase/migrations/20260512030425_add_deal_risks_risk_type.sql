-- Phase 1.10: extend deal_risks with risk_type for canonical AI-generated risk classification
ALTER TABLE deal_risks
  ADD COLUMN IF NOT EXISTS risk_type text;

CREATE INDEX IF NOT EXISTS idx_deal_risks_risk_type ON deal_risks(risk_type) WHERE risk_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deal_risks_deal_active ON deal_risks(deal_id, status);
