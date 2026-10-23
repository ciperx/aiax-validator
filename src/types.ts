/**
 * Public report types for aiax-validator.
 *
 * Report is the exact shape the AIAX v0.1 job spec asks for:
 * { url, manifest_url, ok, score, errors: [{url, path, message}],
 *   warnings: [{url, path, message}], sections: [{id, url, ok, errors}] }
 */

/** One finding. `path` is a JSON pointer into the document at `url`. */
export interface Finding {
  url: string;
  path: string;
  message: string;
  /** Stable rule id, for example "manifest.required". Not part of the spec shape. */
  rule?: string;
}

export interface SectionReport {
  id: string;
  url: string;
  ok: boolean;
  errors: Finding[];
}

export interface Report {
  url: string;
  manifest_url: string;
  ok: boolean;
  score: number;
  errors: Finding[];
  warnings: Finding[];
  sections: SectionReport[];
}

/** The minimal response surface the validator needs from a fetch implementation. */
export interface FetchResponse {
  status?: number;
  ok?: boolean;
  text(): Promise<string>;
}

export type FetchLike = (url: string) => Promise<FetchResponse>;

export interface ValidateOptions {
  /** Injected fetcher. Defaults to global fetch. Tests pass their own, so no network. */
  fetch?: FetchLike;
  /** Timeout in milliseconds for a single fetch. Default 15000. */
  timeoutMs?: number;
}

export interface RuleResult {
  errors: Finding[];
  warnings: Finding[];
}
