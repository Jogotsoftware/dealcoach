# Lane P0 — completed authoring, pending lead apply/verification

All seven deliverables are authored. No migrations were applied, Edge functions deployed, live database accessed, commits created, or pushes made. The lead commits and applies this working tree. Source of truth: `/Users/joe/dev/er-lanes/p0r.brief.md` and `/Users/joe/dev/er-lanes/p0.schema.md`, including the exact live function definitions and catalog snapshot dated 2026-10-12. The schema-gap stop rule was withdrawn in the second continuation.

## Assumptions to confirm before apply

1. The supplied catalog snapshot still matches the target database. The five forward migrations assume the explicitly supplied tables/views exist; they do not create replacement schemas. Audit inserts use the supplied compatible `audit_log` columns, including both required fields (`action`, `entity_table`). No fallback logging is needed for that known shape. New RPC/trigger/helper names are assumed unused outside this patch; inspect before replacing or rolling them back.
2. Existing `profiles` constraints allow the requested member roles `admin`, `manager`, `rep`, `bdr`, `sc`. `access_mode` values `full`/`dealroom_only` are corroborated by `20260513194200_add_profiles_access_mode.sql`. The general role RPC cannot assign `system_admin`; the platform editor can preserve an existing `system_admin` while moving org/access mode. Platform administration remains membership in `platform_admins`. Confirm whether legacy system-admin workflows require separate retirement work.
3. The profile UPDATE guard runs as SECURITY INVOKER, and trusted RPCs are postgres-owned. The specified custom GUC is not protected against users with arbitrary SQL execution; no flag-setting RPC is exposed here. Profile INSERT policy hardening and other pre-existing SECURITY DEFINER RPCs are outside this requested UPDATE guard. Confirm no untrusted RPC exposes arbitrary SQL or lets users set the bypass flag.
4. The three invoker views' underlying relations have effective tenant RLS and appropriate SELECT grants for their intended callers. Invoker mode delegates to that RLS; it cannot repair a permissive base-table policy. Catalog/tenant checks below must pass. View rollback restores the broad write grants recorded in the snapshot; review any views added since apply before using it.
5. `deal-documents` paths start with a deal UUID, corroborated by DocumentsPanel, DealDetail and QuoteBuilder. `order-schedule-uploads` starts with org UUID (`src/lib/webhooks.js`). SOW import validates the stored deal, optional stored quote, and stored path together; it does not trust a request-supplied quote ID. Unknown SOW columns are not selected individually: `select('*')` reads the record, and only known authorization fields are required. Existing extraction/output fields are preserved. Null quote_id is permitted; missing/mismatched targets fail closed.
6. Bucket privacy is UNKNOWN. Restrictive storage RLS protects authenticated API access, not public bucket URLs or already-issued signed URLs. `DealDetail` currently uses `getPublicUrl`. Confirm `storage.buckets.public` before claiming private read isolation; if public, the lead must coordinate private-bucket conversion and signed-link consumers. This patch deliberately does not change bucket settings or customer-room access.
7. `deal-room-library` has no uploader/path convention in this repository or snapshot. No folder meaning is guessed, and no policy is authored for it. The requested alternative finding/re-pathing plan is below. Its existing broad policy remains until that work is done.
8. `invitations.target_app` may be absent. SQL reads it through `to_jsonb(record)->>'target_app'`; Edge/UI use `select('*')`. Absent means the legacy DealCoach flow. Any unknown/null invitation type is refused; `evaluation_room` is refused even for supported types and already-accepted invitations. Other target_app values retain existing behavior. Do not widen the invitation CHECK just to test future types.
9. `get_invitation_by_token` keeps its exact return signature and filters unsupported invitations instead of adding a target_app output column. Direct UI fallback reads all columns and checks the same route rules. The existing `invite_new_org_with_admin` signature accepting `p_modules` is evidenced by its UI caller but its SQL body is unknown; confirm it persists `[]`/selected arrays without replacing them with defaults. `invite_teammate` is unchanged; its omitted modules remain NULL and therefore materialize no grants.
10. `user_module_access` uniqueness/default details are incomplete. Forward SQL supplies its UUID explicitly, locks invitation and recipient profile, checks existing rows, and uses `ON CONFLICT DO NOTHING`. This makes repeated/concurrent calls through this RPC idempotent without assuming an id default or named constraint. Confirm external grant writers also enforce `(user_id,module_id)` uniqueness. Existing duplicates are not deleted.
11. Explicit invitation pickers list active registry labels, including `deal_room` and `scoping`, without inferring org-plan grants. They start/reset at `[]`. Registry rows are labels only; no plan, org override, or membership rows are populated. NULL/[] means this RPC inserts **no grants**; existing effective-access resolvers (including legacy org/plan fallbacks) are unchanged. Confirm downstream Evaluation Room enforcement uses explicit membership grants rather than treating absence as inherited access.
12. Onboarding stores the founder's selected keys under `organizations.settings.founder_modules`; it does not create Evaluation Room membership tables or materialize founder grants. The current wizard sends `teamMembers: []`; API callers supplying team members must pass `member.modules`, with omission normalized to `[]`. Unknown keys are not elevated: the grant RPC ignores keys absent/inactive in the registry. Confirm registry SELECT is available to an authenticated founder before org creation.
13. Accepted module materialization is limited to the matching recipient or service-role signup. `accept_invitation` likewise requires self or service-role context. The two checked-in callers satisfy this; any external trusted callers must provide service-role claims. Function replacement preserves existing ACLs; inspect them below. Acceptance and Edge auth-admin operations span separate requests, so this patch is not a cross-request transaction against concurrent administrative reclassification of invitations.
14. Matching rollbacks preserve audit history and the two registry labels (which may acquire references after apply). Those retained labels grant nothing by themselves. Existing Edge signup behavior for supported invitations, including its existing-user password update, is unchanged; refusal happens before that code for unsupported invitations.

