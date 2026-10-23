/**
 * AIAX v0.1 JSON Schemas, embedded so the validator runs with no network and
 * no dereferencing of $ref or remote $id.
 *
 * Copied verbatim from github.com/Godman-s/aiax, schemas/manifest.schema.json
 * and schemas/section.schema.json (version 0.1). Only the shape matters here:
 * the checker in schema-check.ts implements the subset of JSON Schema that
 * these two documents use, and validates them itself in test/schema-coverage.
 */

export type JsonSchema = {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: unknown[];
  pattern?: string;
  format?: string;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  oneOf?: JsonSchema[];
  description?: string;
};

export const AIIAX_VERSION = "0.1";

export const manifestSchema: JsonSchema = {
  type: "object",
  required: [
    "aiax_version",
    "product",
    "entry_points",
    "pricing_summary",
    "trust_signals",
    "mcp_endpoint",
    "updated_at",
  ],
  properties: {
    aiax_version: { type: "string", enum: ["0.1"] },
    product: {
      type: "object",
      required: ["name", "one_line_purpose", "domain"],
      additionalProperties: false,
      properties: {
        name: { type: "string", maxLength: 60 },
        one_line_purpose: { type: "string", maxLength: 160 },
        domain: { type: "string", maxLength: 60 },
      },
    },
    entry_points: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["id", "url", "purpose", "est_tokens"],
        additionalProperties: false,
        properties: {
          id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,60}$" },
          url: { type: "string", format: "uri-reference" },
          purpose: { type: "string", maxLength: 200 },
          est_tokens: { type: "integer", minimum: 1, maximum: 5000 },
        },
      },
    },
    pricing_summary: { type: ["string", "null"], maxLength: 200 },
    trust_signals: {
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: ["number", "null"], minimum: 0, maximum: 100 },
        pact_endpoint: { type: ["string", "null"], format: "uri" },
        drs_receipt_count: { type: ["integer", "null"], minimum: 0 },
        partnerships: {
          type: "array",
          maxItems: 5,
          items: { type: "string", maxLength: 60 },
        },
      },
    },
    mcp_endpoint: { type: ["string", "null"], format: "uri" },
    updated_at: { type: "string", format: "date-time" },
    llms_txt_url: { type: "string", format: "uri" },
    openapi_url: { type: "string", format: "uri" },
    extensions: { type: "object", additionalProperties: true },
  },
  additionalProperties: false,
};

export const sectionSchema: JsonSchema = {
  type: "object",
  required: [
    "aiax_version",
    "section_id",
    "purpose",
    "inputs",
    "outputs",
    "pricing",
    "examples",
    "pact_mandate_template",
  ],
  properties: {
    aiax_version: { type: "string", enum: ["0.1"] },
    section_id: { type: "string", pattern: "^[a-z0-9][a-z0-9_-]{0,60}$" },
    purpose: { type: "string", maxLength: 600 },
    inputs: {
      oneOf: [
        { type: "object", additionalProperties: true },
        { type: "string", maxLength: 400 },
      ],
    },
    outputs: {
      oneOf: [
        { type: "object", additionalProperties: true },
        { type: "string", maxLength: 400 },
      ],
    },
    pricing: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["model", "amount", "currency", "rail"],
      properties: {
        model: {
          type: "string",
          enum: ["per_call", "per_minute", "per_token", "flat", "free", "subscription"],
        },
        amount: { type: "string", pattern: "^[0-9]+(\\.[0-9]+)?$" },
        currency: { type: "string", maxLength: 10 },
        rail: { type: "string", maxLength: 30 },
      },
    },
    examples: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: {
        type: "object",
        required: ["description", "request", "response"],
        additionalProperties: false,
        properties: {
          description: { type: "string", maxLength: 200 },
          request: {},
          response: {},
        },
      },
    },
    pact_mandate_template: { type: ["string", "null"], format: "uri" },
    mcp_tool_name: { type: "string", maxLength: 80 },
    openapi_operation_id: { type: "string", maxLength: 120 },
    latency_p50_ms: { type: "integer", minimum: 0 },
    latency_p99_ms: { type: "integer", minimum: 0 },
    extensions: { type: "object", additionalProperties: true },
  },
  additionalProperties: false,
};
