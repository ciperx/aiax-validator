#!/usr/bin/env node
/**
 * aiax-validate: validate and score a site's AIAX v0.1 surface.
 *
 * Exit codes (fixed by the job spec):
 *   0  the site is valid (report.ok)
 *   1  the site is not valid
 *   2  usage error (bad flags, missing target, unreadable file or directory)
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { validateManifestDocument, validateSite } from "./validate";
import { fileFetcher, fixturesFetcher } from "./fetch";
import { VERSION } from "./index";
import type { Finding, Report } from "./types";

const USAGE = `aiax-validate ${VERSION}

Validate and score a site's AIAX v0.1 manifest and capability sections.

Usage:
  aiax-validate <url> [--json] [--fixtures <dir>]
  aiax-validate --file <path> [--json]

Options:
  --json            print the report as JSON instead of plain lines
  --fixtures <dir>  answer every fetch from files under <dir>, offline
  --file <path>     validate a manifest file on disk, sections relative to it
  -h, --help        show this help
  -v, --version     print the version

Exit codes: 0 valid, 1 not valid, 2 usage error.`;

export interface CliOptions {
  target?: string;
  file?: string;
  fixtures?: string;
  json: boolean;
  help: boolean;
  version: boolean;
}

export class UsageError extends Error {}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { json: false, help: false, version: false };
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--version" || arg === "-v") {
      options.version = true;
    } else if (arg === "--fixtures" || arg === "--file") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new UsageError(`${arg} needs a value`);
      }
      if (arg === "--fixtures") options.fixtures = value;
      else options.file = value;
      index += 1;
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown option ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  if (positionals.length > 1) throw new UsageError("expected exactly one url");
  if (positionals.length === 1) options.target = positionals[0];
  if (options.target !== undefined && options.file !== undefined) {
    throw new UsageError("give either a url or --file, not both");
  }
  if (!options.help && !options.version && options.target === undefined && options.file === undefined) {
    throw new UsageError("a url or --file is required");
  }
  return options;
}

function findingLine(level: "error" | "warn", finding: Finding): string {
  return `${level} ${finding.path} ${finding.message}`;
}

export function formatPlain(report: Report): string {
  const lines: string[] = [];
  const verdict = report.ok ? "PASS" : "FAIL";
  lines.push(
    `${verdict} ${report.url} score ${report.score} (${report.errors.length} error${report.errors.length === 1 ? "" : "s"}, ${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"})`,
  );
  lines.push(`manifest ${report.manifest_url}`);
  for (const error of report.errors) lines.push(findingLine("error", error));
  for (const warning of report.warnings) lines.push(findingLine("warn", warning));
  const valid = report.sections.filter((section) => section.ok).length;
  lines.push(`sections ${valid}/${report.sections.length} valid`);
  return `${lines.join("\n")}\n`;
}

async function run(argv: string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`aiax-validate: ${message}\n\n${USAGE}\n`);
    return 2;
  }

  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  let report: Report;
  try {
    if (options.file !== undefined) {
      const absolute = path.resolve(options.file);
      const stat = await fs.stat(absolute).catch(() => null);
      if (stat === null || !stat.isFile()) {
        process.stderr.write(`aiax-validate: no such file ${options.file}\n`);
        return 2;
      }
      const { fetcher, manifestUrl } = fileFetcher(absolute);
      const document = JSON.parse(await fs.readFile(absolute, "utf8"));
      report = await validateManifestDocument(document, manifestUrl, absolute, { fetch: fetcher });
      report.manifest_url = absolute;
    } else {
      let fetcher = undefined as undefined | ReturnType<typeof fixturesFetcher>;
      if (options.fixtures !== undefined) {
        const dir = path.resolve(options.fixtures);
        const stat = await fs.stat(dir).catch(() => null);
        if (stat === null || !stat.isDirectory()) {
          process.stderr.write(`aiax-validate: --fixtures directory not found: ${options.fixtures}\n`);
          return 2;
        }
        fetcher = fixturesFetcher(dir);
      }
      report = await validateSite(options.target as string, fetcher === undefined ? {} : { fetch: fetcher });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`aiax-validate: ${message}\n`);
    return 2;
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatPlain(report));
  }
  return report.ok ? 0 : 1;
}

if (require.main === module) {
  run(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`aiax-validate: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    });
}

export { run };