## 1. Profile guard and admin callers

`20261012130000_profile_admin_guard.sql` completes the previous draft. A BEFORE UPDATE trigger rejects changes to `org_id`, `role`, `access_mode`, `module_access`, or `beta_features` unless current_user is postgres/supabase_admin/service_role, the JWT user is a platform admin, or a trusted RPC has enabled the requested transaction-local flag. Both member RPCs authorize against the **target** org (or platform membership), lock the row, restore the previous flag, and insert audit rows. `remove_member` clears org and resets role to rep. All new admin RPCs have an empty search_path, postgres ownership, revoked PUBLIC/anon execution, and authenticated execution grants.

OrgSettings, OrgDetail (including `setUserRole`), and AdminConsole use RPCs for role/org mutations and report failures before optimistic success. `set_member_admin_fields` preserves the platform console's atomic organization/role/access-mode editor with a platform-only check and audit. The remaining platform-only direct access-mode/beta edits are covered by the requested platform-admin trigger exception. Generic Settings profile edits only pass ordinary fields.

Trigger semantics: a postgres-owned SECURITY DEFINER `accept_invitation` executes its UPDATE as current_user=postgres, which the SECURITY INVOKER trigger inherits and allows. Onboarding is an Edge function using a service-role client; its UPDATE runs as service_role and is also allowed. These are code/semantics conclusions; staged execution remains required.

## 2. Views

`20261012131000_view_security.sql` sets security_invoker=true on `deal_open_barriers_v`, `deal_extractions_with_source`, and `deal_latest_snapshot`; it revokes INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER on every public view from anon/authenticated while preserving SELECT.

Keep `bdr_my_lead_status`'s existing bypass. The live definition filters `bl.bdr_id = auth.uid()`; `docs/builds/lumen-bdr-routing-progress.md` deviation 1 explains that BDRs cannot directly read deals, so invoker mode would lose intended lead-status deal columns. No checked-in CREATE VIEW definition was found; the recommendation relies on the supplied live definition and design record. Its write grants are revoked along with other views. Confirm the caller filter and constrained projection remain intact.

## 3. Storage

`20261012132000_deal_document_storage.sql` adds a SECURITY DEFINER, empty-search-path helper joining deals to the caller's non-null profile org. A RESTRICTIVE FOR ALL policy intersects existing permissive policies for authenticated users in `deal-documents`; both USING and WITH CHECK enforce the first-folder deal membership. CASE prevents malformed UUID casts and lets unrelated buckets pass this additional fence. Cross-org platform users have no special exception here; service-role storage operations bypass RLS as before.

