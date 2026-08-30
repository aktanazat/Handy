// Anti-slop release gate.
//
// Runs oxlint over the repository with the rules in `oxlint.config.ts` and
// asserts that the diagnostics still match `tools/oxlint/baseline.json`.
//
// The manifest records one row per (file, rule) pair with the number of
// diagnostics, and the oxlint version that produced them. It deliberately
// omits line and column numbers: those move on every unrelated edit and would
// make the gate fail without telling anyone anything.
//
// Any difference fails the gate, in both directions:
//   - more diagnostics than the manifest records is new slop; fix it.
//   - fewer diagnostics, or a different oxlint version, means the manifest is
//     stale; refresh it with `bun run lint:anti-slop:update` and commit it.
//
// Equality in both directions is what keeps the manifest a true statement
// about the repository. A one-sided check would let the recorded ceiling drift
// above reality and quietly stop catching regressions.
//
// Generated files are excluded in `oxlint.config.ts` instead of being recorded
// here. Nothing a person changes in a file its generator rewrites can survive,
// so a row for one would be a ceiling nobody could ever bring down.

import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const BASELINE_PATH = resolve(ROOT, "tools", "oxlint", "baseline.json");
const LABEL = "[anti-slop]";
const UPDATE_COMMAND = "bun run lint:anti-slop:update";

/** Identifies one diagnostic group. Line numbers are deliberately absent. */
export interface RuleSite {
  file: string;
  rule: string;
}

export interface BaselineEntry extends RuleSite {
  severity: string;
  count: number;
}

export interface Baseline {
  oxlintVersion: string;
  entries: BaselineEntry[];
}

export interface Drift extends RuleSite {
  baselineCount: number;
  currentCount: number;
}

export interface DriftReport {
  added: Drift[];
  resolved: Drift[];
}

interface OxlintDiagnostic {
  code: string;
  severity: string;
  filename: string;
}

interface OxlintReport {
  diagnostics: OxlintDiagnostic[];
}

interface OxlintRun {
  version: string;
  entries: BaselineEntry[];
}

/**
 * Groups diagnostics by file and rule. Every lookup and every sort in this
 * file goes through this key, so the manifest ordering stays stable.
 */
function siteKey(site: RuleSite): string {
  return `${site.file}\u0000${site.rule}`;
}

function compareSites(left: RuleSite, right: RuleSite): number {
  if (left.file !== right.file) return left.file < right.file ? -1 : 1;
  if (left.rule !== right.rule) return left.rule < right.rule ? -1 : 1;
  return 0;
}

/**
 * Collapses raw oxlint diagnostics into the manifest rows. Paths are
 * normalized to forward slashes so a Windows checkout produces the same
 * manifest as macOS and the Linux runner.
 */
export function summarize(
  diagnostics: readonly OxlintDiagnostic[],
): BaselineEntry[] {
  const byKey = new Map<string, BaselineEntry>();
  for (const diagnostic of diagnostics) {
    const entry: BaselineEntry = {
      file: diagnostic.filename.replaceAll("\\", "/"),
      rule: diagnostic.code,
      severity: diagnostic.severity,
      count: 1,
    };
    const existing = byKey.get(siteKey(entry));
    if (existing) {
      existing.count += 1;
      continue;
    }
    byKey.set(siteKey(entry), entry);
  }
  return [...byKey.values()].sort(compareSites);
}

export function compareToBaseline(
  baseline: readonly BaselineEntry[],
  current: readonly BaselineEntry[],
): DriftReport {
  const baselineCounts = new Map<string, number>();
  for (const entry of baseline) {
    baselineCounts.set(siteKey(entry), entry.count);
  }

  const added: Drift[] = [];
  const resolved: Drift[] = [];
  const present = new Set<string>();

  for (const entry of current) {
    present.add(siteKey(entry));
    const baselineCount = baselineCounts.get(siteKey(entry)) ?? 0;
    if (entry.count === baselineCount) continue;
    const drift: Drift = {
      file: entry.file,
      rule: entry.rule,
      baselineCount,
      currentCount: entry.count,
    };
    if (entry.count > baselineCount) added.push(drift);
    else resolved.push(drift);
  }

  for (const entry of baseline) {
    if (present.has(siteKey(entry))) continue;
    resolved.push({
      file: entry.file,
      rule: entry.rule,
      baselineCount: entry.count,
      currentCount: 0,
    });
  }

  return {
    added: added.sort(compareSites),
    resolved: resolved.sort(compareSites),
  };
}

