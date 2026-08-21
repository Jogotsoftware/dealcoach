#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient } from "@supabase/supabase-js";
import { loadCatalog } from "./catalog.js";
import { LumenError, VERSION_TAG, loadConfig } from "./config.js";
import { printReport, resolveAll } from "./resolver.js";
import { TOOL_DEFINITIONS, createToolHandlers } from "./tools.js";

// stdout is the JSON-RPC transport. Anything else written there corrupts the
// stream and kills the server with an opaque parse error, so console.log is
// redirected to stderr for the whole process, including third-party code.
console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);
console.debug = (...args: unknown[]) => console.error(...args);
console.warn = (...args: unknown[]) => console.error(...args);

async function main(): Promise<void> {
  const cfg = loadConfig();

  const supabase = createClient(cfg.supabaseUrl, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.error(`${VERSION_TAG}: starting, org ${cfg.orgId}`);

  const catalog = await loadCatalog(supabase, cfg);
  const resolution = resolveAll(catalog);
  printReport(resolution);

  const handlers = createToolHandlers(supabase, resolution, cfg);

  const server = new Server(
    { name: "lumen", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: t.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs ?? {}) as Record<string, never>;
    try {
      switch (name) {
        case "list_tables":
          return await handlers.listTables(args);
        case "describe_table":
          return await handlers.describeTable(args as unknown as { table: string });
        case "find_deal":
          return await handlers.findDeal(args as unknown as { company_name: string });
        case "read_deal":
          return await handlers.readDeal(args as unknown as { deal_id: string });
        case "query_rows":
          return await handlers.queryRows(args as unknown as { table: string });
        case "create_row":
          return await handlers.createRow(
            args as unknown as { table: string; values: Record<string, string | null> },
          );
        case "update_field":
          return await handlers.updateField(
            args as unknown as { table: string; row_id: string; field: string; value: string | null },
          );
        default:
          throw new LumenError(`unknown tool ${name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const text = message.startsWith(VERSION_TAG) ? message : `${VERSION_TAG}: ${message}`;
      console.error(text);
      return { content: [{ type: "text", text }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`${VERSION_TAG}: ready, ${TOOL_DEFINITIONS.length} tools`);
}

main().catch((err) => {
  console.error(`${VERSION_TAG}: fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