Observed paths: DocumentsPanel `${deal.id}/${Date.now()}-${safe}`, DealDetail `${deal.id}/${Date.now()}_${file.name}`, QuoteBuilder `${dealId}/sow/${Date.now()}-${safe filename}`. Edge functions download stored paths; no Edge uploader was found. `deal_documents` has no org_id, so the helper uses `deals.org_id`.

**deal-room-library re-pathing plan:** obtain a read-only inventory of object names and stored references plus the external uploader; adopt `{org_id}/{object_id}/{filename}`; update upload/read/delete callers; copy existing objects with trusted migration tooling; update references; compare counts and validate links; then add restrictive org-folder USING/WITH CHECK policies. Keep old objects until reference migration is verified. No copying or policy changes for this bucket are included.

Untouched buckets: company-logos, proposal-logos, deal-resources, deal-room-videos, team-avatars, coach-documents. Public/customer-room read behavior may be intentional.

## 4. Importers

Both handlers require Authorization, create an anon client carrying it, and call auth.getUser before target reads. They load the caller profile with the service client and require a non-null matching org and non-BDR role. No service-key bypass remains. The order importer also rejects foreign-org input paths. SOW validates deal ownership, optional stored quote ownership/deal, and the deal-folder path before setting `authorized=true`. Its catch handler writes error status only after that point. Parsing/rebuild behavior is otherwise retained.

Deployment configuration is unchanged. Lead should deploy **import-sow with verify_jwt=true**. Application authorization remains necessary even with gateway JWT verification.

## 5. Explicit module grants

`20261012133000_explicit_invitation_modules.sql` inserts the active `deal_room` / “Deal Room” and `scoping` / “Scoping” labels if absent. It preserves the module-application signature, documents NULL as no modules, rejects unsupported invitation routes, verifies accepted-recipient authorization, ignores malformed arrays/unknown keys, and counts actual inserted rows.

All five direct UI insertion sites, the AdminConsole new-org RPC caller, and onboarding send explicit arrays. ModuleAccessPicker's explicit mode has no inherit toggle or preselection; its unrelated legacy mode remains. Settings' previously unrendered invitation handler now has an org-admin invitation-link form with the picker. The founder wizard adds a dedicated empty-by-default Modules step before Review. The API stores founder selections, validates array shapes before creating an org, and copies each invited team member's explicit selection.

## 7. Invitation routing

create-invited-user refuses unsupported/null types and evaluation_room immediately after lookup, before listUsers/createUser/updateUserById/profile upsert. It returns neutral 400. SQL accept refuses before its already-accepted branch or any mutation, and the token lookup filters unsupported routes. Both acceptance callers check result.success before module application or navigation. Allowed teammate/new_instance handling remains as supplied, including new_instance's SQL behavior of marking accepted without assigning a profile org.

## 6. Exact lead verification (not executed against a database)

Use staging/disposable orgs A/B, an org-A rep, org-A BDR, org-A and org-B admins, and a platform admin. Populate a deal in each org with rows in all three view source sets, an existing `deal-documents` object per deal, a quote and SOW for org A, and a pending invitation addressed to the disposable rep. Use the `sub` of real JWTs to populate psql variables: `rep_id`, `bdr_id`, `org_a_admin_id`, `org_b_admin_id`, `platform_admin_id`, `org_a_id`, `org_b_id`, `deal_a_id`, `deal_b_id`, `quote_a_id`, `sow_a_id`, `invitation_id`, `invitation_token`, `object_a_name`, `object_b_name`, `founder_org_id`.

SQL impersonation checks authorization/RLS using those JWT claims; it does not verify JWT signatures. The HTTP tests use actual JWTs. Run each expected-error transaction separately (or use psql ON_ERROR_STOP off for those blocks) and always roll back. Never test the profile guard as postgres without SET LOCAL ROLE.

### Catalog and ACL checks