/** Rejects a hand-edited manifest that would make the comparison meaningless. */
export function parseBaseline(text: string): Baseline {
  const parsed: Baseline = JSON.parse(text);
  if (!parsed.oxlintVersion || !Array.isArray(parsed.entries)) {
    throw new Error(
      "the baseline manifest needs an oxlintVersion string and an entries array",
    );
  }
  for (const entry of parsed.entries) {
    if (!entry.file || !entry.rule || !entry.severity) {
      throw new Error(
        "every baseline entry needs a file, a rule, and a severity",
      );
    }
    if (!Number.isInteger(entry.count) || entry.count < 1) {
      throw new Error(
        `baseline entry ${entry.file} ${entry.rule} needs a positive integer count`,
      );
    }
  }
  return parsed;
}

function runOxlint(root: string): OxlintRun {
  const versionRun = Bun.spawnSync(["bunx", "oxlint", "--version"], {
    cwd: root,
  });
  if (versionRun.exitCode !== 0) {
    throw new Error(
      `oxlint --version failed: ${versionRun.stderr.toString().trim()}`,
    );
  }

  // oxlint exits non-zero whenever it reports an error, so the exit code says
  // nothing about whether the run itself worked. Parsing stdout does.
  const lintRun = Bun.spawnSync(["bunx", "oxlint", "--format=json"], {
    cwd: root,
  });
  let report: OxlintReport;
  try {
    report = JSON.parse(lintRun.stdout.toString());
  } catch {
    throw new Error(
      `oxlint produced no JSON report (exit ${lintRun.exitCode}): ${lintRun.stderr.toString().trim()}`,
    );
  }
  if (!Array.isArray(report.diagnostics)) {
    throw new Error("oxlint JSON report has no diagnostics array");
  }

  return {
    version: versionRun.stdout.toString().replace("Version:", "").trim(),
    entries: summarize(report.diagnostics),
  };
}

function printDrift(heading: string, drift: readonly Drift[]): void {
  console.error(`${LABEL} ${heading}`);
  for (const entry of drift) {
    console.error(
      `  ${entry.file}  ${entry.rule}  ${entry.baselineCount} -> ${entry.currentCount}`,
    );
  }
}

function main(): void {
  const update = process.argv.slice(2).includes("--update");
  const run = runOxlint(ROOT);
  const manifest = relative(ROOT, BASELINE_PATH);
  const total = run.entries.reduce((sum, entry) => sum + entry.count, 0);
  const scale = `${total} findings across ${run.entries.length} file/rule pairs`;

  if (update) {
    const baseline: Baseline = {
      oxlintVersion: run.version,
      entries: run.entries,
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, undefined, 2)}\n`);
    console.log(`${LABEL} wrote ${manifest}: oxlint ${run.version}, ${scale}`);
    return;
  }

  const baseline = parseBaseline(readFileSync(BASELINE_PATH, "utf8"));
  const drift = compareToBaseline(baseline.entries, run.entries);
  const stale = baseline.oxlintVersion !== run.version;
  const clean =
    !stale && drift.added.length === 0 && drift.resolved.length === 0;

  if (clean) {
    console.log(
      `${LABEL} oxlint ${run.version}: ${scale}, unchanged from ${manifest}`,
    );
    return;
  }

  if (stale) {
    console.error(
      `${LABEL} oxlint is ${run.version} but ${manifest} records ${baseline.oxlintVersion}. Review the drift below, then run \`${UPDATE_COMMAND}\`.`,
    );
  }
  if (drift.added.length > 0) {
    printDrift("new findings:", drift.added);
    console.error(
      `${LABEL} Fix them at the source. Do not disable a rule, weaken its severity, or widen ${manifest} to cover them.`,
    );
  }
  if (drift.resolved.length > 0) {
    printDrift(
      "findings resolved since the manifest was written:",
      drift.resolved,
    );
    console.error(
      `${LABEL} Run \`${UPDATE_COMMAND}\` and commit ${manifest} so the gate keeps catching regressions.`,
    );
  }
  process.exitCode = 1;
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${LABEL} ${message}`);
    process.exitCode = 1;
  }
}
