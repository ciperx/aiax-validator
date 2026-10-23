/**
 * Scoring is a pure function of the findings: same input, same score, and the
 * order in which findings were discovered cannot change it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { SCORE_RUBRIC, scoreFindings } from "../src/score";
import { validateSite } from "../src/validate";
import { MANIFEST_URL, SECTION_URL, SITE, fixtures, mapFetch, minimalManifest, minimalSection } from "./helpers";

test("scoring determinism: the same site scores the same on repeated runs", async () => {
  const first = await validateSite(SITE, { fetch: fixtures("valid/lax") });
  const second = await validateSite(SITE, { fetch: fixtures("valid/lax") });
  assert.equal(first.score, second.score);
  assert.deepEqual(first, second);
  assert.equal(first.score, 100);
});

test("scoring determinism: score depends on finding counts, not on their order", async () => {
  assert.equal(scoreFindings(3, 2), scoreFindings(3, 2));
  assert.equal(scoreFindings(1, 0), 90);
  assert.equal(scoreFindings(0, 1), 98);
  assert.equal(scoreFindings(4, 3), 54);
  assert.equal(SCORE_RUBRIC.start - 4 * SCORE_RUBRIC.perError - 3 * SCORE_RUBRIC.perWarning, 54);
});

test("scoring determinism: two entry points with the same section breakage score identically in either order", async () => {
  const broken = minimalSection();
  delete broken.examples;
  const manifest = minimalManifest();
  const entry = (manifest.entry_points as Array<Record<string, unknown>>)[0];
  manifest.entry_points = [entry, { ...entry, id: "echo-two", url: "/aiax/sections/two.json" }];

  const forward = mapFetch({
    [MANIFEST_URL]: { body: manifest },
    [SECTION_URL]: { body: broken },
    [`${SITE}/aiax/sections/two.json`]: { body: broken },
  });
  const backward = mapFetch({
    [MANIFEST_URL]: {
      body: {
        ...manifest,
        entry_points: [...(manifest.entry_points as Array<Record<string, unknown>>)].reverse(),
      },
    },
    [SECTION_URL]: { body: broken },
    [`${SITE}/aiax/sections/two.json`]: { body: broken },
  });

  const a = await validateSite(SITE, { fetch: forward });
  const b = await validateSite(SITE, { fetch: backward });
  assert.equal(a.score, b.score);
  assert.equal(a.errors.length, b.errors.length);
  assert.equal(a.score, scoreFindings(a.errors.length, a.warnings.length));
});

test("scoring determinism: the score is an integer inside 0 and 100 for extreme inputs", () => {
  for (const [errors, warnings] of [[0, 0], [1, 0], [0, 3], [9, 9], [50, 50], [1000, 1000]]) {
    const score = scoreFindings(errors, warnings);
    assert.equal(Number.isInteger(score), true);
    assert.ok(score >= 0 && score <= 100, `${errors}/${warnings} -> ${score}`);
  }
  assert.equal(scoreFindings(0, 0), 100);
  assert.equal(scoreFindings(1000, 0), 0);
});

test("scoring determinism: an invalid site never scores above a valid one with the same warnings", async () => {
  const valid = await validateSite(SITE, { fetch: fixtures("valid/minimal") });
  const invalid = await validateSite(SITE, { fetch: fixtures("broken/manifest-missing-field") });
  assert.equal(valid.ok, true);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.score < valid.score, `${invalid.score} vs ${valid.score}`);
  assert.ok(valid.score >= 90);
});
