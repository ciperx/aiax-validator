# aiax-validator

Validate and score any site's [AIAX](https://github.com/Godman-s/aiax) v0.1 surface.

AIAX is the agent-facing counterpart of a human product page: a small manifest at
`/.well-known/aiax.json` that points at capability sections. This tool fetches
that manifest, fetches every section it advertises, validates both against the
official schemas, and prints a score with one clear message per problem.

```
npx aiax-validator https://lax.kognai.ai
PASS https://lax.kognai.ai score 100 (0 errors, 0 warnings)
manifest https://lax.kognai.ai/.well-known/aiax.json
sections 5/5 valid
```

Broken surface:

```
$ npx aiax-validator example.com
FAIL https://example.com score 70 (3 errors, 0 warnings)
manifest https://example.com/.well-known/aiax.json
error /section_id section_id "search" does not match entry point id "trust"
error /entry_points/0/est_tokens entry_points[0].est_tokens must be an integer, got string "396"
error /aiax/sections/trust.json required field examples is missing
sections 0/1 valid
```

## Install and use

Node 20 or later.

```bash
npm install -g aiax-validator     # or: npx aiax-validator <url>
aiax-validate https://your.site
```

```
Usage:
  aiax-validate <url> [--json] [--fixtures <dir>]
  aiax-validate --file <path> [--json]

Options:
  --json            print the report as JSON instead of plain lines
  --fixtures <dir>  answer every fetch from files under <dir>, offline
  --file <path>     validate a manifest file on disk, sections relative to it
```

Exit codes are fixed: `0` the site is valid, `1` it is not, `2` a usage error
(bad flag, missing target, missing file or fixtures directory).

The bin is named `aiax-validate`, as the AIAX job spec requires. The package name
is `aiax-validator`, so `npx aiax-validator <url>` works too.

## Library

```ts
import { validateSite } from "aiax-validator";

const report = await validateSite("https://lax.kognai.ai", { fetch: myFetch });
if (!report.ok) {
  for (const error of report.errors) console.error(error.path, error.message);
}
```

`fetch` is any function `(url: string) => Promise<{ status?, ok?, text() }>`. It
defaults to the global fetch. Passing your own is how the tests and the hidden
tests stay offline, and how `--fixtures` works.

### Report shape

```ts
interface Report {
  url: string;                 // the site root that was asked for
  manifest_url: string;        // where the manifest was actually found
  ok: boolean;                 // true when there are no errors
  score: number;               // 0 to 100, see RUBRIC.md
  errors: Finding[];           // { url, path, message, rule }
  warnings: Finding[];         // same shape, advisory only
  sections: Array<{ id, url, ok, errors }>;
}
```

`path` is a JSON pointer into the document at `url` (`/entry_points/0/id`).
`message` names the field and says what is wrong in plain words. `rule` is a
stable id such as `manifest.pattern` or `section.id-mismatch`, which is what the
tests are named after. Section errors also appear in the top level `errors`, so
`ok` and `score` cover the whole surface.

## What is checked

Discovery: `/.well-known/aiax.json` first, then `/aiax/manifest.json`. A missing
manifest, a manifest that is not JSON, a section that cannot be fetched, a
section that is not JSON, and a `section_id` that differs from its entry point
id are all errors.

Manifest rules (`schemas/manifest.schema.json`, version 0.1):

| rule | what it proves |
| --- | --- |
| `manifest.fetch` | a manifest is reachable at one of the two paths |
| `manifest.json` | the body parses as JSON |
| `manifest.required` | all seven required fields are present |
| `manifest.type` | every value has the type the schema declares |
| `manifest.enum` | `aiax_version` is `"0.1"` |
| `manifest.pattern` | entry point ids match `^[a-z0-9][a-z0-9_-]{0,60}$` |
| `manifest.additionalProperties` | no unknown fields, including inside `product` and each entry point |
| `manifest.limit` | string lengths, 1 to 5000 `est_tokens`, numeric bounds |
| `manifest.format` | `updated_at` is ISO-8601, URIs are absolute, `url` is a URI reference |
| `manifest.duplicate-id` | (warning) entry point ids repeat |
| `manifest.est-tokens` | (warning) an estimate is more than 60 percent away from the section's real size |

