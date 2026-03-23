# DealCoach Chrome Extension

Create deals from any webpage -- auto-extracts company info from Salesforce, LinkedIn, and regular websites.

## Install

1. Chrome -> `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" -> select this `extension/` folder
4. Pin the DealCoach icon in the toolbar

## Salesforce Fields

The extension reads these Salesforce fields automatically:

- **Opportunity**: Name, Account, Amount, Close Date, Stage, Description, Next Step
- **Account**: Name, Website, Industry, Revenue, Employees, Phone, Address
- **Contact**: Name, Title, Email, Phone

To add custom Salesforce fields, edit `SFDC_FIELD_MAP` in `content.js`:

```js
const SFDC_FIELD_MAP = {
  'Opportunity.Custom_Field__c': 'notes',  // Add your custom fields here
}
```

## Stage Mapping

Salesforce stages are automatically mapped to DealCoach stages:

| Salesforce Stage | DealCoach Stage |
|---|---|
| Prospecting / Qualification | Qualify |
| Needs Analysis | Discovery |
| Value Proposition / Id. Decision Makers | Solution Validation |
| Perception Analysis | Confirming Value |
| Proposal/Price Quote / Negotiation | Selection |

## Usage

1. Navigate to any page (Salesforce opportunity, LinkedIn profile, company website)
2. Click the DealCoach icon in the Chrome toolbar
3. Review extracted info (green AUTO tags show what was auto-detected)
4. Edit anything you want to change
5. Click "Create Deal"
6. Click "Open in DealCoach" to see the deal with AI research running

## How It Works

- **Salesforce**: Reads Lightning field components using `data-target-selection-name` attributes
- **LinkedIn**: Extracts profile name/title/company or company page info from DOM
- **Any website**: Uses `og:site_name` meta tag, JSON-LD structured data, or page title for company name; extracts website URL and meta description
