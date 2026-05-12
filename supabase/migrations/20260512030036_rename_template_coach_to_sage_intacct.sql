-- Phase 1.0a: Rename template coach to Sage Intacct - General Business
UPDATE coaches
SET name = 'Sage Intacct - General Business',
    updated_at = NOW()
WHERE id = '7c84cba2-a9f9-45ee-a954-733697ba9a39'
  AND is_template = true;