```sql
SELECT p.oid::regprocedure, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner, p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
('guard_profile_admin_fields','set_member_role','remove_member','set_member_admin_fields',
 'storage_deal_in_caller_org','accept_invitation','apply_invitation_module_access','get_invitation_by_token');
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
WHERE tgrelid='public.profiles'::regclass AND NOT tgisinternal;
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid IN ('public.profiles'::regclass,'public.invitations'::regclass,'public.user_module_access'::regclass);
SELECT column_name, is_nullable, column_default FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('audit_log','modules','user_module_access');
SELECT c.relname, c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
('deal_open_barriers_v','deal_extractions_with_source','deal_latest_snapshot','bdr_my_lead_status');
-- Expect zero rows; SELECT grants should still exist separately.
SELECT g.* FROM information_schema.role_table_grants g
JOIN pg_views v ON v.schemaname=g.table_schema AND v.viewname=g.table_name
WHERE v.schemaname='public' AND g.grantee IN ('anon','authenticated') AND g.privilege_type <> 'SELECT';
SELECT * FROM pg_policies WHERE schemaname IN ('public','storage');
SELECT id, public FROM storage.buckets WHERE id IN ('deal-documents','deal-room-library');
SELECT policyname, permissive, roles, cmd, qual, with_check FROM pg_policies
WHERE schemaname='storage' AND tablename='objects';
SELECT pg_get_viewdef('public.bdr_my_lead_status'::regclass, true);
```

### Profile JWT matrix

```sql
-- Rep self-elevation: expect 42501.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'rep_id', 'role', 'authenticated')::text, true);
UPDATE public.profiles SET role='admin' WHERE id=auth.uid();
ROLLBACK;

-- Repeat this block separately with EACH assignment below; expect 42501.
-- SET org_id = :'org_b_id'::uuid
-- SET access_mode = CASE WHEN access_mode='full' THEN 'dealroom_only' ELSE 'full' END
-- SET module_access = module_access || '{"p0_test":true}'::jsonb
-- SET beta_features = beta_features || '{"p0_test":true}'::jsonb

-- Ordinary fields and unchanged protected values: succeed.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'rep_id', 'role', 'authenticated')::text, true);
UPDATE public.profiles SET full_name=full_name || ' P0', role=role WHERE id=auth.uid();
ROLLBACK;

-- Org-A admin: succeeds and produces one audit row; flag restored.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'org_a_admin_id', 'role', 'authenticated')::text, true);
SELECT public.set_member_role(:'rep_id'::uuid, 'manager');
SELECT id, org_id, role FROM public.profiles WHERE id=:'rep_id'::uuid;
SELECT current_setting('app.allow_profile_admin_change', true) IS DISTINCT FROM 'on' AS flag_restored;
RESET ROLE;
SELECT actor_id, action, entity_id, before_state, after_state FROM public.audit_log
WHERE entity_id=:'rep_id'::uuid AND action='set_member_role' ORDER BY created_at DESC LIMIT 1;
ROLLBACK;

-- Org-B admin: expect 42501. Repeat using rep_id as the caller: also 42501.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'org_b_admin_id', 'role', 'authenticated')::text, true);
SELECT public.set_member_role(:'rep_id'::uuid, 'manager');
ROLLBACK;

-- Platform-admin JWT: succeeds across orgs, even if admin's profile org differs.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'platform_admin_id', 'role', 'authenticated')::text, true);
SELECT public.set_member_role(:'rep_id'::uuid, 'sc');
SELECT public.set_member_admin_fields(:'rep_id'::uuid, 'rep', :'org_b_id'::uuid, 'full');
RESET ROLE;
SELECT id, role, org_id, access_mode FROM public.profiles WHERE id=:'rep_id'::uuid;
ROLLBACK;

-- Removal as target-org admin: succeeds, org null, role rep, audit present.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'org_a_admin_id', 'role', 'authenticated')::text, true);
SELECT public.remove_member(:'rep_id'::uuid);
RESET ROLE;
SELECT id, org_id, role FROM public.profiles WHERE id=:'rep_id'::uuid;
SELECT action, before_state, after_state FROM public.audit_log
WHERE entity_id=:'rep_id'::uuid AND action='remove_member' ORDER BY created_at DESC LIMIT 1;
ROLLBACK;
```

