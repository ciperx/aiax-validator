/**
 * CLI contract: --json, --fixtures, --file, plain output and exit codes.
 * The CLI is spawned as a real process so exit codes are the real thing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { fixtureRoot, repoRoot } from "./helpers";

const cli = path.join(repoRoot, "dist", "src", "cli.js");

function run(args: string[], cwd = repoRoot) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", cwd });
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

test("cli exit codes: 0 for a valid site, 1 for an invalid site, 2 for a usage error", () => {
  assert.equal(run(["https://example.test", "--fixtures", path.join(fixtureRoot, "valid/minimal")]).code, 0);
  assert.equal(run(["https://example.test", "--fixtures", path.join(fixtureRoot, "broken/section-missing")]).code, 1);
  assert.equal(run([]).code, 2);
  assert.equal(run(["a", "b"]).code, 2);
  assert.equal(run(["--json"]).code, 2);
  assert.equal(run(["https://example.test", "--file"]).code, 2);
});

test("cli plain output: one line per error, each with its JSON pointer and message", () => {
  const result = run(["https://example.test", "--fixtures", path.join(fixtureRoot, "broken/section-id-mismatch")]);
  assert.equal(result.code, 1);
  const lines = result.stdout.trim().split("\n");
  assert.match(lines[0], /^FAIL https:\/\/example\.test score \d+ \(\d+ errors?, \d+ warnings?\)$/);
  const errorLines = lines.filter((line) => line.startsWith("error "));
  assert.equal(errorLines.length, 1);
  assert.match(errorLines[0], /^error \/section_id section_id "search" does not match entry point id "trust"$/);
});

test("cli plain output: a passing site prints PASS, its score and the section tally", () => {
  const result = run(["https://example.test", "--fixtures", path.join(fixtureRoot, "valid/minimal")]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /^PASS https:\/\/example\.test score 100 \(0 errors, 0 warnings\)/);
  assert.match(result.stdout, /sections 1\/1 valid/);
});

test("cli --json: stdout is only the report, so it parses with JSON.parse", () => {
  const result = run(["https://example.test", "--fixtures", path.join(fixtureRoot, "broken/manifest-extra-field"), "--json"]);
  assert.equal(result.code, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.ok(report.errors.length >= 1);
  assert.equal(report.errors[0].url, "https://example.test/.well-known/aiax.json");
  assert.ok(Array.isArray(report.sections));
});

test("cli --file: validates a manifest on disk and resolves sections next to it", () => {
  const manifest = path.join(fixtureRoot, "valid/minimal", ".well-known", "aiax.json");
  const result = run(["--file", manifest, "--json"]);
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.sections[0].ok, true);
  assert.equal(report.manifest_url, manifest);
});

test("cli --file: a manifest file that does not exist is a usage error, not a validation failure", () => {
  const result = run(["--file", path.join(fixtureRoot, "nope.json")]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /no such file/);
});

test("cli --help and --version exit 0 and mention the bin name", () => {
  const help = run(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /aiax-validate <url>/);
  assert.match(help.stdout, /Exit codes: 0 valid, 1 not valid, 2 usage error/);
  const version = run(["--version"]);
  assert.equal(version.code, 0);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("cli: a site with no manifest exits 1 and names the well-known path", () => {
  const result = run(["https://example.test", "--fixtures", path.join(fixtureRoot, "broken/no-manifest")]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /no AIAX manifest/);
  assert.match(result.stdout, /\.well-known\/aiax\.json/);
});
