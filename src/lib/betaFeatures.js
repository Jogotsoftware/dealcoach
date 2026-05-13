// Central registry of beta features. Each entry is a feature that can be
// enabled per-user via profiles.beta_features (JSONB). Beta users
// (access_mode='dealroom_only') start with a minimal Deal-Room-only experience;
// each entry below is an opt-in extension the platform admin can flip on per
// user from the AdminConsole UsersTab.
//
// As we ship a new piece of functionality, add an entry here. Then gate the
// UI code on hasBetaFeature(profile, '<key>'). The AdminConsole will pick up
// the new entry automatically and render a toggle alongside the user row.

export const BETA_FEATURES = [
  // Example shape — leave commented until the first real feature lands:
  // {
  //   key: 'analysis_tab',
  //   label: 'Analysis tab',
  //   description: 'Show the Analysis tab on the Deal page (transcripts + AI scoring).',
  // },
]

// Returns true when the user has the given beta feature enabled. Non-beta
// users (access_mode='full') always return true — the gate only restricts
// beta users. Defensive against missing profiles or missing column.
export function hasBetaFeature(profile, key) {
  if (!profile) return false
  if (profile.access_mode !== 'dealroom_only') return true
  const flags = profile.beta_features || {}
  return flags[key] === true
}
