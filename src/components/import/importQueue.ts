import type { AudioImportJob } from "@/bindings";

/**
 * The list of files an import dialog is holding, and nothing else.
 *
 * The dialog gains its rows from two sources that cannot see each other — the
 * native file picker and an OS drag and drop — and loses them to a third, the
 * backend's job stream. Playwright cannot drop an OS file, so the drop path is
 * only ever exercised for real by hand; keeping the rules here, as functions
 * over a plain array, is what makes them provable at all.
 */

/** What a chosen file is doing, in the order it can happen. */
export type ImportRowState =
  | "ready"
  | "queued"
  | "running"
  | "done"
  | "cancelled"
  | "failed";

export interface ImportRow {
  /** Absolute path on disk. One path, one row: this is the row's identity. */
  path: string;
  /** What the row prints: the last path segment. */
  name: string;
  state: ImportRowState;
  /** The backend job this row follows, once a command returned one. */
  jobId: number | null;
  /** Full i18n key of the sentence explaining a failure, or null. */
  failure: string | null;
}

/** The last path segment, on either separator — a Windows path reaches here
 * through the same picker as a POSIX one. */
export const importFileName = (path: string): string =>
  path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);

/** Lower-cased extension without the dot, or "" when the name carries none.
 * A leading dot is a hidden file, not an extension. */
export const importFileExtension = (path: string): string => {
  const name = importFileName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/**
 * Append the paths this list does not already hold and the importer accepts.
 *
 * Returns the same array when nothing was added, so a drag that lands on files
 * already listed does not re-render the dialog.
 */
export const addImportPaths = (
  rows: ImportRow[],
  paths: readonly string[],
  extensions: readonly string[],
): ImportRow[] => {
  const known = new Set(rows.map((row) => row.path));
  const added: ImportRow[] = [];
  for (const path of paths) {
    if (known.has(path)) continue;
    if (!extensions.includes(importFileExtension(path))) continue;
    known.add(path);
    added.push({
      path,
      name: importFileName(path),
      state: "ready",
      jobId: null,
      failure: null,
    });
  }
  return added.length === 0 ? rows : [...rows, ...added];
};

/** Move one row, addressed by the path that identifies it. Returns the same
 * array when no row carries that path. */
export const setImportRow = (
  rows: ImportRow[],
  path: string,
  next: Partial<Pick<ImportRow, "state" | "jobId" | "failure">>,
): ImportRow[] => {
  let moved = false;
  const updated = rows.map((row) => {
    if (row.path !== path) return row;
    moved = true;
    return { ...row, ...next };
  });
  return moved ? updated : rows;
};

/** The paths still waiting to be handed to a command, in the order chosen. */
export const readyImportPaths = (rows: ImportRow[]): string[] =>
  rows.filter((row) => row.state === "ready").map((row) => row.path);

/**
 * What one backend job says about the row following it.
 *
 * A result outranks a status: the backend writes `status` and `result` in the
 * same update, and a failed job still reports the stage it failed in.
 */
export const audioJobRowState = (
  job: AudioImportJob,
): Pick<ImportRow, "state" | "failure"> => {
  if (job.result?.kind === "failed") {
    return {
      state: "failed",
      failure: `settings.history.audioImport.failure.${job.result.code}`,
    };
  }
  if (job.result?.kind === "cancelled" || job.status === "cancelled") {
    return { state: "cancelled", failure: null };
  }
  if (job.status === "done") return { state: "done", failure: null };
  if (job.status === "failed") return { state: "failed", failure: null };
  if (job.status === "queued") return { state: "queued", failure: null };
  return { state: "running", failure: null };
};
