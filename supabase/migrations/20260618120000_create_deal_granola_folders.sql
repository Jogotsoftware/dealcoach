-- deal_granola_folders: explicit map of one Granola folder -> one Lumen deal.
-- Joe creates a Granola folder per deal; granola-sync uses this mapping to pull
-- labeled calls from the folder into the right deal on a schedule. The owning
-- user_id determines which user_granola_connections (Granola token) is used.

CREATE TABLE IF NOT EXISTS public.deal_granola_folders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  deal_id             uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES public.profiles(id),  -- whose Granola connection to use
  granola_folder_id   text NOT NULL,
  granola_folder_name text,
  enabled             boolean NOT NULL DEFAULT true,
  last_synced_at      timestamptz,
  created_by          uuid REFERENCES public.profiles(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (granola_folder_id)   -- a folder feeds exactly one deal
);

CREATE INDEX IF NOT EXISTS idx_deal_granola_folders_org_deal
  ON public.deal_granola_folders (org_id, deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_granola_folders_enabled
  ON public.deal_granola_folders (enabled) WHERE enabled;

ALTER TABLE public.deal_granola_folders ENABLE ROW LEVEL SECURITY;

-- Org-scoped, matching the project convention (user_org_id() helper). Any member
-- of the deal's org can view/manage the mapping; service role bypasses RLS.
CREATE POLICY dgf_org_select ON public.deal_granola_folders
  FOR SELECT USING (org_id = user_org_id());
CREATE POLICY dgf_org_insert ON public.deal_granola_folders
  FOR INSERT WITH CHECK (org_id = user_org_id());
CREATE POLICY dgf_org_update ON public.deal_granola_folders
  FOR UPDATE USING (org_id = user_org_id()) WITH CHECK (org_id = user_org_id());
CREATE POLICY dgf_org_delete ON public.deal_granola_folders
  FOR DELETE USING (org_id = user_org_id());

CREATE TRIGGER dgf_updated_at
  BEFORE UPDATE ON public.deal_granola_folders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
