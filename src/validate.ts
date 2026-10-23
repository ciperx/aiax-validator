/**
 * validateSite: fetch an AIAX manifest, validate it, fetch and validate every
 * entry point section, and score the surface.
 *
 * Network access is always delegated to an injected fetcher, so the tests and
 * the --fixtures mode run fully offline.
 */
import { manifestSchema, sectionSchema } from "./schemas";
import { checkDocument, joinPointer } from "./schema-check";
import { fetchText, manifestCandidates, normalizeSiteUrl, resolveSectionUrl } from "./fetch";
import { scoreFindings } from "./score";
import type { Finding, Report, SectionReport, ValidateOptions } from "./types";

export interface ManifestRun {
  report: Report;
  manifestSize: number;
  warningCount: number;
}

const EST_TOKENS_DIVISOR = 3; // the AIAX authors count roughly 3 bytes per token
const TOKEN_DRIFT_LIMIT = 0.6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueByIds(entryPoints: unknown[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const entry of entryPoints) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    if (seen.has(entry.id)) duplicates.push(entry.id);
    seen.add(entry.id);
  }
  return duplicates;
}

/**
 * Validate a manifest that is already in hand (used by --file, and by the
 * fixture tests). `manifestUrl` is what relative section URLs resolve against.
 */
export async function validateManifestDocument(
  document: unknown,
  manifestUrl: string,
  siteUrl: string,
  options: ValidateOptions = {},
): Promise<Report> {
  const fetcher = options.fetch;
  if (fetcher === undefined) throw new Error("validateManifestDocument needs a fetch implementation");

  const errors: Finding[] = [];
  const warnings: Finding[] = [];
  const sections: SectionReport[] = [];

  errors.push(...checkDocument(document, manifestSchema, "manifest", manifestUrl));

  const entryPoints = isRecord(document) && Array.isArray(document.entry_points) ? document.entry_points : [];
  if (isRecord(document) && Array.isArray(document.entry_points)) {
    for (const duplicate of uniqueByIds(document.entry_points)) {
      warnings.push({
        url: manifestUrl,
        path: "/entry_points",
        message: `entry point id "${duplicate}" appears more than once; ids must be unique so a section can be matched to its entry point`,
        rule: "manifest.duplicate-id",
      });
    }
  }

  for (let index = 0; index < entryPoints.length; index += 1) {
    const entry = entryPoints[index];
    if (!isRecord(entry) || typeof entry.url !== "string") continue;
    const id = typeof entry.id === "string" ? entry.id : "";

    let sectionUrl: string;
    try {
      sectionUrl = resolveSectionUrl(entry.url, manifestUrl);
    } catch {
      const finding: Finding = {
        url: manifestUrl,
        path: `/entry_points/${index}/url`,
        message: `entry_points[${index}].url is not a URL this tool can resolve: ${JSON.stringify(entry.url)}`,
        rule: "manifest.url",
      };
      errors.push(finding);
      sections.push({ id, url: entry.url, ok: false, errors: [finding] });
      continue;
    }

    const sectionErrors: Finding[] = [];
    const response = await fetchText(fetcher, sectionUrl);

    if (!response.ok) {
      sectionErrors.push({
        url: sectionUrl,
        path: "/",
        message:
          response.status === 404
            ? `section "${id}" could not be fetched: ${sectionUrl} returned HTTP 404`
            : `section "${id}" could not be fetched from ${sectionUrl} (HTTP ${response.status || "error"})`,
        rule: "section.fetch",
      });
    } else {
      let parsed: unknown;
      let parsedOk = true;
      try {
        parsed = JSON.parse(response.text);
      } catch {
        parsedOk = false;
        sectionErrors.push({
          url: sectionUrl,
          path: "/",
          message: `section "${id}" is not valid JSON (${response.text.slice(0, 40).replace(/\s+/g, " ")}...)`,
          rule: "section.json",
        });
      }
      if (parsedOk) {
        sectionErrors.push(...checkDocument(parsed, sectionSchema, "section", sectionUrl));
        if (isRecord(parsed) && typeof parsed.section_id === "string" && parsed.section_id !== id) {
          sectionErrors.push({
            url: sectionUrl,
            path: "/section_id",
            message: `section_id "${parsed.section_id}" does not match entry point id "${id}"`,
            rule: "section.id-mismatch",
          });
        }
      }
    }

    if (typeof entry.est_tokens === "number" && response.ok) {
      const actual = Math.max(1, Math.round(Buffer.byteLength(response.text, "utf8") / EST_TOKENS_DIVISOR));
      const drift = Math.abs(entry.est_tokens - actual) / actual;
      if (drift > TOKEN_DRIFT_LIMIT) {
        warnings.push({
          url: manifestUrl,
          path: `/entry_points/${index}/est_tokens`,
          message: `entry_points[${index}].est_tokens is ${entry.est_tokens} but the section is about ${actual} tokens, so an agent budget would be off by more than ${Math.round(TOKEN_DRIFT_LIMIT * 100)} percent`,
          rule: "manifest.est-tokens",
        });
      }
    }

    sections.push({ id, url: sectionUrl, ok: sectionErrors.length === 0, errors: sectionErrors });
    errors.push(...sectionErrors);
  }

  const warningList = warnings;
  const score = scoreFindings(errors.length, warningList.length);

  return {
    url: siteUrl,
    manifest_url: manifestUrl,
    ok: errors.length === 0,
    score,
    errors,
    warnings: warningList,
    sections,
  };
}

