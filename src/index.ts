/**
 * aiax-validator public surface.
 *
 *   import { validateSite } from "aiax-validator";
 *   const report = await validateSite("https://lax.kognai.ai", { fetch: myFetch });
 */
export { validateSite, validateManifestDocument } from "./validate";
export { scoreFindings, SCORE_RUBRIC } from "./score";
export { fixturesFetcher, fileFetcher, normalizeSiteUrl, fetchText, MANIFEST_PATHS } from "./fetch";
export { manifestSchema, sectionSchema, AIIAX_VERSION } from "./schemas";
export { checkDocument } from "./schema-check";
export type {
  Finding,
  Report,
  SectionReport,
  FetchLike,
  FetchResponse,
  ValidateOptions,
} from "./types";
export const VERSION = "0.1.0";
