# Make.com Scenario Setup Guide

## Overview

DealCoach uses separate Make.com scenarios per call type. Each scenario:
1. Receives a webhook with full deal context + transcript
2. Builds a prompt using the coach config + call-type instructions
3. Calls the Claude API (claude-sonnet-4-20250514)
4. Parses the JSON response
5. Writes results back to Supabase (tasks, contacts, deal_analysis, proposal_insights, ai_response_log)

## Create 8 Scenarios (one per call type)

1. **QDC** — Qualifying Discovery Call
2. **Functional Discovery** — Deep functional requirements
3. **Demo** — Product demonstration
4. **Scoping** — Implementation scoping
5. **Proposal** — Proposal/pricing discussion
6. **Negotiation** — Contract negotiation
7. **Sync** — General sync call
8. **Custom** — Catch-all

Each follows the SAME module flow — just different webhook URLs.

---

## Scenario Flow (5 modules)

### Module 1: Webhook (trigger)
- Type: Custom Webhook
- Copy the webhook URL to your `.env` file as `VITE_WEBHOOK_QDC`, etc.
- The payload contains everything — see "Webhook Payload" section below

### Module 2: Claude API Call (HTTP)
- Type: HTTP > Make a Request
- URL: `https://api.anthropic.com/v1/messages`
- Method: POST
- Headers:
  - `Content-Type`: `application/json`
  - `x-api-key`: Your Anthropic API key
  - `anthropic-version`: `2023-06-01`
- Body type: Raw > JSON
- Body:
```json
{
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 4096,
  "temperature": {{1.ai_temperature}},
  "system": "{{1.system_prompt}}",
  "messages": [
    {
      "role": "user",
      "content": "CALL TYPE: {{1.call_type}}\n\nCALL INSTRUCTIONS:\n{{1.call_type_prompt}}\n\nEXTRACTION RULES:\n{{1.extraction_rules}}\n\nREFERENCE DOCS:\n{{1.coach_documents}}\n\n## DEAL: {{1.company_name}}\nRep: {{1.rep_name}}\nStage: {{1.deal_stage}} | Forecast: {{1.forecast_category}}\nValue: ${{1.deal_value}} | CMRR: ${{1.cmrr}}/mo\nClose: {{1.target_close_date}}\nNext Steps: {{1.current_next_steps}}\n\n### Company\nIndustry: {{1.company_industry}}\nRevenue: {{1.company_revenue}}\nEmployees: {{1.company_employees}}\nTech: {{1.company_tech_stack}}\nGoals: {{1.company_business_goals}}\nPriorities: {{1.company_business_priorities}}\n\n### Analysis\nPain: {{1.analysis_pain_points}}\nQuantified: {{1.analysis_quantified_pain}}\nImpact: {{1.analysis_business_impact}}\nChampion: {{1.analysis_champion}}\nEB: {{1.analysis_economic_buyer}}\nBudget: {{1.analysis_budget}}\nCriteria: {{1.analysis_decision_criteria}}\nProcess: {{1.analysis_decision_process}}\nTimeline: {{1.analysis_timeline_drivers}}\nIntegrations: {{1.analysis_integrations}}\nExec Alignment: {{1.analysis_exec_alignment}}\nRED FLAGS: {{1.analysis_red_flags}}\nGREEN FLAGS: {{1.analysis_green_flags}}\n\n### Contacts\n{{1.contacts}}\n\n### Competition\n{{1.competitors}}\n\n### Compelling Events\n{{1.compelling_events}}\n\n### Previous Calls\n{{1.previous_calls}}\n\n### Open Tasks (DO NOT duplicate)\n{{1.open_tasks}}\n\n### Known Insights (avoid duplicating)\n{{1.existing_insights}}\n\n### MSP Status\n{{1.msp_stages}}\n{{1.msp_milestones}}\n\n## TRANSCRIPT\n{{1.transcript}}\n\n## OUTPUT: Respond with ONLY valid JSON.\n{\"summary\":\"2-4 sentences with context\",\"coaching_notes\":\"methodology-based coaching\",\"tasks\":[{\"title\":\"..\",\"priority\":\"high|medium|low\",\"category\":\"Follow Up|Internal|Send Materials|Deal Action|CRM Update|Research\",\"due_days\":3,\"is_blocking\":false}],\"contacts_mentioned\":[{\"name\":\"..\",\"title\":\"..\",\"role_in_deal\":\"..\",\"department\":\"..\",\"is_champion\":false,\"is_economic_buyer\":false,\"is_signer\":false,\"influence_level\":\"high|medium|low\",\"priorities\":\"..\",\"communication_style\":\"..\"}],\"deal_updates\":{\"pain_points\":\"cumulative or null\",\"quantified_pain\":\"or null\",\"business_impact\":\"or null\",\"budget\":\"or null\",\"champion\":\"or null\",\"economic_buyer\":\"or null\",\"red_flags\":\"cumulative or null\",\"green_flags\":\"cumulative or null\",\"timeline_drivers\":\"or null\",\"decision_criteria\":\"or null\",\"decision_process\":\"or null\",\"integrations_needed\":\"or null\",\"exec_alignment\":\"or null\"},\"proposal_insights\":[{\"insight_type\":\"pain|value_driver|requirement|objection|risk\",\"primary_text\":\"..\",\"impact_text\":\"..\",\"speaker_name\":\"..\"}],\"next_steps_suggestion\":\"JP MM/DD - RED/GREEN reasoning, next call, RISK:\",\"score_suggestions\":{\"fit_score\":null,\"deal_health_score\":null}}"
    }
  ]
}
```

