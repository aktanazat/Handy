import { useEffect, useRef, useState } from "react";
import { commands, type AudioImportJob } from "@/bindings";
import { useAudioImport } from "@/hooks/useAudioImport";
import { IMPORT_RUNNING, upsertAudioImportJob } from "./audioImportJobs";
import { subscribeToAudioImportUpdates } from "./historyEvents";

/* Every file import this page knows about: the ones already queued when it
 * opened, the ones it started itself, and the typed updates each of them
 * emits. `onJobCompleted` must be stable — the event subscription depends on
 * it, and a fresh identity would tear the listener down on every render. */
export const useAudioImportJobs = (onJobCompleted: () => void) => {
  const [audioImportJobs, setAudioImportJobs] = useState<AudioImportJob[]>([]);
  const [audioImportError, setAudioImportError] = useState<
    "start" | "cancel" | "load" | null
  >(null);
  /* Library is the surface that lists imports while they run and keeps its own
   * failure row inside the import panel, so it hands the shared action both:
   * the job to register, and somewhere to put the error other than a toast. */
  const { start: runAudioImport, importing: startingAudioImport } =
    useAudioImport({
      onQueued: (job) =>
        setAudioImportJobs((current) => upsertAudioImportJob(current, job)),
      onError: () => setAudioImportError("start"),
    });
  const completedAudioImportIdsRef = useRef(new Set<number>());

  useEffect(() => {
    let active = true;
    void commands
      .listAudioImportJobs()
      .then((jobs) => {
        if (active) setAudioImportJobs(jobs);
      })
      .catch(() => {
        if (active) setAudioImportError("load");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const subscription = subscribeToAudioImportUpdates((job) => {
      if (!active) return;
      setAudioImportJobs((current) => upsertAudioImportJob(current, job));
      if (
        job.status === "done" &&
        !completedAudioImportIdsRef.current.has(job.id)
      ) {
        completedAudioImportIdsRef.current.add(job.id);
        onJobCompleted();
      }
    });

    return () => {
      active = false;
      void subscription.then(
        (unlisten) => unlisten(),
        () => undefined,
      );
    };
  }, [onJobCompleted]);

  const startAudioImport = () => {
    // A fresh attempt clears the last one's failure. The hook owns the rest.
    setAudioImportError(null);
    void runAudioImport();
  };

  const cancelAudioImport = async (job: AudioImportJob) => {
    if (job.cancel_requested || !(job.status in IMPORT_RUNNING)) {
      return;
    }
    setAudioImportError(null);
    try {
      const result = await commands.cancelAudioImport(job.id);
      if (result.status === "error") {
        setAudioImportError("cancel");
        return;
      }
      setAudioImportJobs((current) =>
        upsertAudioImportJob(current, result.data),
      );
    } catch {
      setAudioImportError("cancel");
    }
  };

  return {
    audioImportJobs,
    audioImportError,
    startingAudioImport,
    startAudioImport,
    cancelAudioImport,
  };
};