Repeat role RPC with NULL and `system_admin` as the requested role: expect 22023. Repeat remove_member as rep and org-B admin: expect 42501. Repeat set_member_admin_fields as org-A admin: expect 42501. Use each corresponding UI to verify success/error display and reload persistence. An org admin's direct protected self-update must still fail; a platform admin's direct update of their own protected fields is permitted by specification.

### Views and storage with cross-org JWTs

```sql
-- Org-A rep sees no org-B fixture rows. Each count must be zero.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'rep_id', 'role', 'authenticated')::text, true);
SELECT count(*) FROM public.deal_open_barriers_v v WHERE to_jsonb(v)->>'deal_id'=:'deal_b_id';
SELECT count(*) FROM public.deal_extractions_with_source v WHERE to_jsonb(v)->>'deal_id'=:'deal_b_id';
SELECT count(*) FROM public.deal_latest_snapshot v WHERE to_jsonb(v)->>'deal_id'=:'deal_b_id';
SELECT count(*) FROM storage.objects WHERE bucket_id='deal-documents' AND name=:'object_b_name';
SELECT public.storage_deal_in_caller_org(:'deal_b_id'::uuid); -- false
SELECT public.storage_deal_in_caller_org(:'deal_a_id'::uuid); -- true
SELECT count(*) FROM storage.objects WHERE bucket_id='deal-documents' AND name=:'object_a_name'; -- 1
DELETE FROM storage.objects WHERE bucket_id='deal-documents' AND name=:'object_b_name' RETURNING name; -- 0 rows
ROLLBACK;

-- Repeat foreign view/storage reads with org_a_admin_id; expect zero foreign rows.
-- Repeat view reads with org_b_admin_id and deal_a_id; expect zero org-A rows.
-- Platform view results follow underlying platform RLS and may include both orgs.
-- Platform storage reads still require a matching profile org; no platform exception.

-- Cross-org insert: expect storage RLS error (42501).
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'rep_id', 'role', 'authenticated')::text, true);
INSERT INTO storage.objects(bucket_id,name) VALUES ('deal-documents', :'deal_b_id' || '/p0-denied.pdf');
ROLLBACK;

-- Repeat insert with 'not-a-uuid/p0.pdf': RLS denial, not UUID cast failure.
-- Repeat with deal_a_id: succeeds (metadata-only test, rolled back).
-- Move out of own org: expect denial, never a cross-org destination.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'rep_id', 'role', 'authenticated')::text, true);
UPDATE storage.objects SET name=:'deal_b_id' || '/p0-move.pdf'
WHERE bucket_id='deal-documents' AND name=:'object_a_name';
ROLLBACK;

-- BDR view remains caller-scoped; compare returned lead IDs with that BDR's fixtures.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'bdr_id', 'role', 'authenticated')::text, true);
SELECT * FROM public.bdr_my_lead_status;
ROLLBACK;
```

Verify own-org view fixtures return rows to avoid false confidence from empty sources. A storage move may affect zero rows if no permissive UPDATE policy exists; it must never succeed across orgs. Check actual Storage API download/list/upload/delete with the same JWTs too. Do not manipulate production storage metadata directly. Inspect `deal-room-library` paths read-only:

```sql
SELECT bucket_id, split_part(name,'/',1) AS first_folder, count(*)
FROM storage.objects WHERE bucket_id IN ('deal-documents','deal-room-library') GROUP BY 1,2 ORDER BY 1,2;
```

### Importer HTTP checks and before/after SQL

Set `SUPABASE_URL`, `ANON_KEY`, `REP_JWT`, `BDR_JWT`, `ORG_ADMIN_JWT`, `OTHER_ORG_JWT`, `PLATFORM_ADMIN_JWT`, `QUOTE_A`, `SOW_A`, `ORDER_PATH_A`, and `OBJECT_B_PATH` in the lead's test environment. `ORDER_PATH_A` is an existing org-A-prefixed object. These commands send requests only when the lead runs them.

