import React from "react";
import { useTranslation } from "react-i18next";
import type { AudioImportJob } from "@/bindings";
import { Microlabel, SETTINGS_CARD, SETTINGS_SURFACE } from "../rows";
import { Button } from "@/components/vg/button";
import { cn } from "@/lib/cn";
import { IMPORT_RUNNING } from "./audioImportJobs";

interface HistoryAudioImportSectionProps {
  jobs: AudioImportJob[];
  error: "start" | "cancel" | "load" | null;
  onCancel: (job: AudioImportJob) => void;
}

export const HistoryAudioImportSection: React.FC<
  HistoryAudioImportSectionProps
> = ({ jobs, error, onCancel }) => {
  const { t } = useTranslation();

  if (jobs.length === 0 && error === null) return null;

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p
          role="alert"
          className={cn(SETTINGS_CARD, "px-4 py-3 text-sm text-red-900")}
        >
          {t(`settings.history.audioImport.errors.${error}`)}
        </p>
      )}

      {jobs.length > 0 && (
        <section
          aria-labelledby="audio-import-jobs-title"
          data-testid="history-imports"
          className="flex flex-col gap-2"
        >
          <h2 id="audio-import-jobs-title">
            <Microlabel>{t("settings.history.audioImport.jobs")}</Microlabel>
          </h2>
          <ol className={SETTINGS_SURFACE}>
            {jobs.map((job) => {
              const canCancel =
                !job.cancel_requested && job.status in IMPORT_RUNNING;
              const failure =
                job.result?.kind === "failed" ? job.result.code : null;
              return (
                <li
                  key={job.id}
                  className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-[13px] leading-[19px] text-gray-1000"
                      title={job.file_name}
                    >
                      {job.file_name}
                    </p>
                    <p
                      className={`mt-0.5 text-sm ${failure ? "text-red-900" : "text-gray-900"}`}
                      role={failure ? "alert" : undefined}
                    >
                      {failure
                        ? t(`settings.history.audioImport.failure.${failure}`)
                        : job.cancel_requested
                          ? t("settings.history.audioImport.status.cancelling")
                          : t(
                              `settings.history.audioImport.status.${job.status}`,
                            )}
                    </p>
                  </div>
                  {canCancel && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void onCancel(job)}
                      data-testid="history-import-cancel"
                    >
                      {t("settings.history.audioImport.cancel")}
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
};
