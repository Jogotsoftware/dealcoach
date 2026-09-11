-- lumen-mcp: schema catalog for the local MCP server's ownership resolver.
--
-- PostgREST cannot read pg_catalog or information_schema, so the MCP server
-- obtains the FK graph and column metadata through this single RPC. The server
-- walks the FK graph at startup to derive each table's path to org_id; that
-- derived map is the only tenant isolation on a service-role connection.
--
-- service_role only: revoked from public, anon and authenticated.

create or replace function public.lumen_mcp_catalog()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with base_tables as (
    select c.oid, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  ),
  cols as (
    select
      bt.table_name,
      jsonb_agg(
        jsonb_build_object(
          'name', isc.column_name,
          'data_type', isc.data_type,
          'udt_name', isc.udt_name,
          'is_nullable', isc.is_nullable,
          'is_identity', isc.is_identity,
          'is_generated', isc.is_generated,
          'is_updatable', isc.is_updatable,
          'has_default', (isc.column_default is not null)
        )
        order by isc.ordinal_position
      ) as columns
    from base_tables bt
    join information_schema.columns isc
      on isc.table_schema = 'public' and isc.table_name = bt.table_name
    group by bt.table_name
  ),
  pks as (
    select
      bt.table_name,
      jsonb_agg(a.attname order by k.ord) as pk
    from base_tables bt
    join pg_constraint con on con.conrelid = bt.oid and con.contype = 'p'
    join lateral unnest(con.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = bt.oid and a.attnum = k.attnum
    group by bt.table_name
  ),
  fks as (
    select
      bt.table_name,
      jsonb_agg(
        jsonb_build_object(
          'constraint', con.conname,
          'column', a.attname,
          'ref_table', rc.relname,
          'ref_column', ra.attname
        )
        order by con.conname, k.ord
      ) as fks
    from base_tables bt
    join pg_constraint con on con.conrelid = bt.oid and con.contype = 'f'
    join pg_class rc on rc.oid = con.confrelid
    join pg_namespace rn on rn.oid = rc.relnamespace and rn.nspname = 'public'
    join lateral unnest(con.conkey) with ordinality as k(attnum, ord) on true
    join pg_attribute a on a.attrelid = bt.oid and a.attnum = k.attnum
    join lateral unnest(con.confkey) with ordinality as fk(attnum, ord) on fk.ord = k.ord
    join pg_attribute ra on ra.attrelid = con.confrelid and ra.attnum = fk.attnum
    -- single-column foreign keys only; composite FKs are not traversable as a
    -- simple parent pointer and the resolver must not guess.
    where array_length(con.conkey, 1) = 1
    group by bt.table_name
  )
  select jsonb_build_object(
    'generated_at', now(),
    'tables', coalesce(jsonb_agg(
      jsonb_build_object(
        'name', bt.table_name,
        'columns', coalesce(cols.columns, '[]'::jsonb),
        'pk', coalesce(pks.pk, '[]'::jsonb),
        'fks', coalesce(fks.fks, '[]'::jsonb)
      )
      order by bt.table_name
    ), '[]'::jsonb)
  )
  from base_tables bt
  left join cols on cols.table_name = bt.table_name
  left join pks on pks.table_name = bt.table_name
  left join fks on fks.table_name = bt.table_name;
$$;

revoke all on function public.lumen_mcp_catalog() from public;
revoke all on function public.lumen_mcp_catalog() from anon;
revoke all on function public.lumen_mcp_catalog() from authenticated;
grant execute on function public.lumen_mcp_catalog() to service_role;

comment on function public.lumen_mcp_catalog() is
  'Schema catalog (columns, primary keys, single-column foreign keys) for the lumen-mcp ownership resolver. service_role only.';
