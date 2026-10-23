/**
 * One test per validation rule, each named after the rule it proves.
 * Every fetch is injected: no test here opens a socket.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validateSite } from "../src/validate";
import {
  MANIFEST_URL,
  SECTION_URL,
  SITE,
  clone,
  mapFetch,
  minimalManifest,
  minimalSection,
  siteFetch,
  throwingFetch,
} from "./helpers";

test("rule manifest.fetch: a site with no manifest fails at the well-known path with score 0", async () => {
  const report = await validateSite(SITE, { fetch: mapFetch({}) });
  assert.equal(report.ok, false);
  assert.equal(report.score, 0);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].path, "/");
  assert.match(report.errors[0].message, /no AIAX manifest/);
  assert.equal(report.manifest_url, MANIFEST_URL);
});

test("rule manifest.fetch: discovery falls back to /aiax/manifest.json when the well-known path is 404", async () => {
  const fetcher = mapFetch({
    [`${SITE}/aiax/manifest.json`]: { body: minimalManifest() },
    [SECTION_URL]: { body: minimalSection() },
  });
  const report = await validateSite(SITE, { fetch: fetcher });
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.equal(report.manifest_url, `${SITE}/aiax/manifest.json`);
  assert.deepEqual(fetcher.calls.slice(0, 2), [MANIFEST_URL, `${SITE}/aiax/manifest.json`]);
});

test("rule manifest.fetch: a fetcher that throws is reported as a fetch error, not a crash", async () => {
  const report = await validateSite(SITE, { fetch: throwingFetch("connect ECONNREFUSED") });
  assert.equal(report.ok, false);
  assert.equal(report.errors[0].path, "/");
  assert.match(report.errors[0].message, /could not be fetched/);
});

test("rule manifest.json: a manifest that is not JSON is one clear error", async () => {
  const report = await validateSite(SITE, {
    fetch: mapFetch({ [MANIFEST_URL]: { raw: "<html>hello</html>" } }),
  });
  assert.equal(report.ok, false);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].path, "/");
  assert.match(report.errors[0].message, /not valid JSON/);
});

test("rule manifest.required: a missing required field is reported at its JSON pointer", async () => {
  const manifest = minimalManifest();
  delete manifest.pricing_summary;
  const report = await validateSite(SITE, { fetch: siteFetch(manifest) });
  assert.equal(report.ok, false);
  const finding = report.errors.find((e) => e.path === "/pricing_summary");
  assert.ok(finding, JSON.stringify(report.errors));
  assert.match(finding.message, /pricing_summary is missing/);
});

test("rule manifest.type: a wrong type names the field, the type and the value", async () => {
  const manifest = minimalManifest();
  (manifest.entry_points as Array<Record<string, unknown>>)[0].est_tokens = "120";
  const report = await validateSite(SITE, { fetch: siteFetch(manifest) });
  const finding = report.errors.find((e) => e.path === "/entry_points/0/est_tokens");
  assert.ok(finding, JSON.stringify(report.errors));
  assert.match(finding.message, /entry_points\[0\]\.est_tokens must be an integer/);
  assert.match(finding.message, /got string "120"/);
});

test("rule manifest.enum: an aiax_version other than 0.1 is rejected", async () => {
  const manifest = minimalManifest();
  manifest.aiax_version = "0.2";
  const report = await validateSite(SITE, { fetch: siteFetch(manifest) });
  const finding = report.errors.find((e) => e.path === "/aiax_version");
  assert.ok(finding, JSON.stringify(report.errors));
  assert.match(finding.message, /aiax_version must be one of "0.1", got "0.2"/);
});

test("rule manifest.pattern: an entry point id with capitals or spaces is rejected", async () => {
  const manifest = minimalManifest();
  (manifest.entry_points as Array<Record<string, unknown>>)[0].id = "Echo Section";
  const report = await validateSite(SITE, { fetch: siteFetch(manifest) });
  const finding = report.errors.find((e) => e.path === "/entry_points/0/id");
  assert.ok(finding, JSON.stringify(report.errors));
  assert.match(finding.message, /lowercase id/);
});

test("rule manifest.additionalProperties: an extra manifest field is rejected and the allowed fields listed", async () => {
  const manifest = minimalManifest();
  manifest.surprise = true;
  const report = await validateSite(SITE, { fetch: siteFetch(manifest) });
  const finding = report.errors.find((e) => e.path === "/surprise");
  assert.ok(finding, JSON.stringify(report.errors));
  assert.match(finding.message, /unexpected|not a field of manifest/);
  assert.match(finding.message, /allowed fields: aiax_version/);
});

test("rule manifest.limit: est_tokens outside 1 to 5000 and an over long product name are rejected", async () => {
  const manifest = minimalManifest();
  (manifest.entry_points as Array<Record<string, unknown>>)[0].est_tokens = 0;
  (manifest.product as Record<string, unknown>).name = "x".repeat(61);
  const report = await validateSite(SITE, { fetch: siteFetch(manifest) });
  const tokens = report.errors.find((e) => e.path === "/entry_points/0/est_tokens");
  const name = report.errors.find((e) => e.path === "/product/name");
  assert.ok(tokens, JSON.stringify(report.errors));
  assert.ok(name, JSON.stringify(report.errors));
  assert.match(tokens.message, /must be at least 1, got 0/);
  assert.match(name.message, /at most 60 characters long, got 61/);
});

test("rule manifest.format: updated_at that is not an ISO-8601 date-time is rejected", async () => {
  const manifest = minimalManifest();
  manifest.updated_at = "20 October 2026";
  const report = await validateSite(SITE, { fetch: siteFetch(manifest) });
  const finding = report.errors.find((e) => e.path === "/updated_at");
  assert.ok(finding, JSON.stringify(report.errors));
  assert.match(finding.message, /ISO-8601 date-time/);
});

test("rule manifest.format: mcp_endpoint that is not an absolute URI is rejected", async () => {
  const manifest = minimalManifest();
  manifest.mcp_endpoint = "not a url";
  const report = await validateSite(SITE, { fetch: siteFetch(manifest) });
  const finding = report.errors.find((e) => e.path === "/mcp_endpoint");
  assert.ok(finding, JSON.stringify(report.errors));
  assert.match(finding.message, /absolute URI/);
});

test("rule section.fetch: a section that 404s is an error naming the section", async () => {
  const report = await validateSite(SITE, {
    fetch: mapFetch({ [MANIFEST_URL]: { body: minimalManifest() } }),
  });
  assert.equal(report.ok, false);
  assert.equal(report.sections.length, 1);
  assert.equal(report.sections[0].id, "echo");
  assert.equal(report.sections[0].ok, false);
  const finding = report.errors.find((e) => e.message.includes("could not be fetched"));
  assert.ok(finding, JSON.stringify(report.errors));
  assert.match(finding.message, /HTTP 404/);
});

test("rule section.json: a section that is not JSON is an error", async () => {
  const report = await validateSite(SITE, {
    fetch: mapFetch({
      [MANIFEST_URL]: { body: minimalManifest() },
      [SECTION_URL]: { raw: "<html>not json</html>" },
    }),
  });
  const finding = report.errors.find((e) => e.message.includes("not valid JSON"));
  assert.ok(finding, JSON.stringify(report.errors));
  assert.equal(report.sections[0].ok, false);
});

test("rule section.required: a section missing a required field is an error at its pointer", async () => {
  const section = minimalSection();
  delete section.examples;
  const report = await validateSite(SITE, { fetch: siteFetch(minimalManifest(), section) });
  const finding = report.errors.find((e) => e.path === "/examples");
  assert.ok(finding, JSON.stringify(report.errors));
  assert.match(finding.message, /examples is missing/);
});

test("rule section.enum: a pricing model outside the allowed set is an error", async () => {
  const section = minimalSection();
  section.pricing = { model: "per_seat", amount: "0.01", currency: "USDC", rail: "x402" };
  const report = await validateSite(SITE, { fetch: siteFetch(minimalManifest(), section) });
  const finding = report.errors.find((e) => e.path === "/pricing/model");
  assert.ok(finding, JSON.stringify(report.errors));
  assert.match(finding.message, /pricing\.model must be one of/);
});

test("rule section.pattern: a pricing amount that is not a decimal string is an error", async () => {
  const section = minimalSection();
  section.pricing = { model: "per_call", amount: "0.01 USDC", currency: "USDC", rail: "x402" };
  const report = await validateSite(SITE, { fetch: siteFetch(minimalManifest(), section) });
  const finding = report.errors.find((e) => e.path === "/pricing/amount");
  assert.ok(finding, JSON.stringify(report.errors));
  assert.match(finding.message, /pricing\.amount must be/);
});

test("rule section.additionalProperties: an unknown pricing field is an error", async () => {
  const section = minimalSection();
  section.pricing = { model: "per_call", amount: "0.01", currency: "USDC", rail: "x402", discount: 10 };
  const report = await validateSite(SITE, { fetch: siteFetch(minimalManifest(), section) });
  const finding = report.errors.find((e) => e.path === "/pricing/discount");
  assert.ok(finding, JSON.stringify(report.errors));
  assert.match(finding.message, /pricing\.discount is not a field of pricing/);
});

test("rule section.oneOf: inputs that is neither an object nor a string is an error", async () => {
  const section = minimalSection();
  section.inputs = ["message"];
  const report = await validateSite(SITE, { fetch: siteFetch(minimalManifest(), section) });
  const finding = report.errors.find((e) => e.path === "/inputs");
  assert.ok(finding, JSON.stringify(report.errors));
  assert.match(finding.message, /must be an object .* or a string/);
});

test("rule section.id-mismatch: a section_id that differs from its entry point id is an error", async () => {
  const section = minimalSection();
  section.section_id = "search";
  const report = await validateSite(SITE, { fetch: siteFetch(minimalManifest(), section) });
  const finding = report.errors.find((e) => e.path === "/section_id" && e.message.includes("does not match"));
  assert.ok(finding, JSON.stringify(report.errors));
  assert.match(finding.message, /"search" does not match entry point id "echo"/);
  assert.equal(report.sections[0].ok, false);
});

test("rule section.format: pact_mandate_template that is not a URI is an error", async () => {
  const section = minimalSection();
  section.pact_mandate_template = 42;
  const report = await validateSite(SITE, { fetch: siteFetch(minimalManifest(), section) });
  const byPath = (path: string) => report.errors.find((e) => e.path === path);
  assert.ok(byPath("/pact_mandate_template"), JSON.stringify(report.errors));
});

test("rule manifest.duplicate-id: a repeated entry point id is a warning, not a failure", async () => {
  const manifest = minimalManifest();
  const entry = clone((manifest.entry_points as Array<Record<string, unknown>>)[0]);
  (manifest.entry_points as Array<Record<string, unknown>>).push(entry);
  const report = await validateSite(SITE, { fetch: siteFetch(manifest) });
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  const warning = report.warnings.find((w) => w.path === "/entry_points");
  assert.ok(warning, JSON.stringify(report.warnings));
  assert.match(warning.message, /appears more than once/);
  assert.equal(report.warnings.length, 1);
});

test("rule manifest.est-tokens: an estimate far from the real section size warns without failing", async () => {
  const manifest = minimalManifest();
  (manifest.entry_points as Array<Record<string, unknown>>)[0].est_tokens = 2000;
  const report = await validateSite(SITE, { fetch: siteFetch(manifest) });
  assert.equal(report.ok, true);
  const warning = report.warnings.find((w) => w.path === "/entry_points/0/est_tokens");
  assert.ok(warning, JSON.stringify(report.warnings));
  assert.equal(report.score, 98);
});
