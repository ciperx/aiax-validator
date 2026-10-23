/**
 * A small, strict JSON Schema checker for the subset used by the two AIAX v0.1
 * schemas: type, required, properties, additionalProperties, items, enum,
 * pattern, format (uri, uri-reference, date-time), min/max length, min/max
 * items, numeric bounds and oneOf.
 *
 * Every finding carries a stable rule id and a JSON pointer into the document,
 * so a test can be named after the rule it proves.
 */
import type { Finding } from "./types";
import type { JsonSchema } from "./schemas";

export type DocKind = "manifest" | "section";

export const ALLOWED_FIELDS_NOTE = "allowed fields";

function escapePointer(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

export function joinPointer(base: string, segment: string | number): string {
  return `${base}/${escapePointer(String(segment))}`;
}

/** "/entry_points/0/id" -> "entry_points[0].id"; "" or "/" -> the document label. */
export function labelFor(pointer: string, kind: DocKind): string {
  const parts = pointer.split("/").filter((p) => p !== "");
  if (parts.length === 0) return kind;
  let out = "";
  for (const raw of parts) {
    const part = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (/^\d+$/.test(part)) out += `[${part}]`;
    else out += out === "" ? part : `.${part}`;
  }
  return out;
}

function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** Short, quoted rendering of a value for messages. */
export function show(value: unknown, max = 60): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch {
    text = String(value);
  }
  if (text === undefined) text = String(value);
  if (text.length > max) text = `${text.slice(0, max - 3)}...`;
  return text;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "string":
      return typeof value === "string";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return true;
  }
}

function describeTypes(schema: JsonSchema): string {
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  return types.map((t) => (t === "null" ? "null" : `a${t === "integer" || t === "array" || t === "object" ? "n" : ""} ${t}`)).join(" or ");
}

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function isDateTime(value: string): boolean {
  if (!DATE_TIME.test(value)) return false;
  const time = Date.parse(value);
  return !Number.isNaN(time);
}

export function isUri(value: string): boolean {
  if (/\s/.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol.length > 1;
  } catch {
    return false;
  }
}

/** RFC 3986 URI reference: absolute URI, absolute path, relative path, query or fragment. */
export function isUriReference(value: string): boolean {
  if (/\s/.test(value) || value === "") return false;
  if (isUri(value)) return true;
  return /^([a-zA-Z0-9\-._~!$&'()*+,;=:@%/?#\[\]]*)$/.test(value);
}

interface CheckContext {
  kind: DocKind;
  url: string;
  out: Finding[];
}

function push(ctx: CheckContext, pointer: string, rule: string, message: string): void {
  ctx.out.push({ url: ctx.url, path: pointer === "" ? "/" : pointer, message, rule });
}

function checkFormat(ctx: CheckContext, pointer: string, schema: JsonSchema, value: unknown): boolean {
  if (schema.format === undefined || typeof value !== "string") return true;
  const label = labelFor(pointer, ctx.kind);
  if (schema.format === "date-time" && !isDateTime(value)) {
    push(ctx, pointer, `${ctx.kind}.format`,
      `${label} must be an ISO-8601 date-time such as 2026-10-15T17:59:58Z, got ${show(value)}`);
    return false;
  }
  if (schema.format === "uri" && !isUri(value)) {
    push(ctx, pointer, `${ctx.kind}.format`,
      `${label} must be an absolute URI such as https://example.com/path, got ${show(value)}`);
    return false;
  }
  if (schema.format === "uri-reference" && !isUriReference(value)) {
    push(ctx, pointer, `${ctx.kind}.format`,
      `${label} must be an absolute URL or a relative URI reference, got ${show(value)}`);
    return false;
  }
  return true;
}

export function checkNode(ctx: CheckContext, schema: JsonSchema, value: unknown, pointer: string): void {
  const label = labelFor(pointer, ctx.kind);

  if (schema.oneOf !== undefined) {
    const passing = schema.oneOf.filter((branch) => {
      const probe: CheckContext = { ...ctx, out: [] };
      checkNode(probe, branch, value, pointer);
      return probe.out.length === 0;
    });
    if (passing.length !== 1) {
      push(ctx, pointer, `${ctx.kind}.oneOf`,
        `${label} must be an object (an inline JSON Schema) or a string (a prose description), got ${typeName(value)}`);
    }
    return;
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      push(ctx, pointer, `${ctx.kind}.type`,
        `${label} must be ${describeTypes(schema)}, got ${typeName(value)} ${show(value)}`);
      return;
    }
  }

  if (schema.enum !== undefined && !schema.enum.some((allowed) => allowed === value)) {
    push(ctx, pointer, `${ctx.kind}.enum`,
      `${label} must be one of ${schema.enum.map((v) => show(v, 20)).join(", ")}, got ${show(value)}`);
  }

  if (typeof value === "string") {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      const hint = schema.pattern === "^[a-z0-9][a-z0-9_-]{0,60}$"
        ? "a lowercase id of 1 to 61 letters, digits, underscores or hyphens, starting with a letter or digit"
        : "a value matching " + schema.pattern;
      push(ctx, pointer, `${ctx.kind}.pattern`,
        `${label} must be ${hint}, got ${show(value)}`);
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      push(ctx, pointer, `${ctx.kind}.limit`,
        `${label} must be at least ${schema.minLength} characters long, got ${value.length}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      push(ctx, pointer, `${ctx.kind}.limit`,
        `${label} must be at most ${schema.maxLength} characters long, got ${value.length}`);
    }
    checkFormat(ctx, pointer, schema, value);
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) {
      push(ctx, pointer, `${ctx.kind}.limit`,
        `${label} must be at least ${schema.minimum}, got ${value}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      push(ctx, pointer, `${ctx.kind}.limit`,
        `${label} must be at most ${schema.maximum}, got ${value}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      push(ctx, pointer, `${ctx.kind}.limit`,
        `${label} must have at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}, got ${value.length}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      push(ctx, pointer, `${ctx.kind}.limit`,
        `${label} must have at most ${schema.maxItems} items, got ${value.length}`);
    }
    if (schema.items !== undefined) {
      value.forEach((item, index) => checkNode(ctx, schema.items as JsonSchema, item, joinPointer(pointer, index)));
    }
  }

  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    for (const field of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(record, field)) {
        push(ctx, joinPointer(pointer, field), `${ctx.kind}.required`,
          `required field ${labelFor(joinPointer(pointer, field), ctx.kind)} is missing`);
      }
    }
    const properties = schema.properties ?? {};
    for (const [key, child] of Object.entries(record)) {
      const childSchema = properties[key];
      if (childSchema !== undefined) {
        checkNode(ctx, childSchema, child, joinPointer(pointer, key));
        continue;
      }
      const allowed = Object.keys(properties);
      if (schema.additionalProperties === false) {
        push(ctx, joinPointer(pointer, key), `${ctx.kind}.additionalProperties`,
          `${labelFor(joinPointer(pointer, key), ctx.kind)} is not a field of ${label}; ${ALLOWED_FIELDS_NOTE}: ${allowed.join(", ")}`);
      } else if (typeof schema.additionalProperties === "object") {
        checkNode(ctx, schema.additionalProperties, child, joinPointer(pointer, key));
      }
    }
  }
}

export function checkDocument(
  value: unknown,
  schema: JsonSchema,
  kind: DocKind,
  url: string,
): Finding[] {
  const ctx: CheckContext = { kind, url, out: [] };
  checkNode(ctx, schema, value, "");
  return ctx.out;
}
