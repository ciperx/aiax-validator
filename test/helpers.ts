/**
 * Test helpers: an injected fetcher backed by fixture files or an in-memory
 * route map. No test in this repository touches the network.
 */
import * as path from "node:path";
import type { FetchLike, FetchResponse } from "../src/types";
import { fixturesFetcher } from "../src/fetch";

export const repoRoot = path.resolve(__dirname, "..", "..");
export const fixtureRoot = path.join(repoRoot, "fixtures");

export function fixtures(relative: string): FetchLike {
  return fixturesFetcher(path.join(fixtureRoot, relative));
}

export function validSite(): FetchLike {
  return fixtures("valid/minimal");
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function response(body: string, status = 200): FetchResponse {
  return { status, ok: status >= 200 && status < 300, text: async () => body };
}

export interface Route {
  body?: unknown;
  raw?: string;
  status?: number;
}

/** Exact URL to route. Unknown URLs are a 404, like a real server. */
export function mapFetch(routes: Record<string, Route>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(url);
    const route = routes[url];
    if (route === undefined) return response("not found", 404);
    if (route.status !== undefined) return response(route.raw ?? "", route.status);
    const text = route.raw ?? JSON.stringify(route.body ?? null);
    return response(text);
  }) as FetchLike & { calls: string[] };
  fetcher.calls = calls;
  return fetcher;
}

export function throwingFetch(message = "network down"): FetchLike {
  return async () => {
    throw new Error(message);
  };
}

/** A minimal valid manifest, deep cloned so tests can mutate one field. */
export function minimalManifest(): Record<string, unknown> {
  return {
    aiax_version: "0.1",
    product: {
      name: "Minimal agent",
      one_line_purpose: "Sells one thing to agents, briefly.",
      domain: "agent-services",
    },
    entry_points: [
      { id: "echo", url: "/aiax/sections/echo.json", purpose: "Echoes a message back.", est_tokens: 120 },
    ],
    pricing_summary: "0.01 USDC per call over x402 on Base.",
    trust_signals: {},
    mcp_endpoint: null,
    updated_at: "2026-10-20T10:00:00Z",
  };
}

export function minimalSection(): Record<string, unknown> {
  return {
    aiax_version: "0.1",
    section_id: "echo",
    purpose: "Echo a short message back to the caller.",
    inputs: { type: "object", required: ["message"], properties: { message: { type: "string" } } },
    outputs: { type: "object", properties: { echo: { type: "string" } } },
    pricing: { model: "per_call", amount: "0.01", currency: "USDC", rail: "x402" },
    examples: [{ description: "Echo one word.", request: { message: "hi" }, response: { echo: "hi" } }],
    pact_mandate_template: null,
  };
}

export const SITE = "https://example.test";
export const MANIFEST_URL = `${SITE}/.well-known/aiax.json`;
export const SECTION_URL = `${SITE}/aiax/sections/echo.json`;

/** A fetcher serving one manifest and one section, both valid by default. */
export function siteFetch(
  manifest: unknown = minimalManifest(),
  section: unknown = minimalSection(),
  sectionUrl = SECTION_URL,
): FetchLike & { calls: string[] } {
  return mapFetch({
    [MANIFEST_URL]: { body: manifest },
    [sectionUrl]: { body: section },
  });
}
