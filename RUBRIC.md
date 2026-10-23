# Score rubric

`score` is a whole number from 0 to 100. It is computed from the findings of one
validation run, and from nothing else: no clock, no randomness, no network
ordering. Two runs on the same document always produce the same score.

## Formula

```
score = clamp(100 - 10 * errors - 2 * warnings, 0, 100)
```

| term | value |
| --- | --- |
| start | 100 |
| each error | -10 |
| each warning | -2 |
| floor | 0 |
| ceiling | 100 |
| rounding | nearest integer |

Consequences:

| errors | warnings | score | what it means |
| --- | --- | --- | --- |
| 0 | 0 | 100 | fully conformant, nothing to fix |
| 0 | 1 | 98 | valid, one advisory note |
| 1 | 0 | 90 | one schema violation, the A1 threshold |
| 1 | 1 | 88 | one violation plus an advisory note |
| 3 | 0 | 70 | several violations |
| 5 | 5 | 40 | most of the surface is broken |
| 10 or more | any | 0 | unusable surface |

## Why errors dominate

An error means the document does not match the published schema, so an agent
that follows the schema will misread it. That is a hard failure and it is what
`ok` and the exit code track: `ok` is true only when `errors.length === 0`, and
only `ok` decides exit code 0 versus 1. Warnings describe a surface that still
validates, so they only shade the score.

## The 90 threshold

The AIAX job asks for a score of 90 or more on the two reference sites. With
this rubric that means zero errors, and at most five warnings. Both reference
sites score 100 because their manifests and all eleven of their sections
validate cleanly.

## Warnings

| warning | when | why it matters |
| --- | --- | --- |
| `manifest.duplicate-id` | two entry points share an `id` | a section cannot be matched to a unique entry point |
| `manifest.est-tokens` | an estimate is over 60 percent away from the section's real size | `est_tokens` is how an agent budgets retrieval, so a wrong number wastes its context |

Warnings are deliberately rare. A surface can be fully conformant and still
warn, which is why warnings never change `ok`.

## What is not scored

- Token budget targets from the spec prose (100 to 300 tokens for a manifest,
  200 to 1000 for a section). They are guidance, not schema, and a large
  manifest is not a schema violation.
- Tier 2 MCP reachability and Tier 3 reference data, which v0.1 conformance
  does not require.
- Response times, caching headers and rate limiting.

## Reproducing a score

```bash
aiax-validate https://your.site --json | jq '{score, ok, errors: (.errors|length), warnings: (.warnings|length)}'
```

The same arithmetic is exported for tests and other tools:

```ts
import { scoreFindings, SCORE_RUBRIC } from "aiax-validator";
scoreFindings(1, 0); // 90
```
