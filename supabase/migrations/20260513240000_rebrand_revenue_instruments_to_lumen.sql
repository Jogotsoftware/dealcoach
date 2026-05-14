-- Rebrand: replace "Revenue Instruments" with "Lumen" across every
-- user-visible DB column. Beta users were still seeing the old brand in AI
-- chat responses because coach prompts (which feed assemble_coach_prompt and
-- get echoed by Claude) still contained the old name. Idempotent via
-- REPLACE — re-running is a no-op once clean.

UPDATE coaches
  SET name = REPLACE(name, 'Revenue Instruments', 'Lumen')
  WHERE name LIKE '%Revenue Instruments%';

UPDATE coaches
  SET description = REPLACE(description, 'Revenue Instruments', 'Lumen')
  WHERE description LIKE '%Revenue Instruments%';

UPDATE coaches
  SET system_prompt = REPLACE(system_prompt, 'Revenue Instruments', 'Lumen')
  WHERE system_prompt LIKE '%Revenue Instruments%';

UPDATE call_type_prompts
  SET prompt = REPLACE(prompt, 'Revenue Instruments', 'Lumen')
  WHERE prompt LIKE '%Revenue Instruments%';

UPDATE system_ai_rules
  SET rule_content = REPLACE(rule_content, 'Revenue Instruments', 'Lumen')
  WHERE rule_content LIKE '%Revenue Instruments%';
