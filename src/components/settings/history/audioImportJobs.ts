import type { AudioImportJob } from "@/bindings";

// A job is still cancellable while it is in one of these states.
export const IMPORT_RUNNING = {
  queued: true,
  decoding: true,
  transcribing: true,
} satisfies Partial<Record<AudioImportJob["status"], true>>;

export const upsertAudioImportJob = (
  jobs: AudioImportJob[],
  next: AudioImportJob,
): AudioImportJob[] =>
  [...jobs.filter((job) => job.id !== next.id), next].sort(
    (left, right) => left.id - right.id,
  );