```sh
# Missing/invalid JWT: 401, no writes.
curl -sS -o /tmp/p0-response.json -w '%{http_code}\n' "$SUPABASE_URL/functions/v1/import-order-schedule" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
  --data "{\"quote_id\":\"$QUOTE_A\",\"storage_path\":\"$ORDER_PATH_A\"}"
curl -sS -o /tmp/p0-response.json -w '%{http_code}\n' "$SUPABASE_URL/functions/v1/import-sow" \
  -H "apikey: $ANON_KEY" -H 'Authorization: Bearer invalid' -H 'Content-Type: application/json' \
  --data "{\"sow_document_id\":\"$SOW_A\"}"
# Other-org user: 403 on both. Repeat with BDR_JWT (same org): 403.
for jwt in "$OTHER_ORG_JWT" "$BDR_JWT"; do
  curl -sS -o /tmp/p0-response.json -w '%{http_code}\n' "$SUPABASE_URL/functions/v1/import-order-schedule" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $jwt" -H 'Content-Type: application/json' \
    --data "{\"quote_id\":\"$QUOTE_A\",\"storage_path\":\"$ORDER_PATH_A\"}"
  curl -sS -o /tmp/p0-response.json -w '%{http_code}\n' "$SUPABASE_URL/functions/v1/import-sow" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $jwt" -H 'Content-Type: application/json' \
    --data "{\"sow_document_id\":\"$SOW_A\"}"
done
# Private bucket cross-org read: HTTP non-2xx; no object bytes (API may use 400/404).
curl -sS -o /tmp/p0-storage-response -w '%{http_code}\n' \
  "$SUPABASE_URL/storage/v1/object/authenticated/deal-documents/$OBJECT_B_PATH" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $REP_JWT"
```

Repeat both importers for missing AND invalid headers, same-org rep/admin (allowed; use disposable data because parsing writes), and platform JWT (allowed only if profile org matches, still subject to non-BDR rule). Compare these privileged snapshots before and after every denied call; results must be identical, including error status and child rows:

```sql
SELECT to_jsonb(q) FROM public.quotes q WHERE id=:'quote_a_id'::uuid;
SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') FROM public.quote_lines x WHERE quote_id=:'quote_a_id'::uuid;
SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') FROM public.quote_implementation_items x WHERE quote_id=:'quote_a_id'::uuid;
SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') FROM public.quote_payment_schedule x WHERE quote_id=:'quote_a_id'::uuid;
SELECT to_jsonb(s) FROM public.sow_documents s WHERE id=:'sow_a_id'::uuid;
SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]') FROM public.implementation_items x WHERE deal_id=:'deal_a_id'::uuid;
```

### Invitations, module application, founder selections

```sql
-- Labels only, exactly one active registry entry per key; inspect existing duplicates.
SELECT module_key, module_name, active, count(*) OVER (PARTITION BY module_key)
FROM public.modules WHERE module_key IN ('deal_room','scoping');

-- Org-admin JWT can persist an explicit array through invitation RLS.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'org_a_admin_id', 'role', 'authenticated')::text, true);
INSERT INTO public.invitations(email, org_id, role, invitation_type, invited_by, modules)
VALUES ('p0-disposable@example.test', :'org_a_id'::uuid, 'rep', 'teammate', auth.uid(), '["deal_room","scoping"]')
RETURNING id, invitation_type, modules;
ROLLBACK;
-- Repeat with [] (stored as []); rep JWT must be denied by existing RLS.
-- Repeat as platform-admin with new_instance and org_id NULL (allowed).

-- Use a disposable recipient matching the invitation email; all setup rolled back.
BEGIN;
DELETE FROM public.user_module_access WHERE user_id=:'rep_id'::uuid;
UPDATE public.invitations SET modules=NULL, status='accepted', accepted_at=now()
WHERE id=:'invitation_id'::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'rep_id', 'role', 'authenticated')::text, true);
SELECT public.apply_invitation_module_access(:'invitation_id'::uuid, :'rep_id'::uuid); -- 0
RESET ROLE;
UPDATE public.invitations SET modules='[]' WHERE id=:'invitation_id'::uuid;
SET LOCAL ROLE authenticated;
SELECT public.apply_invitation_module_access(:'invitation_id'::uuid, :'rep_id'::uuid); -- 0
RESET ROLE;
UPDATE public.invitations SET modules='["deal_room","scoping","unknown_p0_key","scoping"]' WHERE id=:'invitation_id'::uuid;
SET LOCAL ROLE authenticated;
SELECT public.apply_invitation_module_access(:'invitation_id'::uuid, :'rep_id'::uuid); -- 2
SELECT public.apply_invitation_module_access(:'invitation_id'::uuid, :'rep_id'::uuid); -- 0
RESET ROLE;
SELECT m.module_key FROM public.user_module_access a JOIN public.modules m ON m.id=a.module_id
WHERE a.user_id=:'rep_id'::uuid ORDER BY 1; -- only deal_room and scoping
ROLLBACK;

-- Teammate acceptance still changes profile with the guard installed.
BEGIN;
UPDATE public.invitations SET status='pending', expires_at=now()+interval '1 day'
WHERE id=:'invitation_id'::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'rep_id', 'role', 'authenticated')::text, true);
SELECT * FROM public.accept_invitation(:'invitation_token', :'rep_id'::uuid); -- success=true
RESET ROLE;
SELECT id, org_id, role FROM public.profiles WHERE id=:'rep_id'::uuid;
SELECT status, accepted_at FROM public.invitations WHERE id=:'invitation_id'::uuid;
ROLLBACK;

-- After submitting each UI form, inspect its new invitation (not just the request).
SELECT id, email, invitation_type, modules, jsonb_typeof(modules) FROM public.invitations
ORDER BY created_at DESC LIMIT 20;
-- After completing the founder wizard with just Scoping checked:
SELECT id, settings->'founder_modules' FROM public.organizations WHERE id=:'founder_org_id'::uuid; -- ["scoping"]
```

