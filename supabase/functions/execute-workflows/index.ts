// RECOVERED 2026-06-11 from the deployed function (v2) via the Management
// API — this function had no source in the repo and was one redeploy away
// from being lost. Byte-exact copy of what is running in production.
// NOTE: validates no callers today; the cron already sends x-cron-secret
// if a gate gets added (see CLAUDE.md cron pattern).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
// execute-workflows v1
// The Revenue Instruments workflow runtime engine.
//
// THREE MODES:
// 1. TRIGGER — new platform event fires, evaluate + start matching workflows
// 2. RESUME  — a waiting instance's event arrives, continue execution
// 3. TICK    — cron-driven: advance delay timeouts + handle event timeouts
//
// Called from: process-transcript, deal stage change handler, inbound-webhook,
//              api-gateway, cron job (every 5 min)
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
  };
}
function jr(d, s = 200) {
  return new Response(JSON.stringify(d), {
    status: s,
    headers: {
      ...cors(),
      'Content-Type': 'application/json'
    }
  });
}
// ─── Main handler ────────────────────────────────────────────────────────────
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response('ok', {
    headers: cors()
  });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const body = await req.json();
    const mode = body.mode || 'trigger'; // 'trigger' | 'resume' | 'tick'
    if (mode === 'tick') return await processTick(sb);
    if (mode === 'resume') return await resumeInstance(sb, body.instance_id, body.event_data || {});
    return await processTrigger(sb, body);
  } catch (e) {
    console.error('execute-workflows error:', e);
    return jr({
      error: `v1: ${e.message}`
    }, 500);
  }
});
// ─── TRIGGER: find matching workflows and start instances ─────────────────────
async function processTrigger(sb, body) {
  const { org_id, deal_id, trigger_event, trigger_data = {}, triggered_by = 'platform_event', trigger_source = 'internal' } = body;
  if (!org_id || !trigger_event) return jr({
    error: 'v1: org_id and trigger_event required'
  }, 400);
  // Load active workflows matching this trigger
  const { data: workflows } = await sb.from('org_workflows').select('*').eq('org_id', org_id).eq('is_active', true).eq('trigger_event', trigger_event);
  if (!workflows?.length) return jr({
    triggered: 0,
    message: 'No matching workflows'
  });
  // Load deal context if deal_id provided
  let dealContext = {};
  if (deal_id) dealContext = await loadDealContext(sb, deal_id);
  const results = [];
  for (const wf of workflows){
    // Evaluate trigger conditions
    const condsMet = evaluateConditions(wf.trigger_conditions || [], {
      ...trigger_data,
      ...dealContext
    });
    if (!condsMet) {
      results.push({
        workflow_id: wf.id,
        status: 'skipped',
        reason: 'conditions_not_met'
      });
      continue;
    }
    // Find trigger step
    const steps = wf.steps || [];
    const triggerStep = steps.find((s)=>s.type === 'trigger');
    if (!triggerStep) {
      results.push({
        workflow_id: wf.id,
        status: 'skipped',
        reason: 'no_trigger_step'
      });
      continue;
    }
    // Create instance
    const initialContext = {
      ...trigger_data,
      ...dealContext,
      _trigger_event: trigger_event,
      _triggered_at: new Date().toISOString()
    };
    const { data: instance } = await sb.from('workflow_instances').insert({
      workflow_id: wf.id,
      deal_id: deal_id || null,
      org_id,
      triggered_by,
      trigger_source,
      trigger_data,
      status: 'running',
      current_step_id: triggerStep.next || null,
      context: initialContext
    }).select().single();
    if (!instance) {
      results.push({
        workflow_id: wf.id,
        status: 'failed',
        reason: 'instance_creation_failed'
      });
      continue;
    }
    // Increment trigger count
    await sb.from('org_workflows').update({
      trigger_count: (wf.trigger_count || 0) + 1,
      last_triggered_at: new Date().toISOString()
    }).eq('id', wf.id);
    // Execute from first real step
    if (triggerStep.next) {
      const execResult = await executeFromStep(sb, instance, steps, triggerStep.next);
      results.push({
        workflow_id: wf.id,
        instance_id: instance.id,
        ...execResult
      });
    } else {
      await sb.from('workflow_instances').update({
        status: 'completed',
        completed_at: new Date().toISOString()
      }).eq('id', instance.id);
      results.push({
        workflow_id: wf.id,
        instance_id: instance.id,
        status: 'completed'
      });
    }
  }
  return jr({
    triggered: results.filter((r)=>r.status !== 'skipped').length,
    skipped: results.filter((r)=>r.status === 'skipped').length,
    results
  });
}
// ─── RESUME: continue a waiting instance when its event arrives ───────────────
async function resumeInstance(sb, instanceId, eventData) {
  const { data: instance } = await sb.from('workflow_instances').select('*').eq('id', instanceId).single();
  if (!instance || instance.status !== 'waiting') return jr({
    error: 'Instance not found or not waiting'
  }, 404);
  const { data: wf } = await sb.from('org_workflows').select('steps').eq('id', instance.workflow_id).single();
  if (!wf) return jr({
    error: 'Workflow not found'
  }, 404);
  const steps = wf.steps || [];
  const waitStep = steps.find((s)=>s.id === instance.current_step_id);
  if (!waitStep) return jr({
    error: 'Wait step not found'
  }, 404);
  // Check conditions on the incoming event
  const condsMet = evaluateConditions(instance.waiting_for_conditions || [], eventData);
  if (!condsMet) return jr({
    resumed: false,
    reason: 'conditions_not_met'
  });
  // Update context with event data, clear waiting state
  const updatedContext = {
    ...instance.context,
    ...eventData,
    [`_resumed_at_${waitStep.id}`]: new Date().toISOString()
  };
  const updatedInstance = {
    ...instance,
    context: updatedContext,
    status: 'running',
    waiting_for_event: null,
    wait_until: null
  };
  await sb.from('workflow_instances').update({
    status: 'running',
    context: updatedContext,
    waiting_for_event: null,
    wait_until: null
  }).eq('id', instanceId);
  if (waitStep.next) {
    const execResult = await executeFromStep(sb, updatedInstance, steps, waitStep.next);
    return jr({
      resumed: true,
      ...execResult
    });
  }
  await sb.from('workflow_instances').update({
    status: 'completed',
    completed_at: new Date().toISOString()
  }).eq('id', instanceId);
  return jr({
    resumed: true,
    status: 'completed'
  });
}
// ─── TICK: advance timeouts (called by cron every 5 min) ─────────────────────
async function processTick(sb) {
  const now = new Date().toISOString();
  let advanced = 0, timedOut = 0;
  // Advance delay steps whose wait_until has passed
  const { data: delayedInstances } = await sb.from('workflow_instances').select('*').eq('status', 'waiting').not('wait_until', 'is', null).lte('wait_until', now).limit(50);
  for (const inst of delayedInstances || []){
    const { data: wf } = await sb.from('org_workflows').select('steps').eq('id', inst.workflow_id).single();
    if (!wf) continue;
    const steps = wf.steps || [];
    const delayStep = steps.find((s)=>s.id === inst.current_step_id);
    if (!delayStep?.next) continue;
    await sb.from('workflow_instances').update({
      status: 'running',
      wait_until: null
    }).eq('id', inst.id);
    const updatedInst = {
      ...inst,
      status: 'running',
      wait_until: null
    };
    await executeFromStep(sb, updatedInst, steps, delayStep.next);
    advanced++;
  }
  // Handle timed-out wait_for_event steps
  const { data: timedOutInstances } = await sb.from('workflow_instances').select('*').eq('status', 'waiting').not('timeout_at', 'is', null).lte('timeout_at', now).limit(50);
  for (const inst of timedOutInstances || []){
    const { data: wf } = await sb.from('org_workflows').select('steps').eq('id', inst.workflow_id).single();
    if (!wf) continue;
    const steps = wf.steps || [];
    const timeoutStepId = inst.timeout_step_id;
    if (!timeoutStepId) {
      await sb.from('workflow_instances').update({
        status: 'completed',
        completed_at: now,
        error_message: 'Timed out waiting for event'
      }).eq('id', inst.id);
    } else {
      await sb.from('workflow_instances').update({
        status: 'running',
        timeout_at: null,
        waiting_for_event: null
      }).eq('id', inst.id);
      const updatedInst = {
        ...inst,
        status: 'running'
      };
      await executeFromStep(sb, updatedInst, steps, timeoutStepId);
    }
    timedOut++;
  }
  // Handle stalled deal monitor (time_in_stage workflows)
  await checkStalledDeals(sb);
  return jr({
    tick: true,
    delay_advanced: advanced,
    timeouts_handled: timedOut
  });
}
// ─── Core execution engine ───────────────────────────────────────────────────
async function executeFromStep(sb, instance, steps, stepId, maxSteps = 20) {
  let currentStepId = stepId;
  let context = {
    ...instance.context
  };
  let stepsExecuted = 0;
  while(currentStepId && stepsExecuted < maxSteps){
    const step = steps.find((s)=>s.id === currentStepId);
    if (!step) break;
    stepsExecuted++;
    const stepStart = Date.now();
    // Update current step on instance
    await sb.from('workflow_instances').update({
      current_step_id: currentStepId,
      step_count: (instance.step_count || 0) + stepsExecuted
    }).eq('id', instance.id);
    try {
      const result = await executeStep(sb, instance, step, context);
      // Log step run
      await sb.from('workflow_step_runs').insert({
        instance_id: instance.id,
        workflow_id: instance.workflow_id,
        deal_id: instance.deal_id,
        org_id: instance.org_id,
        step_id: step.id,
        step_type: step.type,
        input_context: context,
        output_context: result.context,
        branch_taken: result.branch || null,
        ai_reasoning: result.ai_reasoning || null,
        status: result.status || 'success',
        error_message: result.error || null,
        duration_ms: Date.now() - stepStart
      });
      if (result.status === 'waiting') {
        // Pause instance — waiting for an external event or delay
        await sb.from('workflow_instances').update({
          status: 'waiting',
          context: result.context,
          waiting_for_event: result.waiting_for_event || null,
          waiting_for_conditions: result.waiting_for_conditions || null,
          wait_until: result.wait_until || null,
          timeout_at: result.timeout_at || null,
          timeout_step_id: result.timeout_step_id || null
        }).eq('id', instance.id);
        return {
          status: 'waiting',
          steps_executed: stepsExecuted,
          waiting_for: result.waiting_for_event
        };
      }
      if (result.status === 'failed') {
        await sb.from('workflow_instances').update({
          status: 'failed',
          error_message: result.error,
          completed_at: new Date().toISOString()
        }).eq('id', instance.id);
        return {
          status: 'failed',
          steps_executed: stepsExecuted
        };
      }
      context = {
        ...context,
        ...result.context
      };
      currentStepId = result.next || null;
    } catch (e) {
      console.error(`Step ${step.id} error:`, e);
      await sb.from('workflow_step_runs').insert({
        instance_id: instance.id,
        workflow_id: instance.workflow_id,
        deal_id: instance.deal_id,
        org_id: instance.org_id,
        step_id: step.id,
        step_type: step.type,
        status: 'failed',
        error_message: e.message,
        duration_ms: Date.now() - stepStart
      });
      await sb.from('workflow_instances').update({
        status: 'failed',
        error_message: e.message,
        completed_at: new Date().toISOString()
      }).eq('id', instance.id);
      return {
        status: 'failed',
        steps_executed: stepsExecuted
      };
    }
  }
  // All steps completed
  await sb.from('workflow_instances').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    context
  }).eq('id', instance.id);
  // Fire outbound webhooks for workflow.completed
  await deliverWebhookEvent(sb, instance.org_id, 'workflow.completed', {
    workflow_id: instance.workflow_id,
    deal_id: instance.deal_id,
    steps_executed: stepsExecuted,
    context
  });
  return {
    status: 'completed',
    steps_executed: stepsExecuted
  };
}
// ─── Step executors ──────────────────────────────────────────────────────────
async function executeStep(sb, instance, step, context) {
  switch(step.type){
    case 'condition':
      {
        const met = evaluateConditions([
          step.check
        ], context);
        const nextStep = met ? step.if_true : step.if_false;
        return {
          status: 'success',
          context,
          branch: met ? 'true' : 'false',
          next: nextStep
        };
      }
    case 'ai_evaluate':
      {
        const dealContext = instance.deal_id ? await loadDealContext(sb, instance.deal_id) : {};
        const contextSummary = JSON.stringify({
          deal: dealContext,
          workflow_context: context
        }, null, 2).substring(0, 8000);
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 200,
            system: 'You are evaluating a B2B sales deal. Answer with ONLY "yes" or "no" on the first line, then a one-sentence reason on the second line.',
            messages: [
              {
                role: 'user',
                content: `Deal context:\n${contextSummary}\n\nQuestion: ${step.question}`
              }
            ]
          })
        });
        const data = await resp.json();
        const text = (data.content?.[0]?.text || '').toLowerCase().trim();
        const answer = text.startsWith('yes') ? 'yes' : 'no';
        const reasoning = text.split('\n').slice(1).join(' ').trim();
        const nextStep = answer === 'yes' ? step.if_yes : step.if_no;
        return {
          status: 'success',
          context: {
            ...context,
            [`_ai_${step.id}`]: answer
          },
          branch: answer,
          ai_reasoning: reasoning,
          next: nextStep
        };
      }
    case 'wait_for_event':
      {
        const timeoutAt = step.timeout_days ? new Date(Date.now() + step.timeout_days * 86400000).toISOString() : null;
        return {
          status: 'waiting',
          context,
          waiting_for_event: step.event,
          waiting_for_conditions: step.conditions || [],
          timeout_at: timeoutAt,
          timeout_step_id: step.on_timeout || null,
          next: step.next
        };
      }
    case 'delay':
      {
        const units = {
          minutes: 60000,
          hours: 3600000,
          days: 86400000
        };
        const waitUntil = new Date(Date.now() + (step.amount || 1) * (units[step.unit || 'days'] || 86400000)).toISOString();
        return {
          status: 'waiting',
          context,
          wait_until: waitUntil,
          next: step.next
        };
      }
    case 'action':
      {
        const result = await executeAction(sb, instance, step, context);
        return {
          status: 'success',
          context: {
            ...context,
            ...result
          },
          next: step.next
        };
      }
    case 'crm_push':
      {
        // Placeholder — full CRM push implemented when Salesforce integration is built
        console.log(`CRM push to ${step.integration}:`, step.operation, step.field_mappings);
        return {
          status: 'success',
          context: {
            ...context,
            [`_crm_push_${step.id}`]: 'queued'
          },
          next: step.next
        };
      }
    case 'crm_activity':
      {
        console.log(`CRM activity log to ${step.integration}`);
        return {
          status: 'success',
          context,
          next: step.next
        };
      }
    case 'webhook':
      {
        if (step.url) {
          try {
            const payload = interpolate(step.payload_template || {}, context);
            await fetch(step.url, {
              method: step.method || 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...step.headers || {}
              },
              body: JSON.stringify(payload)
            });
          } catch (e) {
            console.error('Webhook step error:', e);
          }
        }
        return {
          status: 'success',
          context,
          next: step.next
        };
      }
    default:
      return {
        status: 'success',
        context,
        next: step.next
      };
  }
}
// ─── Action executor ──────────────────────────────────────────────────────────
async function executeAction(sb, instance, step, context) {
  const { action_type, params = {} } = step;
  const dealId = instance.deal_id;
  const orgId = instance.org_id;
  // Interpolate any {{variable}} tokens in params
  const p = interpolate(params, context);
  switch(action_type){
    case 'update_deal_stage':
      if (dealId && p.stage) {
        await sb.from('deals').update({
          stage: p.stage,
          updated_at: new Date().toISOString()
        }).eq('id', dealId);
        await deliverWebhookEvent(sb, orgId, 'deal.stage_changed', {
          deal_id: dealId,
          new_stage: p.stage
        });
      }
      return {
        _stage_updated: p.stage
      };
    case 'update_forecast_category':
      if (dealId && p.category) {
        await sb.from('deals').update({
          forecast_category: p.category
        }).eq('id', dealId);
      }
      return {
        _forecast_updated: p.category
      };
    case 'update_deal_field':
      if (dealId && p.field && p.value !== undefined) {
        await sb.from('deals').update({
          [p.field]: p.value
        }).eq('id', dealId);
      }
      return {
        _field_updated: p.field
      };
    case 'create_task':
      {
        if (dealId) {
          const dueDate = p.due_in_days != null ? new Date(Date.now() + p.due_in_days * 86400000).toISOString().split('T')[0] : null;
          await sb.from('tasks').insert({
            deal_id: dealId,
            title: p.title || 'Workflow task',
            priority: p.priority || 'medium',
            notes: p.notes || null,
            due_date: dueDate,
            auto_generated: true,
            owner: p.owner || null
          });
        }
        return {
          _task_created: p.title
        };
      }
    case 'add_flag':
      if (dealId) {
        await sb.from('deal_flags').insert({
          deal_id: dealId,
          flag_type: p.flag_type || 'red',
          description: p.description || 'Workflow flag',
          category: p.category || 'custom',
          source: 'workflow',
          source_workflow_id: instance.workflow_id
        });
      }
      return {
        _flag_added: p.description
      };
    case 'add_risk':
      if (dealId) {
        await sb.from('deal_risks').insert({
          deal_id: dealId,
          risk_description: p.risk_description || 'Workflow risk',
          severity: p.severity || 'medium',
          category: 'custom',
          source: 'workflow',
          status: 'open'
        });
      }
      return {
        _risk_added: p.risk_description
      };
    case 'notify_rep':
    case 'notify_admin':
    case 'send_notification':
      {
        // Write to a notifications table or fire webhook
        // For now, log it — notifications UI to be built
        console.log(`Notification [${action_type}]:`, p.message, '| deal:', dealId);
        // Deliver as webhook event so external systems can handle it
        await deliverWebhookEvent(sb, orgId, 'notification.sent', {
          deal_id: dealId,
          message: p.message,
          type: action_type
        });
        return {
          _notification_sent: p.message
        };
      }
    case 'research_company':
      if (dealId) {
        // Fire research-company edge function async
        fetch(`${SUPABASE_URL}/functions/v1/research-company`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SERVICE_KEY}`,
            apikey: SERVICE_KEY
          },
          body: JSON.stringify({
            deal_id: dealId
          })
        }).catch((e)=>console.error('research-company fire error:', e));
      }
      return {
        _research_triggered: true
      };
    case 'generate_pre_call_brief':
      if (dealId) {
        // Fire deal-chat with coaching context
        fetch(`${SUPABASE_URL}/functions/v1/deal-chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SERVICE_KEY}`,
            apikey: SERVICE_KEY
          },
          body: JSON.stringify({
            deal_id: dealId,
            org_id: orgId,
            context_type: 'coaching',
            message: p.prompt || 'Generate a concise pre-call brief with: key business context, likely pain points, recommended discovery questions, and competitive considerations.',
            save_to_deal: true
          })
        }).catch((e)=>console.error('deal-chat fire error:', e));
      }
      return {
        _brief_triggered: true
      };
    default:
      console.log(`Unknown action_type: ${action_type}`);
      return {};
  }
}
// ─── Condition evaluator ─────────────────────────────────────────────────────
function evaluateConditions(conditions, context) {
  if (!conditions?.length) return true;
  return conditions.every((cond)=>{
    const val = getNestedField(context, cond.field);
    switch(cond.op){
      case 'eq':
        return String(val) === String(cond.value);
      case 'neq':
        return String(val) !== String(cond.value);
      case 'gte':
        return Number(val) >= Number(cond.value);
      case 'lte':
        return Number(val) <= Number(cond.value);
      case 'gt':
        return Number(val) > Number(cond.value);
      case 'lt':
        return Number(val) < Number(cond.value);
      case 'contains':
        return String(val).toLowerCase().includes(String(cond.value).toLowerCase());
      case 'not_contains':
        return !String(val).toLowerCase().includes(String(cond.value).toLowerCase());
      case 'is_null':
        return val == null;
      case 'is_not_null':
        return val != null;
      case 'in':
        return Array.isArray(cond.value) ? cond.value.includes(val) : false;
      default:
        return true;
    }
  });
}
// ─── Context helpers ──────────────────────────────────────────────────────────
function getNestedField(obj, path) {
  return path.split('.').reduce((o, k)=>o && o[k] !== undefined ? o[k] : null, obj);
}
function interpolate(template, context) {
  if (typeof template === 'string') {
    return template.replace(/\{\{([^}]+)\}\}/g, (_, path)=>{
      const val = getNestedField(context, path.trim());
      return val != null ? String(val) : '';
    });
  }
  if (Array.isArray(template)) return template.map((v)=>interpolate(v, context));
  if (template && typeof template === 'object') {
    return Object.fromEntries(Object.entries(template).map(([k, v])=>[
        k,
        interpolate(v, context)
      ]));
  }
  return template;
}
// ─── Deal context loader ──────────────────────────────────────────────────────
async function loadDealContext(sb, dealId) {
  try {
    const { data: deal } = await sb.from('deals').select('company_name,stage,forecast_category,deal_value,fit_score,deal_health_score,target_close_date,rep_id').eq('id', dealId).single();
    const { data: profile } = await sb.from('company_profile').select('industry,employee_count').eq('deal_id', dealId).single();
    const { data: convs } = await sb.from('conversations').select('id').eq('deal_id', dealId).eq('processed', true);
    const { data: flags } = await sb.from('deal_flags').select('flag_type,description').eq('deal_id', dealId).eq('resolved', false).limit(5);
    return {
      deal: deal || {},
      company: {
        industry: profile?.industry,
        employee_count: profile?.employee_count
      },
      transcript_count: convs?.length || 0,
      call_type: deal?.stage || null,
      deal_stage: deal?.stage || null,
      deal_value: deal?.deal_value || 0,
      deal_health_score: deal?.deal_health_score || 0,
      fit_score: deal?.fit_score || 0,
      flags: flags || []
    };
  } catch (e) {
    console.error('loadDealContext error:', e);
    return {};
  }
}
// ─── Outbound webhook delivery ────────────────────────────────────────────────
async function deliverWebhookEvent(sb, orgId, eventType, payload) {
  try {
    const { data: subs } = await sb.from('webhook_subscriptions').select('id,url,secret,headers').eq('org_id', orgId).eq('is_active', true).contains('events', [
      eventType
    ]);
    if (!subs?.length) return;
    const body = JSON.stringify({
      event: eventType,
      timestamp: new Date().toISOString(),
      data: payload
    });
    for (const sub of subs){
      const start = Date.now();
      try {
        const resp = await fetch(sub.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-RI-Event': eventType,
            ...sub.headers || {}
          },
          body
        });
        await sb.from('webhook_deliveries').insert({
          subscription_id: sub.id,
          org_id: orgId,
          event_type: eventType,
          payload,
          response_status: resp.status,
          duration_ms: Date.now() - start,
          delivered_at: resp.ok ? new Date().toISOString() : null,
          error_message: resp.ok ? null : `HTTP ${resp.status}`
        });
        if (resp.ok) {
          await sb.from('webhook_subscriptions').update({
            last_success_at: new Date().toISOString(),
            failure_count: 0
          }).eq('id', sub.id);
        } else {
          await sb.from('webhook_subscriptions').update({
            last_failure_at: new Date().toISOString(),
            failure_count: sb.rpc('increment')
          }).eq('id', sub.id);
        }
      } catch (e) {
        await sb.from('webhook_deliveries').insert({
          subscription_id: sub.id,
          org_id: orgId,
          event_type: eventType,
          payload,
          error_message: e.message,
          duration_ms: Date.now() - start
        });
      }
    }
  } catch (e) {
    console.error('deliverWebhookEvent error:', e);
  }
}
// ─── Stalled deal monitor (called from tick) ──────────────────────────────────
async function checkStalledDeals(sb) {
  try {
    // Find orgs with stalled deal monitor workflows active
    const { data: workflows } = await sb.from('org_workflows').select('id,org_id,trigger_conditions,steps').eq('is_active', true).eq('trigger_event', 'time_in_stage');
    if (!workflows?.length) return;
    for (const wf of workflows){
      const dayThreshold = wf.trigger_conditions?.find((c)=>c.field === 'days_since_last_activity')?.value || 14;
      const cutoff = new Date(Date.now() - dayThreshold * 86400000).toISOString();
      const { data: stalledDeals } = await sb.from('deals').select('id,org_id,updated_at').eq('org_id', wf.org_id).not('stage', 'in', '("closed_won","closed_lost","disqualified")').lt('updated_at', cutoff).limit(20);
      for (const deal of stalledDeals || []){
        // Check if a stalled instance already exists for this deal + workflow
        const { data: existing } = await sb.from('workflow_instances').select('id').eq('workflow_id', wf.id).eq('deal_id', deal.id).eq('status', 'completed').gte('started_at', cutoff).limit(1);
        if (existing?.length) continue; // Already fired recently
        // Fire the workflow for this deal
        await processTrigger(sb, {
          org_id: deal.org_id,
          deal_id: deal.id,
          trigger_event: 'time_in_stage',
          trigger_data: {
            days_since_last_activity: dayThreshold,
            deal_id: deal.id
          },
          triggered_by: 'cron',
          trigger_source: 'internal'
        });
      }
    }
  } catch (e) {
    console.error('checkStalledDeals error:', e);
  }
}
