-- Private storage bucket for AE-uploaded order-schedule PDFs. Path convention:
--   {org_id}/{deal_id}/{quote_id}/{filename}
-- 25 MB cap, application/pdf only. RLS scopes read/write/delete to authenticated
-- users whose profile.org_id matches the first path segment.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('order-schedule-uploads', 'order-schedule-uploads', false, 25 * 1024 * 1024, ARRAY['application/pdf']::text[])
  ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "order_schedule_org_select" ON storage.objects;
DROP POLICY IF EXISTS "order_schedule_org_insert" ON storage.objects;
DROP POLICY IF EXISTS "order_schedule_org_delete" ON storage.objects;

CREATE POLICY "order_schedule_org_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'order-schedule-uploads'
    AND (storage.foldername(name))[1] = (SELECT org_id::text FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "order_schedule_org_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'order-schedule-uploads'
    AND (storage.foldername(name))[1] = (SELECT org_id::text FROM profiles WHERE id = auth.uid())
  );

CREATE POLICY "order_schedule_org_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'order-schedule-uploads'
    AND (storage.foldername(name))[1] = (SELECT org_id::text FROM profiles WHERE id = auth.uid())
  );
