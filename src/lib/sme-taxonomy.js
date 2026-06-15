// Starter taxonomy for /admin/sme-routing first-visit auto-seed.
// Grouped by category in the UI (collapsible sections) but stored as flat
// topic_tag strings in sme_routing_rules. Admin can rename, remove, or add
// tags freely after seed.

export const SME_TAXONOMY_GROUPS = [
  {
    label: 'Product',
    tags: ['intacct-core', 'intacct-modules', 'intacct-integrations-native', 'intacct-roadmap', 'intacct-feature-gaps'],
  },
  {
    label: 'Partners — ISVs & ecosystem',
    tags: ['isv-partners-general', 'isv-marketplace', 'isv-evaluation-criteria'],
  },
  {
    label: 'Partners — implementation & accountants',
    tags: ['implementation-partners-general', 'accountant-channel', 'partner-bandwidth-and-capacity', 'partner-quality-and-references', 'partner-co-sell-process'],
  },
  {
    label: 'Partners — commercial',
    tags: ['partner-pricing-and-margins', 'partner-deal-registration', 'partner-routing-and-conflict', 'partner-discounting-rules'],
  },
  {
    label: 'Internal Sage processes',
    tags: ['deal-desk-and-approvals', 'pricing-and-packaging', 'commission-and-comp', 'spiff-and-incentives', 'contract-and-paper-process', 'credit-and-collections', 'order-management', 'renewals-and-retention', 'territory-and-account-assignment', 'sage-internal-escalation-paths'],
  },
  {
    label: 'ProServe & implementation',
    tags: ['proserve-scoping', 'proserve-resourcing', 'implementation-methodology', 'go-live-and-cutover', 'customer-success-handoff', 'cs-escalations'],
  },
  {
    label: 'Competitive',
    tags: ['competitive-netsuite', 'competitive-acumatica', 'competitive-workday-financials', 'competitive-d365bc', 'competitive-quickbooks-iqe', 'competitive-oracle', 'competitive-displacement-plays', 'competitive-pricing-intel'],
  },
  {
    label: 'Industry / vertical',
    tags: ['vertical-manufacturing', 'vertical-distribution', 'vertical-saas', 'vertical-services', 'vertical-nonprofit', 'vertical-pe-backed', 'vertical-construction-crossover'],
  },
  {
    label: 'Legal / compliance / security',
    tags: ['legal-and-procurement', 'security-questionnaires', 'soc2-and-compliance', 'gdpr-and-data-residency', 'mnda-and-redlines', 'dpa-and-data-processing'],
  },
  {
    label: 'Methodology',
    tags: ['selling-through-curiosity', 'power-of-7', 'forecasting-cadence', 'discovery-best-practices', 'demo-best-practices', 'negotiation-and-closing', 'objection-handling'],
  },
]

export const STARTER_TAGS = SME_TAXONOMY_GROUPS.flatMap(g => g.tags)

// Resolve a topic_tag to its category label for grouped display.
export function taxonomyCategory(tag) {
  for (const g of SME_TAXONOMY_GROUPS) if (g.tags.includes(tag)) return g.label
  if (tag?.startsWith('isv-named-')) return 'Partners — ISVs & ecosystem'
  if (tag?.startsWith('implementation-partner-named-')) return 'Partners — implementation & accountants'
  return 'Other'
}

export function partnerTagFor(prefix, name) {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${prefix}-${slug}`
}
