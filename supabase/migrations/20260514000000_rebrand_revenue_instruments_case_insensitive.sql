-- Case-insensitive rebrand sweep. The previous Revenue Instruments → Lumen
-- migration used REPLACE() which is case-sensitive, so uppercase headings
-- inside prompts (e.g. "REVENUE INSTRUMENTS" in coach system_prompts) survived.
-- regexp_replace with the 'gi' flag catches every casing.

UPDATE coaches SET
  name = regexp_replace(name, 'revenue instruments', 'Lumen', 'gi'),
  description = regexp_replace(COALESCE(description, ''), 'revenue instruments', 'Lumen', 'gi'),
  system_prompt = regexp_replace(COALESCE(system_prompt, ''), 'revenue instruments', 'Lumen', 'gi')
WHERE name ILIKE '%revenue instruments%'
   OR description ILIKE '%revenue instruments%'
   OR system_prompt ILIKE '%revenue instruments%';

UPDATE call_type_prompts SET
  prompt = regexp_replace(prompt, 'revenue instruments', 'Lumen', 'gi')
WHERE prompt ILIKE '%revenue instruments%';

UPDATE system_ai_rules SET
  rule_content = regexp_replace(rule_content, 'revenue instruments', 'Lumen', 'gi')
WHERE rule_content ILIKE '%revenue instruments%';
