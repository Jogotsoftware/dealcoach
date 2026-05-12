-- Phase 1.4: ranked open barriers view
CREATE OR REPLACE VIEW deal_open_barriers_v AS
SELECT
  dgcs.id AS state_id,
  dgcs.deal_id,
  dgcs.org_id,
  cgc.dimension,
  cgc.criterion_key,
  cgc.criterion_title,
  dgcs.state,
  dgcs.evidence_quote,
  dgcs.source_conversation_id,
  dgcs.source_speaker,
  dgcs.source_date,
  dgcs.suggested_action,
  (cgc.weight *
   CASE dgcs.state
     WHEN 'open' THEN 1.0
     WHEN 'partial' THEN 0.5
     ELSE 0
   END
  ) AS impact_score
FROM deal_gate_criteria_state dgcs
JOIN coach_gate_criteria cgc ON cgc.id = dgcs.criterion_id
WHERE dgcs.state NOT IN ('met','not_applicable')
ORDER BY impact_score DESC;

GRANT SELECT ON deal_open_barriers_v TO authenticated;
