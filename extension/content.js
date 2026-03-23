(() => {
  const SFDC_FIELD_MAP = {
    'Opportunity.Name': 'dealName',
    'Opportunity.AccountId': 'companyName',
    'Opportunity.Amount': 'dealValue',
    'Opportunity.CloseDate': 'closeDate',
    'Opportunity.StageName': 'stage',
    'Opportunity.Probability': 'probability',
    'Opportunity.Description': 'notes',
    'Opportunity.NextStep': 'nextSteps',
    'Opportunity.Type': 'dealType',
    'Opportunity.LeadSource': 'leadSource',
    'Opportunity.SBQQ__PrimaryQuote__c': 'quoteId',
    'Account.Name': 'companyName',
    'Account.Website': 'website',
    'Account.Industry': 'industry',
    'Account.AnnualRevenue': 'revenue',
    'Account.NumberOfEmployees': 'employees',
    'Account.Phone': 'phone',
    'Account.BillingCity': 'city',
    'Account.BillingState': 'state',
    'Contact.Name': 'contactName',
    'Contact.Title': 'contactTitle',
    'Contact.Email': 'contactEmail',
    'Contact.Phone': 'contactPhone',
    'Contact.Account.Name': 'companyName',
  }

  const SFDC_STAGE_MAP = {
    'Prospecting': 'qualify',
    'Qualification': 'qualify',
    'Needs Analysis': 'discovery',
    'Value Proposition': 'solution_validation',
    'Id. Decision Makers': 'solution_validation',
    'Perception Analysis': 'confirming_value',
    'Proposal/Price Quote': 'selection',
    'Negotiation/Review': 'selection',
    'Closed Won': 'closed_won',
    'Closed Lost': 'closed_lost',
  }

  function detectPageType() {
    const host = window.location.hostname
    if (host.includes('salesforce.com') || host.includes('force.com') || host.includes('lightning.force.com')) return 'salesforce'
    if (host.includes('linkedin.com')) return 'linkedin'
    return 'generic'
  }

  function extractSalesforce() {
    const result = { source: 'salesforce', sourceDetail: '', fields: {} }
    const url = window.location.pathname
    if (url.includes('/Opportunity/')) result.sourceDetail = 'opportunity'
    else if (url.includes('/Account/')) result.sourceDetail = 'account'
    else if (url.includes('/Contact/')) result.sourceDetail = 'contact'
    else if (url.includes('/Lead/')) result.sourceDetail = 'lead'

    for (const [sfdcField, dcField] of Object.entries(SFDC_FIELD_MAP)) {
      const el = document.querySelector(`[data-target-selection-name="sfdc:RecordField.${sfdcField}"]`)
      if (el) {
        const valueEl = el.querySelector('.slds-form-element__static') ||
          el.querySelector('lightning-formatted-text') ||
          el.querySelector('lightning-formatted-number') ||
          el.querySelector('lightning-formatted-url') ||
          el.querySelector('lightning-formatted-email') ||
          el.querySelector('lightning-formatted-phone') ||
          el.querySelector('a') ||
          el.querySelector('.test-id__field-value')
        if (valueEl) {
          let val = valueEl.textContent?.trim()
          if (dcField === 'dealValue' || dcField === 'revenue') val = val.replace(/[^0-9.-]/g, '')
          if (dcField === 'employees') val = val.replace(/[^0-9]/g, '')
          if (val && val !== '--' && val !== '-' && val.length > 0) result.fields[dcField] = val
        }
      }
    }

    if (!result.fields.companyName) {
      const headerTitle = document.querySelector('.slds-page-header__title') ||
        document.querySelector('records-entity-label') ||
        document.querySelector('.entityNameTitle')
      if (headerTitle) result.fields.companyName = headerTitle.textContent.trim()
    }
    if (!result.fields.companyName) {
      const highlights = document.querySelector('.highlights-container .primaryField') ||
        document.querySelector('[data-target-selection-name*="Name"] .slds-form-element__static')
      if (highlights) result.fields.companyName = highlights.textContent.trim()
    }
    const breadcrumbs = document.querySelectorAll('.slds-breadcrumb__item a')
    if (breadcrumbs.length >= 1 && !result.fields.companyName) {
      result.fields.companyName = breadcrumbs[0].textContent.trim()
    }

    if (result.fields.stage) {
      const mapped = SFDC_STAGE_MAP[result.fields.stage]
      result.fields.stageOriginal = result.fields.stage
      if (mapped) result.fields.stage = mapped
    }

    const contactCards = document.querySelectorAll('[data-target-selection-name*="Contact"] .slds-tile')
    if (contactCards.length > 0) {
      result.fields.relatedContacts = []
      contactCards.forEach(card => {
        const name = card.querySelector('a')?.textContent?.trim()
        const title = card.querySelector('.slds-tile__detail span')?.textContent?.trim()
        if (name) result.fields.relatedContacts.push({ name, title })
      })
    }

    if (!result.fields.website) {
      const websiteEl = document.querySelector('lightning-formatted-url a')
      if (websiteEl) result.fields.website = websiteEl.href || websiteEl.textContent?.trim()
    }

    return result
  }

  function extractLinkedIn() {
    const result = { source: 'linkedin', sourceDetail: '', fields: {} }
    const url = window.location.pathname

    if (url.includes('/in/')) {
      result.sourceDetail = 'profile'
      const nameEl = document.querySelector('h1.text-heading-xlarge') || document.querySelector('.pv-top-card h1')
      if (nameEl) result.fields.contactName = nameEl.textContent.trim()
      const titleEl = document.querySelector('.text-body-medium.break-words') || document.querySelector('.pv-top-card--experience-list')
      if (titleEl) result.fields.contactTitle = titleEl.textContent.trim()
      const expSection = document.querySelector('#experience ~ .pvs-list__container') || document.querySelector('.experience-section')
      if (expSection) {
        const companyEl = expSection.querySelector('.t-bold span') || expSection.querySelector('.pv-entity__secondary-title')
        if (companyEl) result.fields.companyName = companyEl.textContent.trim()
      }
      if (!result.fields.companyName) {
        const headline = document.querySelector('.text-body-medium.break-words')
        if (headline) {
          const parts = headline.textContent.split(' at ')
          if (parts.length > 1) result.fields.companyName = parts[parts.length - 1].trim()
        }
      }
    } else if (url.includes('/company/')) {
      result.sourceDetail = 'company'
      const nameEl = document.querySelector('h1.org-top-card-summary__title') || document.querySelector('.org-top-card h1')
      if (nameEl) result.fields.companyName = nameEl.textContent.trim()
      const industryEl = document.querySelector('.org-top-card-summary-info-list__info-item')
      if (industryEl) result.fields.industry = industryEl.textContent.trim()
      const sizeEl = document.querySelectorAll('.org-top-card-summary-info-list__info-item')
      if (sizeEl.length > 1) result.fields.employees = sizeEl[1].textContent.trim()
      const aboutEl = document.querySelector('.org-top-card-summary__tagline')
      if (aboutEl) result.fields.description = aboutEl.textContent.trim()
      const websiteEl = document.querySelector('.org-top-card-primary-actions a[href*="http"]')
      if (websiteEl) result.fields.website = websiteEl.href
    }

    return result
  }

  function extractGeneric() {
    const result = { source: 'generic', sourceDetail: window.location.hostname.replace('www.', ''), fields: {} }

    const ogSiteName = document.querySelector('meta[property="og:site_name"]')
    if (ogSiteName) result.fields.companyName = ogSiteName.content

    if (!result.fields.companyName) {
      const ldScripts = document.querySelectorAll('script[type="application/ld+json"]')
      ldScripts.forEach(s => {
        try {
          const d = JSON.parse(s.textContent)
          if (d['@type'] === 'Organization' && d.name) result.fields.companyName = d.name
          if (d.publisher?.name && !result.fields.companyName) result.fields.companyName = d.publisher.name
        } catch {}
      })
    }

    if (!result.fields.companyName) {
      result.fields.companyName = document.title.split(/[|\-\u2013\u2014:]/)[0].replace(/home|welcome to|official site/gi, '').trim()
    }

    if (!result.fields.companyName || result.fields.companyName.length < 2) {
      const hostname = window.location.hostname.replace('www.', '')
      result.fields.companyName = hostname.split('.')[0]
      result.fields.companyName = result.fields.companyName.charAt(0).toUpperCase() + result.fields.companyName.slice(1)
    }

    result.fields.website = window.location.origin

    const metaDesc = document.querySelector('meta[name="description"]')?.content || document.querySelector('meta[property="og:description"]')?.content
    if (metaDesc) result.fields.description = metaDesc.substring(0, 500)

    const bodyText = document.body?.innerText || ''
    const emailMatch = bodyText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)
    if (emailMatch) result.fields.contactEmail = emailMatch[0]

    return result
  }

  function extractPageData() {
    const pageType = detectPageType()
    switch (pageType) {
      case 'salesforce': return extractSalesforce()
      case 'linkedin': return extractLinkedIn()
      default: return extractGeneric()
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_PAGE_DATA') {
      sendResponse(extractPageData())
    }
  })
})()
