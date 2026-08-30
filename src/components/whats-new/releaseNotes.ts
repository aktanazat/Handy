import { RELEASE_NOTE_MARKDOWN } from "@/content/release-notes";

export interface ReleaseNote {
  version: string;
  markdown: string;
}

interface ReleaseNoteRecord {
  version: string;
  markdown: string;
}

interface FindReleaseNoteOptions {
  currentVersion: string;
  lastSeenVersion: string;
}

const releaseNotesByVersion = new Map<string, ReleaseNoteRecord>();

const parseVersion = (version: string): [number, number, number] | null => {
  const normalized = version.trim().replace(/^v/i, "");
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;

  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

/* A version key that is not a semver triple is not a release note — the map is
 * hand-maintained, so a typo drops the entry instead of reaching the modal. */
for (const [version, markdown] of Object.entries(RELEASE_NOTE_MARKDOWN)) {
  if (!parseVersion(version)) continue;

  releaseNotesByVersion.set(version, { version, markdown });
}

const compareVersions = (a: string, b: string) => {
  const parsedA = parseVersion(a);
  const parsedB = parseVersion(b);

  if (!parsedA || !parsedB) return 0;

  for (let index = 0; index < parsedA.length; index += 1) {
    if (parsedA[index] !== parsedB[index]) {
      return parsedA[index] - parsedB[index];
    }
  }

  return 0;
};

export const findReleaseNoteToShow = ({
  currentVersion,
  lastSeenVersion,
}: FindReleaseNoteOptions): ReleaseNote | null => {
  if (!parseVersion(currentVersion)) return null;

  const hasValidLastSeenVersion = parseVersion(lastSeenVersion) !== null;
  const candidate = Array.from(releaseNotesByVersion.values())
    .filter(
      (note) =>
        compareVersions(note.version, currentVersion) <= 0 &&
        (!hasValidLastSeenVersion ||
          compareVersions(note.version, lastSeenVersion) > 0),
    )
    .sort((a, b) => compareVersions(b.version, a.version))[0];

  if (!candidate) return null;

  return candidate;
};

export const findLatestReleaseNote = (): ReleaseNote | null => {
  const candidate = Array.from(releaseNotesByVersion.values()).sort((a, b) =>
    compareVersions(b.version, a.version),
  )[0];

  if (!candidate) return null;

  return candidate;
};
