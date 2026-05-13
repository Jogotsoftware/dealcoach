-- Per-user beta feature flags. Beta users (profiles.access_mode='dealroom_only',
-- displayed in the UI as "Beta") start with a minimal Deal-Room-only experience.
-- The platform admin can opt them in to specific features one at a time by setting
-- beta_features->>'feature_key' = 'true'. New features are introduced piece by piece;
-- this column holds the per-user enablement state.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS beta_features JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN profiles.beta_features IS
  'Per-user beta feature toggles for users with access_mode=''dealroom_only'' (aka Beta). Shape: { "feature_key": true|false }. Default empty = no extra features beyond the baseline Deal Room experience. Managed from AdminConsole UsersTab.';