### Module 3: Parse JSON (Tools)
- Type: Tools > Parse JSON
- JSON String: `{{2.data.content[].text}}`
- Data structure: Create from the expected response format below

### Module 4: Write to Supabase (HTTP — multiple requests)

**4a. Update conversation:**
- PUT to `{{1.supabase_url}}/rest/v1/conversations?id=eq.{{1.conversation_id}}`
- Headers: `apikey: {{1.supabase_key}}`, `Authorization: Bearer {{1.supabase_key}}`, `Content-Type: application/json`, `Prefer: return=minimal`
- Body:
```json
{
  "ai_summary": "{{3.summary}}",
  "ai_coaching_notes": "{{3.coaching_notes}}",
  "processed": true,
  "tasks_extracted": true,
  "tasks_extracted_at": "{{now}}"
}
```

**4b. Insert tasks (use Iterator on `{{3.tasks}}`):**
- POST to `{{1.supabase_url}}/rest/v1/tasks`
- Body per task:
```json
{
  "deal_id": "{{1.deal_id}}",
  "conversation_id": "{{1.conversation_id}}",
  "title": "{{iterator.title}}",
  "priority": "{{iterator.priority}}",
  "owner": "{{iterator.category}}",
  "due_date": "{{addDays(now; iterator.due_days)}}",
  "auto_generated": true,
  "is_blocking": {{iterator.is_blocking}},
  "completed": false,
  "source_conversation_id": "{{1.conversation_id}}"
}
```

**4c. Upsert contacts (use Iterator on `{{3.contacts_mentioned}}`):**
- For each contact, first GET to check if exists, then POST (new) or PATCH (existing)

**4d. Update deal_analysis:**
- PATCH to `{{1.supabase_url}}/rest/v1/deal_analysis?deal_id=eq.{{1.deal_id}}`
- Body: `{{3.deal_updates}}` (only non-null fields)

**4e. Insert proposal_insights (use Iterator on `{{3.proposal_insights}}`):**
- POST to `{{1.supabase_url}}/rest/v1/proposal_insights`
- Body per insight:
```json
{
  "deal_id": "{{1.deal_id}}",
  "insight_type": "{{iterator.insight_type}}",
  "primary_text": "{{iterator.primary_text}}",
  "impact_text": "{{iterator.impact_text}}",
  "speaker_name": "{{iterator.speaker_name}}",
  "source_type": "ai_extracted",
  "conversation_id": "{{1.conversation_id}}",
  "include_in_proposal": true
}
```

