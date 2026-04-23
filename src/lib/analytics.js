// Thin analytics wrapper. All calls no-op if PostHog isn't initialized.
import posthog from 'posthog-js'

const enabled = () => Boolean(import.meta.env.VITE_POSTHOG_KEY)

export function track(event, properties = {}) {
  if (!enabled()) return
  try { posthog.capture(event, properties) } catch (e) { console.log('analytics.track error:', e) }
}

export function identify(userId, properties = {}) {
  if (!enabled() || !userId) return
  try { posthog.identify(userId, properties) } catch (e) { console.log('analytics.identify error:', e) }
}

export function reset() {
  if (!enabled()) return
  try { posthog.reset() } catch (e) { console.log('analytics.reset error:', e) }
}
