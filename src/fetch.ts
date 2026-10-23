/**
 * Fetchers. The validator never reaches for the network on its own: it takes
 * the fetcher from options, which is what makes the hidden tests and the
 * --fixtures mode possible.
 */
import { promises as fs, readFileSync } from "node:fs";
import * as path from "node:path";
import type { FetchLike, FetchResponse } from "./types";

export const MANIFEST_PATHS = ["/.well-known/aiax.json", "/aiax/manifest.json"] as const;

/** Accept "example.com", "https://example.com/" or a URL with a path. */
export function normalizeSiteUrl(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "") throw new Error("empty site url");
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withScheme);
  return `${parsed.protocol}//${parsed.host}`;
}

export function manifestCandidates(siteUrl: string): string[] {
  return MANIFEST_PATHS.map((p) => `${siteUrl.replace(/\/$/, "")}${p}`);
}

export function resolveSectionUrl(reference: string, manifestUrl: string): string {
  return new URL(reference, manifestUrl).toString();
}

export const globalFetch: FetchLike = async (url: string) => {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    redirect: "follow",
  });
  return response as unknown as FetchResponse;
};

export interface FetchedText {
  ok: boolean;
  status: number;
  text: string;
}

/** Fetch and read a body without throwing; a thrown fetcher becomes a 0 status. */
export async function fetchText(fetcher: FetchLike, url: string): Promise<FetchedText> {
  try {
    const response = await fetcher(url);
    const text = await response.text();
    const status = typeof response.status === "number" ? response.status : response.ok === false ? 0 : 200;
    const ok = typeof response.ok === "boolean" ? response.ok : status >= 200 && status < 300;
    return { ok, status, text };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, text: `fetch failed: ${reason}` };
  }
}

/** URL or reference -> the path under the fixtures directory. */
export function fixturePathFor(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split("#")[0].split("?")[0];
  }
  const decoded = decodeURIComponent(pathname);
  return decoded.startsWith("/") ? decoded : `/${decoded}`;
}

/**
 * Answers every fetch from a file: the URL path under `dir`
 * (dir/.well-known/aiax.json for https://site/.well-known/aiax.json).
 * A missing file is a 404, which is what the offline tests rely on.
 */
export function fixturesFetcher(dir: string): FetchLike {
  const root = path.resolve(dir);
  return async (url: string): Promise<FetchResponse> => {
    const relative = fixturePathFor(url).replace(/^\/+/, "");
    const file = path.resolve(root, relative);
    if (file !== root && !file.startsWith(root + path.sep)) {
      return { status: 404, ok: false, text: async () => `outside fixtures: ${url}` };
    }
    try {
      const text = await fs.readFile(file, "utf8");
      return { status: 200, ok: true, text: async () => text };
    } catch {
      return { status: 404, ok: false, text: async () => `no fixture at ${path.join(dir, relative)}` };
    }
  };
}

/** --file mode: read the manifest from disk, serve sections relative to its directory. */
export function fileFetcher(file: string): { fetcher: FetchLike; manifestUrl: string } {
  const absolute = path.resolve(file);
  const text = readFileSync(absolute, "utf8");
  const baseDir = path.dirname(absolute);
  const primary = fixturesFetcher(baseDir);
  // A manifest kept in .well-known/ usually has its sections one level up.
  const parent = fixturesFetcher(path.dirname(baseDir));
  // A virtual origin so that "/aiax/sections/x.json" resolves to a path that the
  // fixtures fetcher can find under baseDir, exactly like --fixtures does.
  const manifestUrl = "http://fixtures.local/manifest.json";
  const fetcher: FetchLike = async (url: string) => {
    if (url === manifestUrl) return { status: 200, ok: true, text: async () => text };
    const first = await primary(url);
    if (first.ok) return first;
    return parent(url);
  };
  return { fetcher, manifestUrl };
}
