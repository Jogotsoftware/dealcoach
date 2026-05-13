-- Adds profiles.access_mode for per-user navigation scope (orthogonal to role).
-- 'full'          = standard access (default for all existing + new users)
-- 'dealroom_only' = pilot AE — sees only their deals, create-deal, and the Deal Room tab.
--
-- Enforcement is client-side (Layout.jsx allow-list + DealDetail.jsx tab filter +
-- Pipeline.jsx widget filter). Admin UI toggle lives in AdminConsole UsersTab.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'full';

ALTER TABLE profiles
  DROP CONSTRAINT IF EXISTS profiles_access_mode_check;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_access_mode_check
  CHECK (access_mode IN ('full', 'dealroom_only'));

COMMENT ON COLUMN profiles.access_mode IS
  'Controls in-app navigation scope. ''full'' = standard access. ''dealroom_only'' = pilot users who can only see their deals, create new deals, and access the Deal Room tab. Enforced in Layout.jsx + DealDetail.jsx + Pipeline.jsx.';
