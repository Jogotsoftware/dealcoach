# lumen-mcp

A local stdio MCP server that lets Claude Desktop read and update any field on any
Lumen table. Tenant isolation is derived from the foreign-key graph at startup
rather than from a hand-maintained allowlist.

## Why the resolver exists

The server connects with the Supabase service-role key, which bypasses row-level
security. Nothing in the database will stop a cross-tenant read or write. The
ownership resolver is the only isolation in the system, so any code path that
reaches a table without a resolved ownership check is a defect, not a shortcut.

Of the 219 tables in `public`, 106 carry `org_id` directly. The rest reach it
through one to three foreign keys: `msp_stages` through `deals`, `msp_templates`
through `coaches`, `msp_template_stages` through `msp_templates` then `coaches`,
`task_tags` through `tasks` then `deals`. A row id proves nothing about tenancy on
its own, which is why every write walks the chain with real queries before it
touches anything.

## How the resolver works

At startup the server reads a schema catalog and, for each table, breadth-first
searches the foreign-key graph for the nearest table carrying `org_id`
(`organizations` counts, via its `id`). Search depth is capped at four hops and
visited tables are tracked, so cycles and self-references terminate.

When several foreign keys reach `org_id` at the same depth, the tie is broken by:

1. **Actor columns last.** Any `*_by` or `*_by_*` column, plus `assigned_to`,
   `owner_id`, `actor_id` and similar, records who touched the row rather than what
   owns it. It is used only when nothing else reaches `org_id`.
2. **Required before optional.** A nullable foreign key is a weaker owner, because
   a null there makes ownership unprovable and the row unreachable.
3. **Declaration order.** The structural parent is declared first. This is what
   makes `quote_lines` resolve through `quote_id` rather than `product_id`, and
   `task_tags` through `task_id` rather than `tag_id`.

Each table is then classified:

- **SCOPED** - a path exists. Readable, and writable unless listed below.
- **UNSCOPED** - no path. Writes are always refused. Reads are refused too, unless
  the table is in the small hardcoded `GLOBAL_REFERENCE` set in `src/config.ts`
  (`plans`, `modules`, `roi_industries`, `msp_predefined_steps`, `widget_registry`,
  `metric_taxonomy`, `ai_providers`, `credit_costs`, `module_reference`,
  `risk_definitions`, `stage_exit_criteria`). There is no fallback to "allow".

`organizations` is readable only for `LUMEN_ORG_ID` and is never writable.
`audit_log` is never writable through this server.

The full classification is printed to stderr at startup: one line per table with
its hop count and resolved path, grouped into scoped, global-reference and refused.
Read it after any schema change. **Hop count is the number of foreign keys
traversed**, so a table carrying `org_id` is 0 hops and `msp_stages` is 1.

A row whose path runs through a nullable foreign key that happens to be null cannot
be proven to belong to the org, so it is refused. That is deliberate: the resolver
fails closed.

## Catalog sources

PostgREST cannot query `pg_constraint` or `information_schema`, so the catalog
comes from one of two places, in order:

1. **`lumen_mcp_catalog()`** - a `SECURITY DEFINER` function granted to
   `service_role` only, created by
   `supabase/migrations/20260806120000_lumen_mcp_catalog.sql`. Preferred: it
   reports identity, generated and updatable flags exactly.
2. **The PostgREST OpenAPI schema** at `GET /rest/v1/` - the fallback when the RPC
   is absent. It carries columns, types, primary keys and foreign keys, but not the
   identity/generated/updatable flags. The server says so in its startup report and
   in `describe_table`. Postgres still rejects writes to such columns; they are
   simply refused by the database rather than pre-flight by the server.

Applying the migration is recommended. The fallback exists so the server runs
without it.

## Tools

| Tool | What it does |
| --- | --- |
| `list_tables` | Every reachable table with hop count, resolved ownership path, and read/write status. The resolver report, exposed to the model. |
| `describe_table` | One table's columns with types, nullability, and whether each is writable. |
| `find_deal` | Deals by company name (case-insensitive partial match), limit 25. |
| `read_deal` | One deal composed with its `deal_analysis` and `company_profile`. |
| `query_rows` | Rows from any readable table with optional equality filters. Default limit 50, hard cap 200. This is how the model finds the `row_id` an update needs. |
| `create_row` | Inserts one row in a writable table. `org_id` is injected server-side and refused as input. Foreign keys are accepted at creation, but every referenced parent row is verified in-org by walking its FK chain first, and a table owned through a parent must include that parent column. Values are cast per column type, required columns are preflighted when the catalog RPC is available, the row is read back, and the insert lands in `audit_log` as `action = 'create_row'`. Creating a deal auto-creates its `company_profile` and `deal_analysis` via the existing trigger. |
| `update_field` | Sets one field on one row. Marked destructive, so Claude confirms first. |

