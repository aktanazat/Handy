import React from "react";
import { useTranslation } from "react-i18next";
import type { AudioImportJob } from "@/bindings";
import { IMPORT_RUNNING } from "./audioImportJobs";

/* The one sentence a screen reader hears while a file import runs. Always
 * mounted, so a status transition is never lost to the region appearing at
 * the same moment as its first message. Empty it takes no space. */
export const HistoryImportLive: React.FC<{ jobs: AudioImportJob[] }> = ({
  jobs,
}) => {
  const { t } = useTranslation();
  const running = jobs.filter(
    (job) => !job.cancel_requested && job.status in IMPORT_RUNNING,
  );
  const first = running[0];

  let message = "";
  if (running.length > 1) {
    message = t(
      "settings.history.audioImport.running",
      "Transcribing {{count}} files",
      { count: running.length },
    );
  } else if (first) {
    message = `${first.file_name} · ${t(`settings.history.audioImport.status.${first.status}`)}`;
  }

  return (
    <p
      className="text-xs break-words text-gray-900 empty:hidden"
      aria-live="polite"
      data-testid="history-import-live"
    >
      {message}
    </p>
  );
};