**4f. Update scores on deals (if suggested):**
- PATCH to `{{1.supabase_url}}/rest/v1/deals?id=eq.{{1.deal_id}}`
- Body: only include fit_score/deal_health_score if non-null

### Module 5: Log AI Run
- POST to `{{1.supabase_url}}/rest/v1/ai_response_log`
- Body:
```json
{
  "deal_id": "{{1.deal_id}}",
  "conversation_id": "{{1.conversation_id}}",
  "response_type": "transcript_analysis",
  "ai_model_used": "claude-sonnet-4-20250514",
  "status": "completed",
  "processing_time_ms": "{{2.headers.x-request-duration}}",
  "prompt_tokens": {{2.data.usage.input_tokens}},
  "completion_tokens": {{2.data.usage.output_tokens}},
  "total_tokens": {{2.data.usage.input_tokens + 2.data.usage.output_tokens}}
}
```

---

## Expected Claude JSON Response Format

```json
{
  "summary": "2-4 sentence summary referencing previous call context and what's new",
  "coaching_notes": "Specific BANT/Selling Through Curiosity coaching observations",
  "tasks": [
    {
      "title": "Send multi-entity case study to CFO",
      "priority": "high",
      "category": "Send Materials",
      "due_days": 3,
      "is_blocking": false
    }
  ],
  "contacts_mentioned": [
    {
      "name": "Sarah Chen",
      "title": "Controller",
      "role_in_deal": "Champion",
      "department": "Finance",
      "is_champion": true,
      "is_economic_buyer": false,
      "is_signer": false,
      "influence_level": "high",
      "priorities": "Rev rec compliance",
      "communication_style": "Detail-oriented"
    }
  ],
  "deal_updates": {
    "pain_points": "Cumulative pain points including new findings",
    "quantified_pain": "$320K annual audit remediation",
    "business_impact": "Cannot pass Q3 audit without automation",
    "budget": "$250-350K approved for FY26",
    "champion": "Sarah Chen, Controller",
    "economic_buyer": "Mike Torres, CFO",
    "red_flags": "Previous NetSuite bias, competitor SC still engaged",
    "green_flags": "Strong champion, complex rev rec is our sweet spot",
    "timeline_drivers": "Audit deadline Q3 2026",
    "decision_criteria": "Rev rec automation, 3PL billing, real-time visibility",
    "decision_process": null,
    "integrations_needed": "Salesforce CRM, warehouse management system",
    "exec_alignment": null
  },
  "proposal_insights": [
    {
      "insight_type": "pain",
      "primary_text": "Manual revenue recognition across 3PL contracts",
      "impact_text": "$320K in audit remediation costs last year",
      "speaker_name": "Sarah Chen"
    },
    {
      "insight_type": "value_driver",
      "primary_text": "Automated ASC 606 compliance",
      "impact_text": "Eliminates audit risk and reduces close cycle by 10 days",
      "speaker_name": "Mike Torres"
    }
  ],
  "next_steps_suggestion": "JP 03/20 - GREEN strong champ, 03/25 func discovery, 03/18 QDC, RISK: incumbent NetSuite bias",
  "score_suggestions": {
    "fit_score": 8,
    "deal_health_score": 6
  }
}
```

---

## Quick Setup Checklist

1. [ ] Create Make.com account (if not already)
2. [ ] Create 8 scenarios (one per call type) — or start with just QDC
3. [ ] In each: Add Custom Webhook module → copy URL
4. [ ] Paste URLs into `.env` file
5. [ ] Add HTTP module for Claude API call with your Anthropic key
6. [ ] Add JSON Parse module
7. [ ] Add HTTP modules for Supabase writes (tasks, contacts, analysis, insights, log)
8. [ ] Test with a real transcript

**Pro tip:** Build the QDC scenario first, get it working, then duplicate it 7 times and just swap the webhook trigger. The processing logic is identical — the call-type-specific prompt comes from the payload.