UI checklist: Settings invitation link, OrgSettings invite, AdminConsole user invite, AdminConsole new-org invitation, OrgDetail invite, admin Invitations, founder onboarding. Open each fresh: no checks; submit none: `[]`; select only Scoping: `["scoping"]`; reopen after success: empty. The onboarding team API must persist each member's own array and must not copy founder choices to teammates. Confirm malformed input arrays return 400 before organization creation. Apply with a different recipient or before acceptance must be denied. Repeating a grant call adds no rows. Founders with no selection store `[]`, and this patch does not grant any unselected modules.

### Unsupported invitations: database and Edge refusal

The following runs only after `target_app` exists; it does not add the column. Use the same disposable rep-addressed invitation. First set test GUCs outside the DO block so no psql interpolation inside dollar quoting is needed.

```sql
BEGIN;
SELECT set_config('p0.invitation_id', :'invitation_id', true);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='invitations' AND column_name='target_app') THEN
    EXECUTE 'UPDATE public.invitations SET target_app=$1 WHERE id=$2'
      USING 'evaluation_room', current_setting('p0.invitation_id')::uuid;
  ELSE
    RAISE NOTICE 'target_app absent: SQL target-routing test awaits Evaluation Room schema; Node coverage exists';
  END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', :'rep_id', 'role', 'authenticated')::text, true);
-- With target_app present/set: success=false, neutral message; lookup yields no rows, module count=0.
SELECT * FROM public.accept_invitation(:'invitation_token', :'rep_id'::uuid);
SELECT * FROM public.get_invitation_by_token(:'invitation_token');
SELECT public.apply_invitation_module_access(:'invitation_id'::uuid, :'rep_id'::uuid);
ROLLBACK;
```

When the column is absent, that SQL block exercises the supported legacy route instead; do not interpret that as refusal coverage. When future CHECK constraints permit partner/other types, repeat with one of those types and with both pending and already-accepted statuses. Do not remove current CHECK constraints for a test. For Edge HTTP, use a **committed staging fixture** routed to evaluation_room (or an allowed future unsupported type); a rolled-back SQL fixture is not visible to HTTP:

```sh
curl -sS -o /tmp/p0-response.json -w '%{http_code}\n' "$SUPABASE_URL/functions/v1/create-invited-user" \
  -H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
  --data "{\"token\":\"$UNSUPPORTED_INVITATION_TOKEN\",\"password\":\"P0-disposable-only-123\",\"full_name\":\"P0 Test\"}"
# Expect 400 and "This invitation cannot be accepted here."
```

Before/after privileged comparisons below must match. Run once with a never-registered fixture email (no auth user created), once with an existing disposable account (password unchanged), and once with an already-accepted unsupported invitation. Replace `fixture_email` with the exact invited email. Password comparison is a boolean against an in-session digest; do not print password hashes.