Org scoping on reads is automatic. Tables carrying `org_id` are filtered directly.
Tables further out have the filter pushed into the query as the set of in-org
parent ids; when that set is too large to push down, a wider page is fetched and
every row is verified against its ownership chain instead, and the result says so.
The scope is never dropped.

`org_id` is never accepted as tool input. The model cannot select a tenant.

## What `update_field` does, in order

1. Resolves the table. Refuses if unscoped, unknown, or never-writable.
2. Fetches the row and walks its foreign-key chain with real queries to a terminal
   `org_id`. Refuses if the row is missing or resolves to another org.
3. Refuses the column if it is `id`, `org_id`, `created_at`, part of the primary
   key, an identity or generated column, not updatable, or a foreign key.
   Repointing a parent is a re-parent, not a field edit, and can move a row across
   tenants.
4. Casts the incoming string to the column's type. A failed cast is an error naming
   the expected type. Nothing is written, and a bad cast never lands as null.
5. Writes, then reads the row back and returns the new value.
6. Records the change in `audit_log`. That table has no `source` column, so the
   source is carried as `actor_role = 'mcp'` with `action = 'update_field'`,
   `actor_id = LUMEN_USER_ID`, and the old and new values in `before_state`,
   `after_state` and `diff`. An audit failure is surfaced as a warning on the
   result rather than swallowed.

## The stdout rule

stdio MCP uses stdout as the JSON-RPC transport. One stray `console.log` corrupts
the stream and kills the server with an opaque parse error. All logging, including
the startup resolver report, goes to stderr. `src/index.ts` redirects
`console.log`, `console.info`, `console.debug` and `console.warn` to `console.error`
for the whole process so third-party code cannot break the transport either.

## Environment

All four are required; the server exits with a message on stderr if any is missing.

| Variable | Meaning |
| --- | --- |
| `SUPABASE_URL` | Project URL, e.g. `https://npfnsyufqqhhjmtvmold.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role (secret) key. Bypasses RLS. |
| `LUMEN_ORG_ID` | The one organization this server may touch. |
| `LUMEN_USER_ID` | Profile id recorded as the actor on every write. |

## Build

```sh
cd /Users/joe/dev/dealcoach/mcp
npm install
npm run build          # produces dist/index.js
```

## Verify

```sh
npx @modelcontextprotocol/inspector node /Users/joe/dev/dealcoach/mcp/dist/index.js
```

The Inspector's errors are far more legible than Claude Desktop's. Fix everything
there first.

Then run the automated suite. It is read-only unless you pass `--write`, which adds
a round trip that flips one `msp_stages.is_completed`, checks `audit_log`, and
reverts it.

```sh
cd /Users/joe/dev/dealcoach/mcp
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... LUMEN_ORG_ID=... LUMEN_USER_ID=... \
  node scripts/verify.mjs --write
```

It checks the resolver classification and the six spot-check paths, that reads are
org-scoped, that an `msp_milestones` row in another org is refused (the case a
naive implementation gets wrong), that immutable and foreign-key columns are
refused, that a bad numeric cast errors without writing, and the full round trip
through `audit_log`.

Also read the startup report by hand after any schema change, and confirm the
refused list still contains only tables you recognise as global.

## Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lumen": {
      "command": "node",
      "args": ["/Users/joe/dev/dealcoach/mcp/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://npfnsyufqqhhjmtvmold.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "<service role key>",
        "LUMEN_ORG_ID": "<org uuid>",
        "LUMEN_USER_ID": "<profile uuid>"
      }
    }
  }
}
```

Absolute paths only: Claude Desktop launches from an undefined working directory.
Quit Claude Desktop completely and relaunch; reloading the window is not enough.
Logs land in `~/Library/Logs/Claude/mcp-server-lumen.log`, which is where the
startup resolver report appears.
