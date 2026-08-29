import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import { SettingContainer } from "../../ui/SettingContainer";
import { Button } from "../../ui/Button";

// Maximum number of lines kept in memory / rendered at once.
const MAX_LINES = 1000;
// Incoming logs are buffered and flushed on this cadence so a burst of log
// activity can never trigger a render per line.
const FLUSH_INTERVAL_MS = 250;

// Payload emitted by tauri-plugin-log's `Webview` target on the `log://log`
// event. `level` is the numeric LogLevel repr: Trace=1, Debug=2, Info=3,
// Warn=4, Error=5. `message` is the raw log message (no timestamp/target).
interface LogEventPayload {
  message: string;
  level: number;
}

interface LogLine {
  id: number;
  level: number;
  time: string;
  message: string;
}

/* Level accents on semantic tokens only. The tag is a mono microlabel, the
 * message carries the contrast: an ERROR line has to be findable while
 * scrolling, and TRACE has to stay out of the way. */
const LEVEL_META: Record<
  number,
  { tag: string; tagClass: string; msgClass: string }
> = {
  1: {
    tag: "TRACE",
    tagClass: "text-text-tertiary",
    msgClass: "text-text-tertiary",
  },
  2: {
    tag: "DEBUG",
    tagClass: "text-text-tertiary",
    msgClass: "text-text-secondary",
  },
  3: {
    tag: "INFO",
    tagClass: "text-text-secondary",
    msgClass: "text-text-primary",
  },
  4: {
    tag: "WARN",
    tagClass: "text-warning",
    msgClass: "text-text-primary",
  },
  5: {
    tag: "ERROR",
    tagClass: "text-error",
    msgClass: "text-error",
  },
};

const UNKNOWN_META = {
  tag: "LOG",
  tagClass: "text-text-tertiary",
  msgClass: "text-text-primary",
};

const metaFor = (level: number) => LEVEL_META[level] ?? UNKNOWN_META;

const formatTime = (date: Date): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
};

interface LiveLogViewerProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

export const LiveLogViewer: React.FC<LiveLogViewerProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState(false);

  const pendingRef = useRef<LogLine[]>([]);
  const idRef = useRef(0);
  const pausedRef = useRef(false);
  const pinnedRef = useRef(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Subscribe to the backend log stream. Lines land in a ref buffer rather than
  // state so high log volume never overwhelms React.
  useEffect(() => {
    const unlisten = listen<LogEventPayload>("log://log", (event) => {
      const line: LogLine = {
        id: idRef.current++,
        level: event.payload.level,
        time: formatTime(new Date()),
        message: event.payload.message,
      };
      const pending = pendingRef.current;
      pending.push(line);
      if (pending.length > MAX_LINES) {
        pending.splice(0, pending.length - MAX_LINES);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Flush buffered lines into state on a fixed cadence to cap re-renders.
  useEffect(() => {
    const interval = setInterval(() => {
      if (pausedRef.current || pendingRef.current.length === 0) return;
      const incoming = pendingRef.current;
      pendingRef.current = [];
      setLogs((prev) => {
        const next = prev.concat(incoming);
        return next.length > MAX_LINES
          ? next.slice(next.length - MAX_LINES)
          : next;
      });
    }, FLUSH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  // Keep the view pinned to the latest line unless the user has scrolled up.
  useEffect(() => {
    if (pinnedRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = distanceFromBottom < 24;
  }, []);

  const handleClear = useCallback(() => {
    pendingRef.current = [];
    setLogs([]);
    pinnedRef.current = true;
  }, []);

  const handleCopy = useCallback(async () => {
    const text = logs
      .map((l) => `${l.time} ${metaFor(l.level).tag} ${l.message}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("Failed to copy logs:", error);
    }
  }, [logs]);

  return (
    <SettingContainer
      title={t("settings.debug.liveLogs.title")}
      description={t("settings.debug.liveLogs.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout="stacked"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        {/* The dot never carries the state on its own — the word beside it
         * does, so the header still reads in greyscale. */}
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={`inline-block size-1.5 shrink-0 rounded-full ${
              paused ? "bg-text-tertiary" : "animate-pulse bg-danger"
            }`}
          />
          <span className="microlabel shrink-0">
            {paused
              ? t("settings.debug.liveLogs.paused")
              : t("settings.debug.liveLogs.live")}
          </span>
          <span className="truncate font-mono text-[11px] text-text-tertiary tabular-nums">
            {t("settings.debug.liveLogs.lineCount", { count: logs.length })}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPaused((p) => !p)}
          >
            {paused
              ? t("settings.debug.liveLogs.resume")
              : t("settings.debug.liveLogs.pause")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopy}
            disabled={logs.length === 0}
          >
            {copied ? t("settings.debug.liveLogs.copied") : t("common.copy")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleClear}
            disabled={logs.length === 0}
          >
            {t("common.clear")}
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="inset-panel h-72 overflow-y-auto font-mono text-xs leading-relaxed select-text"
      >
        {logs.length === 0 ? (
          <div className="text-text-tertiary select-none">
            {t("settings.debug.liveLogs.empty")}
          </div>
        ) : (
          logs.map((line) => {
            const meta = metaFor(line.level);
            return (
              <div key={line.id} className="flex gap-2">
                <span className="shrink-0 text-text-tertiary tabular-nums select-none">
                  {line.time}
                </span>
                <span
                  className={`${meta.tagClass} w-[3.5rem] shrink-0 tracking-[0.08em] select-none`}
                >
                  {meta.tag}
                </span>
                <span
                  className={`${meta.msgClass} min-w-0 break-words whitespace-pre-wrap`}
                >
                  {line.message}
                </span>
              </div>
            );
          })
        )}
      </div>
    </SettingContainer>
  );
};