```sql
SELECT count(*) AS auth_count FROM auth.users WHERE lower(email)=lower(:'fixture_email');
SELECT id, to_jsonb(p) FROM public.profiles p WHERE lower(email)=lower(:'fixture_email');
SELECT id, status, accepted_at, modules FROM public.invitations WHERE id=:'invitation_id'::uuid;
SELECT to_jsonb(a) FROM public.user_module_access a WHERE user_id=:'rep_id'::uuid;
-- Before HTTP request, in a persistent privileged psql session:
SELECT set_config('p0.password_digest', coalesce((SELECT md5(encrypted_password) FROM auth.users
WHERE lower(email)=lower(:'fixture_email')), ''), false);
-- After HTTP request, in that same session (expect true):
SELECT current_setting('p0.password_digest') = coalesce((SELECT md5(encrypted_password) FROM auth.users
WHERE lower(email)=lower(:'fixture_email')), '') AS password_unchanged;
```

Confirm allowed teammate/new_instance signup and authenticated acceptance still work when target_app is absent. A refused `accept_invitation` result must leave AcceptInvite on the error view without calling module application or navigating.

## Local validation and rollout

- `npm_config_cache=/tmp/npm-cache-p0 npm ci --ignore-scripts --no-audit --no-fund` completed without changing manifests/lockfile.
- `node --test tests/p0-edge-authorization.test.mjs`: 29/29 pass. Executes real transformed Edge handler code with inert Supabase adapters; tests missing/invalid/service JWTs, foreign org, BDR/missing/orgless profiles, thrown pre-authorization reads, foreign input/deal/quote, allowed path continuation, and unsupported signup before auth/profile mutations. No network/database/LLM calls.
- `npm_config_cache=/tmp/npm-cache-p0 npm run build`: passes. Vite reports mixed static/dynamic webhook imports and large chunks; neither is caused by the authorization logic.
- All 10 forward/rollback files pass pglast SQL and PL/pgSQL parsing (parser installed under `/tmp`, no database execution). All four changed Edge files pass TypeScript syntax transformation. `git diff --check` passes. SQL execution, live JWT/RLS tests, deployed Edge checks, and authenticated visual UI QA remain for the lead; local mocked tests do not establish deployed behavior.

Apply the five forward migrations in timestamp order before releasing UI callers/new Edge functions. Run staging checks before production. Roll back SQL in reverse order with matching files, alongside reverting dependent application code; rollbacks restore prior invitation bodies from the supplied exact SQL and intentionally reintroduce the old security posture. All SQL files are rerunnable; rollbacks retain audit data and referenced registry labels as described above.

## Every changed file

- `docs/P0-VERIFICATION.md`
- `supabase/migrations/20261012130000_profile_admin_guard.sql`
- `supabase/migrations/20261012131000_view_security.sql`
- `supabase/migrations/20261012132000_deal_document_storage.sql`
- `supabase/migrations/20261012133000_explicit_invitation_modules.sql`
- `supabase/migrations/20261012134000_invitation_accept_guard.sql`
- `supabase/rollback/20261012130000_profile_admin_guard.sql`
- `supabase/rollback/20261012131000_view_security.sql`
- `supabase/rollback/20261012132000_deal_document_storage.sql`
- `supabase/rollback/20261012133000_explicit_invitation_modules.sql`
- `supabase/rollback/20261012134000_invitation_accept_guard.sql`
- `tests/p0-edge-authorization.test.mjs`
- `src/components/ModuleAccessPicker.jsx`
- `src/lib/platformAdmin.js`
- `src/pages/AcceptInvite.jsx`
- `src/pages/AdminConsole.jsx`
- `src/pages/Onboarding.jsx`
- `src/pages/Settings.jsx`
- `src/pages/admin/Invitations.jsx`
- `src/pages/admin/OrgDetail.jsx`
- `src/pages/settings/OrgSettings.jsx`
- `supabase/functions/create-invited-user/index.ts`
- `supabase/functions/import-order-schedule/index.ts`
- `supabase/functions/import-sow/index.ts`
- `supabase/functions/onboard-organization/index.ts`
