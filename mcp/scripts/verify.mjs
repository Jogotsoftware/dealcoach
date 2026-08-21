#!/usr/bin/env node
// Live verification for lumen-mcp. Requires the same four environment variables
// the server itself needs. Read-only by default; pass --write to include the
// round trip that mutates and then reverts one field.
//
//   cd mcp && npm run build
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... LUMEN_ORG_ID=... LUMEN_USER_ID=... \
//     node scripts/verify.mjs --write
//
// Everything here writes to stderr via console.log only because this is a script,
// not the server. The server itself must never write to stdout.

import { createClient } from "@supabase/supabase-js";
import { loadCatalog } from "../dist/catalog.js";
import { resolveAll, describePath, isReadable, isWritable } from "../dist/resolver.js";
import { createToolHandlers } from "../dist/tools.js";

const WRITE = process.argv.includes("--write");

const cfg = {
  supabaseUrl: (process.env.SUPABASE_URL ?? "").replace(/\/+$/, ""),
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  orgId: process.env.LUMEN_ORG_ID ?? "",
  userId: process.env.LUMEN_USER_ID ?? "",
};
for (const [k, v] of Object.entries(cfg)) {
  if (!v) {
    console.error(`missing env for ${k}`);
    process.exit(1);
  }
}

let pass = 0;
let fail = 0;
function check(name, condition, detail = "") {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}${detail ? " - " + detail : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? " - " + detail : ""}`);
  }
}
async function expectRefusal(name, fn, mustMention) {
  try {
    const result = await fn();
    check(name, false, `expected a refusal, got: ${JSON.stringify(result).slice(0, 160)}`);
  } catch (err) {
    const msg = String(err?.message ?? err);
    check(name, !mustMention || msg.includes(mustMention), msg.slice(0, 160));
  }
}

const supabase = createClient(cfg.supabaseUrl, cfg.serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("lumen-mcp verification");
console.log(`  org ${cfg.orgId}, write tests ${WRITE ? "ON" : "off (pass --write to enable)"}\n`);

const catalog = await loadCatalog(supabase, cfg);
const res = resolveAll(catalog);
const handlers = createToolHandlers(supabase, res, cfg);

// 1. Resolver classification.
console.log("resolver");
const byHop = {};
const unscoped = [];
for (const [name, o] of res.ownership) {
  if (o.kind === "SCOPED") byHop[o.hops.length] = (byHop[o.hops.length] ?? 0) + 1;
  else unscoped.push(name);
}
console.log(`  catalog source: ${catalog.source}, tables ${res.ownership.size}, by hop ${JSON.stringify(byHop)}`);
check("every table classified", res.ownership.size === catalog.tables.size);
check("unscoped list is small", unscoped.length < 30, `${unscoped.length}: ${unscoped.join(", ")}`);
const refusedForRead = unscoped.filter((t) => !isReadable(res.ownership.get(t)));
console.log(`  refused entirely: ${refusedForRead.join(", ") || "none"}`);
for (const [table, hops] of [
  ["deals", 0],
  ["msp_stages", 1],
  ["msp_templates", 1],
  ["msp_template_stages", 2],
  ["quote_lines", 1],
  ["task_tags", 2],
]) {
  const o = res.ownership.get(table);
  check(`${table} resolves`, o?.kind === "SCOPED" && o.hops.length === hops, o ? describePath(o) : "missing");
}
check("organizations is not writable", !isWritable(res.ownership.get("organizations")));

// 2. Reads.
console.log("\nreads");
const dealsProbe = await handlers.queryRows({ table: "deals", limit: 3 });
const deals = JSON.parse(dealsProbe.content[0].text);
check("query_rows returns deals", Array.isArray(deals) && deals.length > 0, `${deals.length} rows`);
check("all deals are in this org", deals.every((d) => d.org_id === cfg.orgId));
const sampleDeal = deals[0];

if (sampleDeal) {
  const found = await handlers.findDeal({ company_name: String(sampleDeal.company_name ?? "").slice(0, 6) });
  check("find_deal returns something", !found.content[0].text.startsWith("No deals"));
  const read = await handlers.readDeal({ deal_id: sampleDeal.id });
  check("read_deal composes three sections", read.content[0].text.includes("deal_analysis") && read.content[0].text.includes("company_profile"));
}

await expectRefusal("query_rows refuses an unscoped table", () => handlers.queryRows({ table: "categories" }), "no ownership path");
await expectRefusal("query_rows rejects an org_id filter", () => handlers.queryRows({ table: "deals", filters: [{ field: "org_id", value: "x" }] }), "org_id");

// 3. Cross-tenant write at depth.
console.log("\ncross-tenant refusal");
const { data: foreignDeals } = await supabase.from("deals").select("id").neq("org_id", cfg.orgId).limit(50);
const foreignDealIds = (foreignDeals ?? []).map((d) => d.id);
let foreignMilestone = null;
if (foreignDealIds.length > 0) {
  const { data } = await supabase.from("msp_milestones").select("id, deal_id, notes").in("deal_id", foreignDealIds).limit(1);
  foreignMilestone = data?.[0] ?? null;
}
if (foreignMilestone) {
  await expectRefusal(
    "update_field refuses a foreign msp_milestones row (2 hops from org_id)",
    () => handlers.updateField({ table: "msp_milestones", row_id: foreignMilestone.id, field: "notes", value: "should not be written" }),
    "does not belong to this organization",
  );
  const { data: after } = await supabase.from("msp_milestones").select("notes").eq("id", foreignMilestone.id).single();
  check("the foreign row was not modified", (after?.notes ?? null) === (foreignMilestone.notes ?? null));
} else {
  console.log("  SKIP  no msp_milestones row exists in another org; falling back to a synthetic id");
}
await expectRefusal(
  "update_field refuses a row id that does not exist",
  () => handlers.updateField({ table: "msp_milestones", row_id: "00000000-0000-0000-0000-000000000000", field: "notes", value: "x" }),
  "no row",
);

// 4. Column guards, against a real row in this org.
console.log("\ncolumn guards");
const { data: ownStages } = await supabase.from("msp_stages").select("id, deal_id, is_completed, stage_order").in("deal_id", (await supabase.from("deals").select("id").eq("org_id", cfg.orgId).limit(200)).data?.map((d) => d.id) ?? []).limit(1);
const stage = ownStages?.[0] ?? null;
if (!stage) {
  console.log("  SKIP  no msp_stages row in this org; column and round-trip checks cannot run");
} else {
  for (const [field, mention] of [
    ["id", "immutable"],
    ["created_at", "immutable"],
    ["deal_id", "foreign key"],
  ]) {
    await expectRefusal(`update_field refuses msp_stages.${field}`, () => handlers.updateField({ table: "msp_stages", row_id: stage.id, field, value: "x" }), mention);
  }
  await expectRefusal("update_field refuses deals.org_id", () => handlers.updateField({ table: "deals", row_id: stage.deal_id, field: "org_id", value: cfg.orgId }), "immutable");

  // 5. Failed cast must not write.
  const before = stage.stage_order;
  await expectRefusal("bad cast into a numeric column errors", () => handlers.updateField({ table: "msp_stages", row_id: stage.id, field: "stage_order", value: "abc" }), "cannot cast");
  const { data: unchanged } = await supabase.from("msp_stages").select("stage_order").eq("id", stage.id).single();
  check("nothing was written by the failed cast", unchanged?.stage_order === before, `still ${unchanged?.stage_order}`);

  // 6. Round trip.
  if (WRITE) {
    console.log("\nround trip");
    const original = stage.is_completed;
    const flipped = !original;
    const result = await handlers.updateField({ table: "msp_stages", row_id: stage.id, field: "is_completed", value: String(flipped) });
    check("update_field reports the new value", result.content[0].text.includes(`after:  ${flipped}`), result.content[0].text.split("\n")[2]);
    const requery = JSON.parse((await handlers.queryRows({ table: "msp_stages", filters: [{ field: "id", value: stage.id }] })).content[0].text);
    check("query_rows reflects the change", requery[0]?.is_completed === flipped);
    const { data: audit } = await supabase
      .from("audit_log")
      .select("entity_table, entity_id, action, actor_role, before_state, after_state")
      .eq("entity_id", stage.id)
      .eq("actor_role", "mcp")
      .order("created_at", { ascending: false })
      .limit(1);
    check("audit_log recorded the write", audit?.[0]?.action === "update_field" && audit?.[0]?.entity_table === "msp_stages", JSON.stringify(audit?.[0]?.after_state ?? null));
    await handlers.updateField({ table: "msp_stages", row_id: stage.id, field: "is_completed", value: String(original) });
    const { data: reverted } = await supabase.from("msp_stages").select("is_completed").eq("id", stage.id).single();
    check("reverted to the original value", reverted?.is_completed === original);
  }
}

// 7. create_row guards and round trip.
console.log("\ncreate_row");
await expectRefusal(
  "create_row refuses org_id",
  () => handlers.createRow({ table: "deals", values: { company_name: "x", org_id: cfg.orgId } }),
  "org_id cannot be supplied",
);
await expectRefusal(
  "create_row refuses an unscoped table",
  () => handlers.createRow({ table: "categories", values: { name: "x" } }),
  "no ownership path",
);
await expectRefusal(
  "create_row refuses a never-writable table",
  () => handlers.createRow({ table: "audit_log", values: { action: "x" } }),
  "never writable",
);
if (sampleDeal) {
  await expectRefusal(
    "create_row requires the ownership parent on a hop table",
    () => handlers.createRow({ table: "msp_stages", values: { stage_name: "orphan" } }),
    "required on create",
  );
  const { data: foreignDeal } = await supabase.from("deals").select("id").neq("org_id", cfg.orgId).limit(1);
  if (foreignDeal?.[0]) {
    await expectRefusal(
      "create_row refuses a foreign parent",
      () => handlers.createRow({ table: "tasks", values: { deal_id: foreignDeal[0].id, title: "should not exist" } }),
      "another organization",
    );
  } else {
    console.log("  SKIP  no deal exists in another org for the foreign-parent refusal");
  }
  await expectRefusal(
    "create_row refuses a bad cast",
    () => handlers.createRow({ table: "tasks", values: { deal_id: sampleDeal.id, title: "x", due_date: "not-a-date" } }),
    "cannot cast",
  );

  if (WRITE) {
    const marker = `lumen-mcp verify ${Date.now()}`;
    const result = await handlers.createRow({
      table: "tasks",
      values: { deal_id: sampleDeal.id, title: marker },
    });
    const body = result.content[0].text;
    check("create_row reports the new row", body.startsWith("created tasks row"), body.split("\n")[0]);
    const idMatch = /row id=([0-9a-f-]{36})/.exec(body);
    check("create_row returned a row id", Boolean(idMatch), body.split("\n")[0]);
    if (idMatch) {
      const rowId = idMatch[1];
      const { data: created } = await supabase.from("tasks").select("id, deal_id, title").eq("id", rowId).single();
      check("the row exists with the right parent", created?.deal_id === sampleDeal.id && created?.title === marker);
      const { data: audit } = await supabase
        .from("audit_log")
        .select("action, entity_table")
        .eq("entity_id", rowId)
        .eq("actor_role", "mcp")
        .limit(1);
      check("audit_log recorded the create", audit?.[0]?.action === "create_row" && audit?.[0]?.entity_table === "tasks");
      const { error: cleanupErr } = await supabase.from("tasks").delete().eq("id", rowId);
      check("verify row cleaned up", !cleanupErr, cleanupErr?.message ?? "");
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