async function attemptManifest(
  fetcher: NonNullable<ValidateOptions["fetch"]>,
  url: string,
): Promise<{ found: boolean; response: Awaited<ReturnType<typeof fetchText>> }> {
  const response = await fetchText(fetcher, url);
  return { found: response.ok, response };
}

/**
 * Validate the AIAX surface of a site. Fetches /.well-known/aiax.json, then
 * /aiax/manifest.json, then every entry point section of the manifest found.
 */
export async function validateSite(input: string, options: ValidateOptions = {}): Promise<Report> {
  const fetcher = options.fetch ?? defaultFetcher;
  const siteUrl = normalizeSiteUrl(input);
  const candidates = manifestCandidates(siteUrl);

  const errors: Finding[] = [];
  let manifestUrl = candidates[0];
  let manifestText: string | null = null;
  let lastStatus = 0;

  for (const candidate of candidates) {
    const attempt = await attemptManifest(fetcher, candidate);
    lastStatus = attempt.response.status;
    if (attempt.found) {
      manifestUrl = candidate;
      manifestText = attempt.response.text;
      break;
    }
  }

  if (manifestText === null) {
    const detail = lastStatus === 404 ? "returned HTTP 404" : `could not be fetched (HTTP ${lastStatus || "error"})`;
    errors.push({
      url: manifestUrl,
      path: "/",
      message: `no AIAX manifest at ${candidates.join(" or ")}: ${manifestUrl} ${detail}`,
      rule: "manifest.fetch",
    });
    return {
      url: siteUrl,
      manifest_url: manifestUrl,
      ok: false,
      score: 0,
      errors,
      warnings: [],
      sections: [],
    };
  }

  let document: unknown;
  try {
    document = JSON.parse(manifestText);
  } catch {
    errors.push({
      url: manifestUrl,
      path: "/",
      message: `the manifest at ${manifestUrl} is not valid JSON: ${manifestText.slice(0, 60).replace(/\s+/g, " ")}...`,
      rule: "manifest.json",
    });
    return {
      url: siteUrl,
      manifest_url: manifestUrl,
      ok: false,
      score: 0,
      errors,
      warnings: [],
      sections: [],
    };
  }

  return validateManifestDocument(document, manifestUrl, siteUrl, { ...options, fetch: fetcher });
}

/** Global fetch, resolved lazily so importing the package never touches the network. */
const defaultFetcher = async (url: string) => {
  const response = await fetch(url, { headers: { accept: "application/json" }, redirect: "follow" });
  return response as unknown as { status: number; ok: boolean; text(): Promise<string> };
};