Section rules (`schemas/section.schema.json`, version 0.1):

| rule | what it proves |
| --- | --- |
| `section.fetch` | every entry point section is reachable |
| `section.json` | the section body parses as JSON |
| `section.required` | all eight required fields are present |
| `section.type` / `section.limit` | types, lengths, example count 1 to 3 |
| `section.enum` | `aiax_version`, and `pricing.model` from the six allowed models |
| `section.pattern` | `section_id` format, `pricing.amount` is a decimal string |
| `section.oneOf` | `inputs` and `outputs` are an object or a string |
| `section.additionalProperties` | no unknown fields, including inside `pricing` and each example |
| `section.format` | `pact_mandate_template` is a URI or null |
| `section.id-mismatch` | `section_id` equals the entry point id that pointed here |

The schema subset checker in `src/schema-check.ts` implements exactly what these
two schemas use: `type`, `required`, `properties`, `additionalProperties`,
`items`, `enum`, `pattern`, `format`, `minLength`, `maxLength`, `minItems`,
`maxItems`, `minimum`, `maximum` and `oneOf`. It does not resolve remote `$ref`,
which is why the schemas are embedded in `src/schemas.ts`.

## Scoring

`score` starts at 100, loses 10 per error and 2 per warning, and is clamped to 0
to 100. A clean surface scores 100. One error scores 90. Full detail and worked
examples: [RUBRIC.md](RUBRIC.md).

```
score = clamp(100 - 10 * errors - 2 * warnings, 0, 100)
```

`ok` is `errors.length === 0`, and only `ok` decides the exit code. Warnings are
advisory: they lower the score without failing the site.

## Offline fixtures

`--fixtures <dir>` answers every fetch from a file, mapping the URL path under
the directory. A missing file is a 404, exactly like a server.

```bash
aiax-validate https://example.test --fixtures fixtures/broken/section-bad-pricing
```

The repository ships fixtures for every failure case, which is also how the test
suite runs with no network:

```
fixtures/valid/lax                 byte copies of lax.kognai.ai
fixtures/valid/kognai              byte copies of www.kognai.ai
fixtures/valid/minimal             smallest valid surface
fixtures/broken/manifest-missing-field
fixtures/broken/manifest-wrong-type
fixtures/broken/manifest-extra-field
fixtures/broken/manifest-bad-entry-id
fixtures/broken/section-missing-field
fixtures/broken/section-bad-pricing
fixtures/broken/section-id-mismatch
fixtures/broken/section-missing
fixtures/broken/section-not-json
fixtures/broken/no-manifest
```

## Tests

```bash
npm ci
npm test          # builds with tsc, then node --test
npx tsc --noEmit
```

41 tests, no network. One test per validation rule, named after the rule. A1 to
A5 are named after the acceptance items of the AIAX job:

- A1 both live sites pass, score 100, exit code 0
- A2 a broken manifest fails with one clear message per problem, naming its field
- A3 a broken section fails: missing field, bad pricing, mismatched id, missing, not JSON
- A4 `--json` prints the report, and the exit codes are 0, 1 and 2
- A5 the package ships a bin and broken fixtures for every failure case

Scoring determinism has its own tests: the same input scores the same twice, the
score depends on finding counts and not on their order, and the result is always
an integer inside 0 to 100.

## Limits

- AIAX v0.1 only. The `aiax_version` enum is `["0.1"]`.
- Tier 2 (MCP) and Tier 3 (reference data) are not validated; v0.1 conformance
  does not require them.
- The checker covers the JSON Schema features the two official schemas use, not
  all of draft 2020-12.
- No authentication, no rate limit handling, no caching. Every run fetches.

## License

MIT. The AIAX schemas are from [Godman-s/aiax](https://github.com/Godman-s/aiax).
