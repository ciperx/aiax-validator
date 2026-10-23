/**
 * The five acceptance items of the AIAX validator job, one test each.
 * A1 runs against committed fixtures of the two live sites, so it stays
 * offline: the fixture files are byte copies taken from the live surfaces.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { validateSite } from "../src/validate";
import { fixtureRoot, fixtures, repoRoot } from "./helpers";

const cli = path.join(repoRoot, "dist", "src", "cli.js");

function runCli(args: string[]): { code: number; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

test("A1 lax.kognai.ai and www.kognai.ai pass with ok, score 90 or more and exit code 0", async () => {
  const sites = [
    { url: "https://lax.kognai.ai", dir: "valid/lax" },
    { url: "https://www.kognai.ai", dir: "valid/kognai" },
  ];
  for (const site of sites) {
    const report = await validateSite(site.url, { fetch: fixtures(site.dir) });
    assert.equal(report.ok, true, `${site.url}: ${JSON.stringify(report.errors)}`);
    assert.ok(report.score >= 90, `${site.url} scored ${report.score}`);
    assert.equal(report.errors.length, 0);
    assert.equal(report.sections.every((section) => section.ok), true);
    const cliRun = runCli([site.url, "--fixtures", path.join(fixtureRoot, site.dir)]);
    assert.equal(cliRun.code, 0, cliRun.stderr);
    assert.match(cliRun.stdout, /^PASS .* score 100 \(0 errors, 0 warnings\)/);
  }
});

test("A2 a broken manifest fails with one clear message per problem, naming its field", async () => {
  const cases = [
    { dir: "broken/manifest-missing-field", path: "/pricing_summary", word: /pricing_summary is missing/ },
    { dir: "broken/manifest-wrong-type", path: "/entry_points/0/est_tokens", word: /must be an integer/ },
    { dir: "broken/manifest-extra-field", path: "/surprise", word: /allowed fields/ },
    { dir: "broken/manifest-bad-entry-id", path: "/entry_points/0/id", word: /lowercase id/ },
  ];
  for (const item of cases) {
    const report = await validateSite("https://example.test", { fetch: fixtures(item.dir) });
    assert.equal(report.ok, false, item.dir);
    const finding = report.errors.find((error) => error.path === item.path);
    assert.ok(finding, `${item.dir}: ${JSON.stringify(report.errors)}`);
    assert.match(finding.message, item.word);
    const exit = runCli(["https://example.test", "--fixtures", path.join(fixtureRoot, item.dir)]);
    assert.equal(exit.code, 1, `${item.dir} should exit 1`);
  }
});

test("A3 broken sections fail: missing field, bad pricing, mismatched id, missing and non-JSON section", async () => {
  const cases = [
    { dir: "broken/section-missing-field", path: "/examples", word: /examples is missing/ },
    { dir: "broken/section-bad-pricing", path: "/pricing/model", word: /must be one of/ },
    { dir: "broken/section-id-mismatch", path: "/section_id", word: /does not match entry point id/ },
    { dir: "broken/section-missing", path: "/", word: /could not be fetched.*HTTP 404/ },
    { dir: "broken/section-not-json", path: "/", word: /not valid JSON/ },
  ];
  for (const item of cases) {
    const report = await validateSite("https://example.test", { fetch: fixtures(item.dir) });
    assert.equal(report.ok, false, item.dir);
    const finding = report.errors.find((error) => error.path === item.path);
    assert.ok(finding, `${item.dir}: ${JSON.stringify(report.errors)}`);
    assert.match(finding.message, item.word);
    assert.equal(report.sections[0].ok, false, item.dir);
    const exit = runCli(["https://example.test", "--fixtures", path.join(fixtureRoot, item.dir)]);
    assert.equal(exit.code, 1, `${item.dir} should exit 1`);
  }
});

test("A4 --json prints the report and the exit codes are 0, 1 and 2", () => {
  const valid = runCli(["https://example.test", "--fixtures", path.join(fixtureRoot, "valid/minimal"), "--json"]);
  assert.equal(valid.code, 0, valid.stderr);
  const report = JSON.parse(valid.stdout);
  for (const key of ["url", "manifest_url", "ok", "score", "errors", "warnings", "sections"]) {
    assert.ok(Object.prototype.hasOwnProperty.call(report, key), `report is missing ${key}`);
  }
  assert.equal(report.ok, true);
  assert.equal(report.score, 100);
  assert.equal(report.manifest_url, "https://example.test/.well-known/aiax.json");
  assert.equal(report.sections[0].id, "echo");

  const invalid = runCli(["https://example.test", "--fixtures", path.join(fixtureRoot, "broken/section-bad-pricing"), "--json"]);
  assert.equal(invalid.code, 1);
  assert.equal(JSON.parse(invalid.stdout).ok, false);

  assert.equal(runCli([]).code, 2, "no arguments is a usage error");
  assert.equal(runCli(["--fixtures"]).code, 2, "a flag without its value is a usage error");
  assert.equal(runCli(["https://example.test", "--nope"]).code, 2, "an unknown flag is a usage error");
  assert.equal(runCli(["https://example.test", "--fixtures", path.join(fixtureRoot, "does-not-exist")]).code, 2);
});

test("A5 the published package ships a bin and broken fixtures for every failure case", () => {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(pkg.name, "aiax-validator");
  assert.equal(pkg.bin["aiax-validate"], "dist/src/cli.js");
  assert.ok(pkg.files.includes("fixtures"));
  assert.ok(pkg.engines.node.includes("20"));

  const broken = path.join(fixtureRoot, "broken");
  const cases = readdirSync(broken).filter((entry) => !entry.startsWith("."));
  for (const name of [
    "manifest-missing-field",
    "manifest-wrong-type",
    "manifest-extra-field",
    "manifest-bad-entry-id",
    "section-missing-field",
    "section-bad-pricing",
    "section-id-mismatch",
    "section-missing",
    "section-not-json",
    "no-manifest",
  ]) {
    assert.ok(cases.includes(name), `missing broken fixture ${name}`);
  }

  // The tarball the registry would receive is exactly what files lists.
  const packed = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: repoRoot, encoding: "utf8" });
  const listed = JSON.parse(packed)[0].files.map((file: { path: string }) => file.path);
  assert.ok(listed.includes("dist/src/cli.js"));
  assert.ok(listed.some((file: string) => file.startsWith("fixtures/broken/section-bad-pricing/")));
  assert.ok(existsSync(path.join(repoRoot, "RUBRIC.md")));
});
