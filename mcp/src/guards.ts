import type { ColumnMeta, TableMeta } from "./catalog.js";
import { IMMUTABLE_COLUMNS, LumenError } from "./config.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const INT_RE = /^-?\d+$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

export type WritabilityVerdict = { writable: true } | { writable: false; reason: string };

export function columnWritability(table: TableMeta, columnName: string): WritabilityVerdict {
  const column = table.columns.get(columnName);
  if (!column) {
    return { writable: false, reason: `column ${columnName} does not exist on ${table.name}` };
  }
  if (IMMUTABLE_COLUMNS.has(columnName)) {
    return { writable: false, reason: `${columnName} is immutable` };
  }
  if (table.pk.includes(columnName)) {
    return { writable: false, reason: `${columnName} is part of the primary key` };
  }
  if (column.isIdentity) {
    return { writable: false, reason: `${columnName} is an identity column` };
  }
  if (column.isGenerated) {
    return { writable: false, reason: `${columnName} is a generated column` };
  }
  if (!column.isUpdatable) {
    return { writable: false, reason: `${columnName} is not updatable` };
  }
  if (table.fkColumns.has(columnName)) {
    return {
      writable: false,
      reason: `${columnName} is a foreign key. Repointing a row's parent is a re-parent, not a field edit, and can move the row across tenants.`,
    };
  }
  return { writable: true };
}

function normalizeType(dataType: string): string {
  return dataType.trim().toLowerCase();
}

/**
 * Casts the string coming off the wire into the column's type.
 * Throws on a failed cast. Never returns null for a value that failed to parse:
 * a bad cast landing as null reads as a successful update and destroys data.
 */
export function coerceValue(column: ColumnMeta, raw: string | null): unknown {
  if (raw === null) {
    if (!column.isNullable) {
      throw new LumenError(`${column.name} is NOT NULL and cannot be set to null`);
    }
    return null;
  }

  const type = normalizeType(column.dataType);
  const value = raw.trim();

  const fail = (expected: string): never => {
    throw new LumenError(
      `cannot cast ${JSON.stringify(raw)} to ${column.name} (${column.dataType}); expected ${expected}. Nothing was written.`,
    );
  };

  if (type.endsWith("[]") || type === "array") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      return fail("a JSON array, for example [\"a\",\"b\"]");
    }
    if (!Array.isArray(parsed)) return fail("a JSON array");
    return parsed;
  }

  switch (type) {
    case "smallint":
    case "integer":
    case "int":
    case "int2":
    case "int4":
    case "int8":
    case "bigint":
      if (!INT_RE.test(value)) return fail("an integer");
      return Number(value);

    case "numeric":
    case "decimal":
    case "real":
    case "double precision":
    case "float4":
    case "float8":
    case "money": {
      const n = Number(value);
      if (!Number.isFinite(n)) return fail("a number");
      return n;
    }

    case "boolean":
    case "bool": {
      const v = value.toLowerCase();
      if (["true", "t", "yes", "y", "1"].includes(v)) return true;
      if (["false", "f", "no", "n", "0"].includes(v)) return false;
      return fail("true or false");
    }

    case "uuid":
      if (!UUID_RE.test(value)) return fail("a uuid");
      return value;

    case "date":
      if (!DATE_RE.test(value) || Number.isNaN(Date.parse(value))) return fail("a date as YYYY-MM-DD");
      return value;

    case "timestamp with time zone":
    case "timestamp without time zone":
    case "timestamptz":
    case "timestamp": {
      const ms = Date.parse(value);
      if (Number.isNaN(ms)) return fail("an ISO 8601 timestamp");
      return new Date(ms).toISOString();
    }

    case "time without time zone":
    case "time with time zone":
    case "time":
    case "timetz":
      if (!TIME_RE.test(value)) return fail("a time as HH:MM or HH:MM:SS");
      return value;

    case "json":
    case "jsonb":
      try {
        return JSON.parse(value);
      } catch {
        return fail("valid JSON");
      }

    // text, varchar, char, citext, enums (USER-DEFINED), inet, and anything the
    // catalog reports that is not enumerated above: pass the string through and
    // let Postgres validate it. The read-back in update_field surfaces the result.
    default:
      return value;
  }
}
